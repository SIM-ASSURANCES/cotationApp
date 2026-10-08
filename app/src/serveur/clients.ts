import "server-only";

import { peutAgir, peutLire } from "@/domaine/droits";
import { problemesSouscripteur, type Souscripteur } from "@/domaine/cotation/saisie";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

const auteur = (u: UtilisateurCourant) => ({ id: u.id, identifiant: u.identifiant });

export type LigneClient = { id: number; souscripteur: Souscripteur };

/** Colonnes d'un client utiles au souscripteur (les compléments sont ceux du dictionnaire §6.3.2, session 4a). */
type ColonnesClient = {
  type: string; nom: string; prenoms: string; raisonSociale: string; telephone: string; email: string; adresse: string;
  numIdentification: string; dateNaissance: Date | null; lieuNaissance: string; profession: string; activite: string; employeur: string;
  bp: string; localite: string; sousPrefecture: string; whatsapp: string; mobileMoney: string; situationMatrimoniale: string;
  nbEnfants: number | null; groupeSanguin: string;
};

/**
 * Un client enregistré est un souscripteur dont les compléments ont été SAISIS (vides s'il n'y avait rien
 * à saisir) : ils sont donc toujours présents ici, contrairement à une cotation d'avant la 4a (D19, D22).
 */
export function versSouscripteur(c: ColonnesClient): Souscripteur {
  return {
    type: c.type === "MORALE" ? "MORALE" : "PHYSIQUE",
    nom: c.nom,
    prenoms: c.prenoms,
    raison_sociale: c.raisonSociale,
    telephone: c.telephone,
    email: c.email,
    adresse: c.adresse,
    num_identification: c.numIdentification,
    date_naissance: c.dateNaissance ? c.dateNaissance.toISOString().slice(0, 10) : "",
    lieu_naissance: c.lieuNaissance,
    profession: c.profession,
    activite: c.activite,
    employeur: c.employeur,
    bp: c.bp,
    localite: c.localite,
    sous_prefecture: c.sousPrefecture,
    whatsapp: c.whatsapp,
    mobile_money: c.mobileMoney,
    situation_matrimoniale: c.situationMatrimoniale,
    nb_enfants: c.nbEnfants,
    groupe_sanguin: c.groupeSanguin,
  };
}

export async function listerClients(acteur: UtilisateurCourant): Promise<LigneClient[]> {
  if (!peutLire(await niveauDuProfil(acteur.profil, "CREER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : clients.");
  }
  const clients = await obtenirPrisma().client.findMany({ orderBy: [{ nom: "asc" }, { raisonSociale: "asc" }], take: 500 });
  return clients.map((c) => ({ id: c.id, souscripteur: versSouscripteur(c) }));
}

export async function creerClient(acteur: UtilisateurCourant, s: Souscripteur, adresseIp: string | null): Promise<number> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, "CREER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : création de client.");
  }
  const problemes = problemesSouscripteur(s, aujourdhui());
  if (problemes.length > 0) {
    throw new ErreurMetier(problemes.join(" "));
  }
  return obtenirPrisma().$transaction(async (tx) => {
    const cree = await tx.client.create({
      data: {
        type: s.type,
        nom: s.nom.trim(),
        prenoms: s.prenoms.trim(),
        raisonSociale: s.raison_sociale.trim(),
        telephone: s.telephone.trim(),
        email: s.email.trim(),
        adresse: s.adresse.trim(),
        numIdentification: (s.num_identification ?? "").trim(),
        dateNaissance: s.date_naissance ? new Date(`${s.date_naissance}T00:00:00.000Z`) : null,
        lieuNaissance: (s.lieu_naissance ?? "").trim(),
        profession: (s.profession ?? "").trim(),
        activite: (s.activite ?? "").trim(),
        employeur: (s.employeur ?? "").trim(),
        bp: (s.bp ?? "").trim(),
        localite: (s.localite ?? "").trim(),
        sousPrefecture: (s.sous_prefecture ?? "").trim(),
        whatsapp: (s.whatsapp ?? "").trim(),
        mobileMoney: (s.mobile_money ?? "").trim(),
        situationMatrimoniale: (s.situation_matrimoniale ?? "").trim(),
        nbEnfants: s.nb_enfants ?? null,
        groupeSanguin: (s.groupe_sanguin ?? "").trim(),
        creePar: acteur.identifiant,
      },
    });
    await journaliser({ acteur: auteur(acteur), action: "CLIENT_CREE", objetType: "client", objetId: cree.id, apres: { ...s }, adresseIp }, tx);
    return cree.id;
  });
}

// ---------------------------------------------------------------- Motifs de refus

export const MOTIFS_REFUS_PAR_DEFAUT = [
  { code: "PRIX_TROP_ELEVE", libelle: "Prix trop élevé" },
  { code: "OFFRE_CONCURRENTE", libelle: "Offre concurrente retenue" },
  { code: "GARANTIES_INSUFFISANTES", libelle: "Garanties insuffisantes" },
  { code: "BESOIN_ABANDONNE", libelle: "Besoin abandonné" },
  { code: "AUTRE", libelle: "Autre motif" },
] as const;

/** Crée les motifs par défaut sans toucher à ceux que l'administrateur a modifiés. Idempotent. */
export async function initialiserMotifsRefus(): Promise<number> {
  const resultat = await obtenirPrisma().motifRefus.createMany({ data: [...MOTIFS_REFUS_PAR_DEFAUT], skipDuplicates: true });
  return resultat.count;
}

export async function listerMotifsRefus(options: { actifsSeulement: boolean } = { actifsSeulement: true }) {
  return obtenirPrisma().motifRefus.findMany({
    where: options.actifsSeulement ? { actif: true } : {},
    orderBy: { libelle: "asc" },
    select: { code: true, libelle: true, actif: true },
  });
}

export async function creerMotifRefus(acteur: UtilisateurCourant, saisie: { code: string; libelle: string }, adresseIp: string | null): Promise<void> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, "PARAMETRER_PRODUITS"))) {
    throw new ErreurAcces("Droit insuffisant : motifs de refus.");
  }
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(saisie.code) || saisie.libelle.trim() === "") {
    throw new ErreurMetier("Code (majuscules, chiffres et _) et libellé obligatoires.");
  }
  await obtenirPrisma().$transaction(async (tx) => {
    if (await tx.motifRefus.findUnique({ where: { code: saisie.code } })) {
      throw new ErreurMetier("Ce motif existe déjà.");
    }
    const cree = await tx.motifRefus.create({ data: { code: saisie.code, libelle: saisie.libelle.trim() } });
    await journaliser({ acteur: auteur(acteur), action: "MOTIF_REFUS_CREE", objetType: "motif_refus", objetId: cree.id, apres: { ...saisie }, adresseIp }, tx);
  });
}
