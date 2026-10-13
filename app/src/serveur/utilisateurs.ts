import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { estCodeProfil, peutAgir, type CodeProfil } from "@/domaine/droits";
import {
  estVerrouille,
  etatApresEchec,
  identifiantValide,
  normaliserIdentifiant,
  problemesMotDePasse,
  MOT_DE_PASSE_LONGUEUR_MAX,
} from "@/domaine/securite";

import { journaliser, type ActeurAudit } from "./audit";
import { exigerNiveau } from "./droits";
import { hacherMotDePasse, verifierContreEmpreinteFactice, verifierMotDePasse } from "./mot-de-passe";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

const acteurAudit = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });

type UtilisateurAvecProfil = Prisma.UtilisateurGetPayload<{ include: { profil: true } }>;

export function versUtilisateurCourant(u: UtilisateurAvecProfil): UtilisateurCourant {
  return {
    id: u.id,
    identifiant: u.identifiant,
    nom: u.nom,
    profil: u.profil.code as CodeProfil,
    libelleProfil: u.profil.libelle,
    doitChangerMotDePasse: u.doitChangerMotDePasse,
  };
}

/**
 * Enregistre un mot de passe faux : compte les échecs et verrouille le compte au seuil.
 * Incrément atomique en base : des essais simultanés ne peuvent pas contourner le compteur.
 */
async function enregistrerEchec(
  tx: Prisma.TransactionClient,
  utilisateur: UtilisateurAvecProfil,
  adresseIp: string | null,
  maintenant: Date,
  action: "CONNEXION_ECHEC" | "MOT_DE_PASSE_CHANGE",
): Promise<void> {
  const apresIncrement = await tx.utilisateur.update({
    where: { id: utilisateur.id },
    data: { echecsConsecutifs: { increment: 1 } },
    select: { echecsConsecutifs: true },
  });
  const etat = etatApresEchec(apresIncrement.echecsConsecutifs - 1, maintenant);
  const acteur = { id: utilisateur.id, identifiant: utilisateur.identifiant };
  if (action === "CONNEXION_ECHEC") {
    await journaliser({ acteur, action, objetType: "utilisateur", objetId: utilisateur.id, adresseIp }, tx);
  }
  if (etat.verrouilleJusqua) {
    await tx.utilisateur.update({
      where: { id: utilisateur.id },
      data: { echecsConsecutifs: etat.echecsConsecutifs, verrouilleJusqua: etat.verrouilleJusqua },
    });
    await journaliser(
      {
        acteur,
        action: "COMPTE_VERROUILLE",
        objetType: "utilisateur",
        objetId: utilisateur.id,
        apres: { verrouilleJusqua: etat.verrouilleJusqua.toISOString() },
        adresseIp,
      },
      tx,
    );
  }
}

/**
 * Vérifie un couple identifiant / mot de passe (connexion). Renvoie l'utilisateur, ou null
 * SANS dire pourquoi (identifiant inconnu, mot de passe faux, compte verrouillé ou désactivé :
 * même réponse, même durée). Le motif réel est dans le journal d'audit.
 */
export async function verifierIdentifiants(
  saisie: { identifiant: unknown; motDePasse: unknown },
  adresseIp: string | null,
  maintenant: Date = new Date(),
): Promise<UtilisateurCourant | null> {
  const prisma = obtenirPrisma();
  const motDePasse = typeof saisie.motDePasse === "string" ? saisie.motDePasse : "";
  const identifiant = typeof saisie.identifiant === "string" ? normaliserIdentifiant(saisie.identifiant) : "";
  const saisieAcceptable = identifiant.length > 0 && identifiant.length <= 64 && motDePasse.length <= MOT_DE_PASSE_LONGUEUR_MAX;

  const utilisateur = saisieAcceptable
    ? await prisma.utilisateur.findUnique({ where: { identifiant }, include: { profil: true } })
    : null;

  if (!utilisateur) {
    await verifierContreEmpreinteFactice(saisieAcceptable ? motDePasse : "");
    await journaliser({
      acteur: null,
      action: "CONNEXION_ECHEC",
      apres: { raison: "identifiant inconnu" }, // rien de ce qui a été tapé (audit M4) : une saisie peut être un mot de passe
      adresseIp,
    });
    return null;
  }

  const acteur = { id: utilisateur.id, identifiant: utilisateur.identifiant };

  if (estVerrouille(utilisateur.verrouilleJusqua, maintenant)) {
    // On ne vérifie pas le mot de passe d'un compte verrouillé : pas de piste d'essais gratuite.
    await verifierContreEmpreinteFactice(motDePasse);
    await journaliser({ acteur, action: "CONNEXION_REFUSEE_COMPTE_VERROUILLE", objetType: "utilisateur", objetId: utilisateur.id, adresseIp });
    return null;
  }

  const motDePasseCorrect = await verifierMotDePasse(motDePasse, utilisateur.motDePasseHash);
  if (!motDePasseCorrect) {
    await prisma.$transaction((tx) => enregistrerEchec(tx, utilisateur, adresseIp, maintenant, "CONNEXION_ECHEC"));
    return null;
  }

  if (!utilisateur.actif) {
    await journaliser({ acteur, action: "CONNEXION_REFUSEE_COMPTE_INACTIF", objetType: "utilisateur", objetId: utilisateur.id, adresseIp });
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.utilisateur.update({
      where: { id: utilisateur.id },
      data: { echecsConsecutifs: 0, verrouilleJusqua: null, derniereConnexionLe: maintenant },
    });
    await journaliser({ acteur, action: "CONNEXION_REUSSIE", objetType: "utilisateur", objetId: utilisateur.id, adresseIp }, tx);
  });
  return versUtilisateurCourant(utilisateur);
}

export type LigneUtilisateur = {
  id: number;
  identifiant: string;
  nom: string;
  profil: CodeProfil;
  libelleProfil: string;
  actif: boolean;
  verrouille: boolean;
  derniereConnexionLe: Date | null;
};

export async function listerUtilisateurs(acteur: UtilisateurCourant): Promise<LigneUtilisateur[]> {
  await exigerNiveau(acteur, "GERER_UTILISATEURS", peutAgir);
  const maintenant = new Date();
  const utilisateurs = await obtenirPrisma().utilisateur.findMany({
    include: { profil: true },
    orderBy: { identifiant: "asc" },
  });
  return utilisateurs.map((u) => ({
    id: u.id,
    identifiant: u.identifiant,
    nom: u.nom,
    profil: u.profil.code as CodeProfil,
    libelleProfil: u.profil.libelle,
    actif: u.actif,
    verrouille: estVerrouille(u.verrouilleJusqua, maintenant),
    derniereConnexionLe: u.derniereConnexionLe,
  }));
}

function verifierNomEtMotDePasse(identifiant: string, nom: string, motDePasse: string | null): void {
  if (nom.trim().length < 1 || nom.trim().length > 100) {
    throw new ErreurMetier("Le nom doit contenir de 1 à 100 caractères.");
  }
  if (motDePasse !== null) {
    const problemes = problemesMotDePasse(motDePasse, identifiant);
    if (problemes.length > 0) {
      throw new ErreurMetier(`Mot de passe refusé : ${problemes.join(", ")}.`);
    }
  }
}

type NouvelUtilisateur = { identifiant: string; nom: string; profil: string; motDePasse: string };

async function inserer(
  tx: Prisma.TransactionClient,
  donnees: NouvelUtilisateur,
  doitChangerMotDePasse: boolean,
): Promise<{ id: number; identifiant: string; nom: string; profil: CodeProfil }> {
  const identifiant = normaliserIdentifiant(donnees.identifiant);
  if (!identifiantValide(identifiant)) {
    throw new ErreurMetier("Identifiant invalide : 3 à 64 caractères parmi lettres, chiffres, . _ - @.");
  }
  if (!estCodeProfil(donnees.profil)) {
    throw new ErreurMetier("Profil inconnu.");
  }
  verifierNomEtMotDePasse(identifiant, donnees.nom, donnees.motDePasse);
  if (await tx.utilisateur.findUnique({ where: { identifiant }, select: { id: true } })) {
    throw new ErreurMetier("Cet identifiant est déjà utilisé.");
  }
  const profil = await tx.profil.findUnique({ where: { code: donnees.profil } });
  if (!profil) {
    throw new ErreurMetier("Profil inconnu : les profils ne sont pas initialisés (npm run initialiser).");
  }
  const cree = await tx.utilisateur.create({
    data: {
      identifiant,
      nom: donnees.nom.trim(),
      motDePasseHash: await hacherMotDePasse(donnees.motDePasse),
      profilId: profil.id,
      doitChangerMotDePasse,
    },
  });
  return { id: cree.id, identifiant, nom: cree.nom, profil: donnees.profil };
}

export async function creerUtilisateur(
  acteur: UtilisateurCourant,
  donnees: NouvelUtilisateur,
  adresseIp: string | null,
): Promise<void> {
  await exigerNiveau(acteur, "GERER_UTILISATEURS", peutAgir);
  await obtenirPrisma().$transaction(async (tx) => {
    const cree = await inserer(tx, donnees, true);
    await journaliser(
      {
        acteur: acteurAudit(acteur),
        action: "UTILISATEUR_CREE",
        objetType: "utilisateur",
        objetId: cree.id,
        apres: { identifiant: cree.identifiant, nom: cree.nom, profil: cree.profil },
        adresseIp,
      },
      tx,
    );
  });
}

/** Premier administrateur (script d'installation) : pas d'acteur connecté, le journal l'indique. */
export async function creerAdministrateurInitial(donnees: Omit<NouvelUtilisateur, "profil">): Promise<number> {
  return obtenirPrisma().$transaction(async (tx) => {
    const cree = await inserer(tx, { ...donnees, profil: "ADMIN_SYSTEME" }, false);
    await journaliser(
      {
        acteur: null,
        action: "UTILISATEUR_CREE",
        objetType: "utilisateur",
        objetId: cree.id,
        apres: { identifiant: cree.identifiant, nom: cree.nom, profil: cree.profil, origine: "script creer-admin" },
      },
      tx,
    );
    return cree.id;
  });
}

/**
 * Compte de TEST créé par le seed de développement (serveur/seed-dev.ts) : mêmes contrôles qu'une
 * création ordinaire (identifiant, politique de mot de passe), mais sans changement de mot de passe
 * imposé. Pas d'acteur connecté : le journal l'indique.
 */
export async function creerCompteSeedDev(donnees: NouvelUtilisateur): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    const cree = await inserer(tx, donnees, false);
    await journaliser(
      {
        acteur: null,
        action: "UTILISATEUR_CREE",
        objetType: "utilisateur",
        objetId: cree.id,
        apres: { identifiant: cree.identifiant, nom: cree.nom, profil: cree.profil, origine: "compte créé par le seed de développement" },
      },
      tx,
    );
  });
}

/** Nombre d'Admin système actifs, hors l'utilisateur donné. */
async function autresAdminsActifs(tx: Prisma.TransactionClient, exclureId: number): Promise<number> {
  return tx.utilisateur.count({
    where: { actif: true, id: { not: exclureId }, profil: { code: "ADMIN_SYSTEME" } },
  });
}

export async function modifierUtilisateur(
  acteur: UtilisateurCourant,
  id: number,
  modifications: { nom?: string; profil?: string; actif?: boolean },
  adresseIp: string | null,
): Promise<void> {
  await exigerNiveau(acteur, "GERER_UTILISATEURS", peutAgir);
  await obtenirPrisma().$transaction(async (tx) => {
    const avant = await tx.utilisateur.findUnique({ where: { id }, include: { profil: true } });
    if (!avant) {
      throw new ErreurMetier("Utilisateur introuvable.");
    }
    const nouveauProfil = modifications.profil ?? avant.profil.code;
    const nouvelActif = modifications.actif ?? avant.actif;
    const nouveauNom = (modifications.nom ?? avant.nom).trim();
    if (!estCodeProfil(nouveauProfil)) {
      throw new ErreurMetier("Profil inconnu.");
    }
    verifierNomEtMotDePasse(avant.identifiant, nouveauNom, null);

    const retireAdmin = avant.actif && avant.profil.code === "ADMIN_SYSTEME" && (!nouvelActif || nouveauProfil !== "ADMIN_SYSTEME");
    if (retireAdmin && (await autresAdminsActifs(tx, id)) === 0) {
      throw new ErreurMetier("Il doit rester au moins un Admin système actif.");
    }
    if (id === acteur.id && !nouvelActif) {
      throw new ErreurMetier("Vous ne pouvez pas désactiver votre propre compte.");
    }

    const profil = await tx.profil.findUniqueOrThrow({ where: { code: nouveauProfil } });
    await tx.utilisateur.update({
      where: { id },
      data: { nom: nouveauNom, profilId: profil.id, actif: nouvelActif },
    });

    const action = avant.actif && !nouvelActif ? "UTILISATEUR_DESACTIVE" : !avant.actif && nouvelActif ? "UTILISATEUR_REACTIVE" : "UTILISATEUR_MODIFIE";
    await journaliser(
      {
        acteur: acteurAudit(acteur),
        action,
        objetType: "utilisateur",
        objetId: id,
        avant: { nom: avant.nom, profil: avant.profil.code, actif: avant.actif },
        apres: { nom: nouveauNom, profil: nouveauProfil, actif: nouvelActif },
        adresseIp,
      },
      tx,
    );
  });
}

/** Réinitialisation par l'Admin système : mot de passe provisoire, changement obligatoire à la prochaine connexion. */
export async function reinitialiserMotDePasse(
  acteur: UtilisateurCourant,
  id: number,
  nouveauMotDePasse: string,
  adresseIp: string | null,
): Promise<void> {
  await exigerNiveau(acteur, "GERER_UTILISATEURS", peutAgir);
  await obtenirPrisma().$transaction(async (tx) => {
    const cible = await tx.utilisateur.findUnique({ where: { id } });
    if (!cible) {
      throw new ErreurMetier("Utilisateur introuvable.");
    }
    verifierNomEtMotDePasse(cible.identifiant, cible.nom, nouveauMotDePasse);
    await tx.utilisateur.update({
      where: { id },
      data: {
        motDePasseHash: await hacherMotDePasse(nouveauMotDePasse),
        doitChangerMotDePasse: true,
        echecsConsecutifs: 0,
        verrouilleJusqua: null,
      },
    });
    await journaliser(
      { acteur: acteurAudit(acteur), action: "MOT_DE_PASSE_REINITIALISE", objetType: "utilisateur", objetId: id, adresseIp },
      tx,
    );
  });
}

/** Changement de son propre mot de passe (obligatoire après une création ou une réinitialisation). */
export async function changerMotDePasse(
  utilisateur: UtilisateurCourant,
  ancien: string,
  nouveau: string,
  adresseIp: string | null,
): Promise<void> {
  const prisma = obtenirPrisma();
  const enBase = await prisma.utilisateur.findUniqueOrThrow({ where: { id: utilisateur.id }, include: { profil: true } });
  if (ancien.length > MOT_DE_PASSE_LONGUEUR_MAX || !(await verifierMotDePasse(ancien, enBase.motDePasseHash))) {
    // Un mot de passe actuel faux compte comme un échec de connexion (verrouillage au 5e).
    await prisma.$transaction((tx) => enregistrerEchec(tx, enBase, adresseIp, new Date(), "MOT_DE_PASSE_CHANGE"));
    throw new ErreurMetier("Le mot de passe actuel est incorrect.");
  }
  if (nouveau === ancien) {
    throw new ErreurMetier("Le nouveau mot de passe doit être différent de l'ancien.");
  }
  verifierNomEtMotDePasse(utilisateur.identifiant, utilisateur.nom, nouveau);
  await prisma.$transaction(async (tx) => {
    await tx.utilisateur.update({
      where: { id: utilisateur.id },
      data: { motDePasseHash: await hacherMotDePasse(nouveau), doitChangerMotDePasse: false, echecsConsecutifs: 0 },
    });
    await journaliser(
      { acteur: acteurAudit(utilisateur), action: "MOT_DE_PASSE_CHANGE", objetType: "utilisateur", objetId: utilisateur.id, adresseIp },
      tx,
    );
  });
}
