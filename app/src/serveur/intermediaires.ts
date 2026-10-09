import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { peutAgir, peutLire, type CodeAction } from "@/domaine/droits";
import {
  normaliserChoixIntermediaires,
  problemesChoixIntermediaires,
  problemesIntermediaire,
  type IntermediaireDocument,
  type IntermediaireSaisi,
} from "@/domaine/intermediaires";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Référentiel des intermédiaires (CDC §10.1, session 6.0, H71 fermée). Même droit que le paramétrage des produits :
 * la Technique écrit, les profils qui créent des cotations consultent (pour choisir). Un code ne change jamais et ne se
 * supprime pas : l'intermédiaire se désactive, et ses cotations le gardent.
 */

const ACTION: CodeAction = "PARAMETRER_PRODUITS";

export type LigneIntermediaire = IntermediaireSaisi & { id: number; actif: boolean; creePar: string; creeLe: Date };

async function exigerEcriture(acteur: UtilisateurCourant): Promise<void> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, ACTION))) throw new ErreurAcces("Droit insuffisant : référentiel des intermédiaires.");
}

async function exigerConsultation(acteur: UtilisateurCourant): Promise<void> {
  const [parametrage, cotation] = await Promise.all([niveauDuProfil(acteur.profil, ACTION), niveauDuProfil(acteur.profil, "CREER_COTATION")]);
  if (!peutLire(parametrage) && !peutLire(cotation)) throw new ErreurAcces("Droit insuffisant : consultation des intermédiaires.");
}

const refuser = (problemes: string[]) => {
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
};

/** Tout le référentiel (actifs d'abord), ou les seuls actifs (liste de choix d'une cotation). */
export async function listerIntermediaires(acteur: UtilisateurCourant, filtre: { actifsSeulement?: boolean } = {}): Promise<LigneIntermediaire[]> {
  await exigerConsultation(acteur);
  const lignes = await obtenirPrisma().intermediaire.findMany({ where: filtre.actifsSeulement ? { actif: true } : {}, orderBy: [{ actif: "desc" }, { nom: "asc" }] });
  return lignes.map((i) => ({ id: i.id, code: i.code, nom: i.nom, role: i.role, actif: i.actif, creePar: i.creePar, creeLe: i.creeLe }));
}

export async function creerIntermediaire(acteur: UtilisateurCourant, saisie: IntermediaireSaisi, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  const donnees = { code: saisie.code.trim().toUpperCase(), nom: saisie.nom.trim(), role: saisie.role.trim() };
  refuser(problemesIntermediaire(donnees));
  try {
    await obtenirPrisma().$transaction(async (tx) => {
      const cree = await tx.intermediaire.create({ data: { ...donnees, creePar: acteur.identifiant } });
      await journaliser({ acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "INTERMEDIAIRE_CREE", objetType: "intermediaire", objetId: cree.code, apres: { ...donnees, actif: true }, adresseIp }, tx);
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") throw new ErreurMetier(`L'intermédiaire « ${donnees.code} » existe déjà.`);
    throw erreur;
  }
}

/** Nom, rôle et état actif (journalisé, avant/après). Les cotations déjà saisies gardent leur copie (T10). */
export async function modifierIntermediaire(acteur: UtilisateurCourant, code: string, modif: { nom: string; role: string; actif: boolean }, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  const apres = { nom: modif.nom.trim(), role: modif.role.trim(), actif: modif.actif };
  refuser(problemesIntermediaire({ code, nom: apres.nom, role: apres.role }));
  await obtenirPrisma().$transaction(async (tx) => {
    const avant = await tx.intermediaire.findUnique({ where: { code } });
    if (!avant) throw new ErreurMetier(`Intermédiaire « ${code} » introuvable.`);
    if (avant.nom === apres.nom && avant.role === apres.role && avant.actif === apres.actif) return;
    await tx.intermediaire.update({ where: { code }, data: apres });
    await journaliser(
      { acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "INTERMEDIAIRE_MODIFIE", objetType: "intermediaire", objetId: code, avant: { nom: avant.nom, role: avant.role, actif: avant.actif }, apres, adresseIp },
      tx,
    );
  });
}

/** Intermédiaire choisi, copié pour la cotation. */
export type ChoixIntermediaire = IntermediaireDocument & { intermediaireId: number };

/**
 * Choix des intermédiaires d'une cotation (0 à 2) : chaque code doit exister et être actif, sauf s'il était déjà choisi
 * sur cette cotation (un intermédiaire désactivé depuis ne fait pas refuser la modification d'un brouillon).
 */
export async function resoudreIntermediaires(tx: Prisma.TransactionClient, codesSaisis: readonly string[], dejaChoisis: readonly string[] = []): Promise<ChoixIntermediaire[]> {
  const codes = normaliserChoixIntermediaires(codesSaisis);
  refuser(problemesChoixIntermediaires(codes));
  const trouves = await tx.intermediaire.findMany({ where: { code: { in: codes } } });
  return codes.map((code) => {
    const i = trouves.find((t) => t.code === code);
    if (!i) throw new ErreurMetier(`Intermédiaire « ${code} » inconnu : ajoutez-le d'abord au référentiel (écran « Intermédiaires »).`);
    if (!i.actif && !dejaChoisis.includes(code)) throw new ErreurMetier(`L'intermédiaire « ${code} » est désactivé : il ne peut plus être choisi.`);
    return { intermediaireId: i.id, code: i.code, nom: i.nom, role: i.role };
  });
}

/** Remplace les intermédiaires d'une cotation (brouillon), dans l'ordre du choix. */
export async function ecrireIntermediaires(tx: Prisma.TransactionClient, cotationId: number, choix: readonly ChoixIntermediaire[]): Promise<void> {
  await tx.cotationIntermediaire.deleteMany({ where: { cotationId } });
  if (choix.length > 0) await tx.cotationIntermediaire.createMany({ data: choix.map((c, i) => ({ cotationId, ordre: i + 1, ...c })) });
}

/** Intermédiaires d'une cotation pour les documents (`intermediaires[]`), dans l'ordre du choix. */
export const versIntermediairesDocument = (lignes: readonly { ordre: number; nom: string; code: string; role: string }[]): IntermediaireDocument[] =>
  [...lignes].sort((a, b) => a.ordre - b.ordre).map((l) => ({ nom: l.nom, code: l.code, role: l.role }));
