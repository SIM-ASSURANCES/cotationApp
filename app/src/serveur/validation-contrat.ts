import "server-only";

import type { ValidationContrat } from "@/generated/prisma/client";

import { validationContratRequise } from "@/domaine/cotation/validation";
import { peutLire } from "@/domaine/droits";

import { journaliser, type ActeurAudit } from "./audit";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Validation de l'émission d'un contrat (CDC §4 « Oui (sous seuil) », §4.1, D22).
 *
 * Un profil dont le droit « Émettre un contrat » est « Oui (sous seuil) » (le Gestionnaire production par défaut) ne
 * peut pas émettre les conditions particulières d'un contrat dont le TTC dépasse le seuil du produit : sa demande est
 * enregistrée « À valider ». Un profil « Oui » (la Technique par défaut) qui n'est pas le demandeur émet alors le
 * contrat, ce qui vaut validation. Le seuil est celui de la version du produit utilisée par la cotation.
 */

const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });

export type ControleSeuil = { requise: boolean; ttc: string; seuil: string | null };

/** Faut-il une validation pour que CET acteur émette CE contrat ? (TTC de la police, seuil de la version du produit.) */
export async function controlerSeuilContrat(acteur: UtilisateurCourant, police: { ttcTotal: { toFixed(): string } }, cotation: { produitId: number; versionDateEffet: Date }): Promise<ControleSeuil> {
  const version = await obtenirPrisma().produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId: cotation.produitId, dateEffet: cotation.versionDateEffet } },
    select: { seuilValidationTtc: true },
  });
  const ttc = police.ttcTotal.toFixed();
  const seuil = version.seuilValidationTtc ? version.seuilValidationTtc.toFixed() : null;
  const niveau = await niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT");
  return { requise: validationContratRequise(niveau, ttc, seuil), ttc, seuil };
}

export type ValidationLue = {
  id: number;
  statut: "A_VALIDER" | "VALIDEE";
  ttc: string;
  seuil: string;
  demandeePar: string;
  demandeeLe: Date;
  validee: { par: string; le: Date } | null;
};

const lue = (v: ValidationContrat): ValidationLue => ({
  id: v.id,
  statut: v.statut as ValidationLue["statut"],
  ttc: v.ttc.toFixed(),
  seuil: v.seuil.toFixed(),
  demandeePar: v.demandeParIdentifiant,
  demandeeLe: v.demandeLe,
  validee: v.valideParIdentifiant && v.valideLe ? { par: v.valideParIdentifiant, le: v.valideLe } : null,
});

const derniere = (policeId: number) => obtenirPrisma().validationContrat.findFirst({ where: { policeId }, orderBy: { id: "desc" } });

export type EtatValidationContrat = {
  /** Dernière demande de validation de la police, s'il y en a une. */
  validation: ValidationLue | null;
  /** Pour CET acteur : l'émission passerait-elle par une validation ? */
  requise: boolean;
  ttc: string;
  seuil: string | null;
};

/** État de la validation de l'émission du contrat d'une cotation acceptée (fiche de la cotation) ; null sans police. */
export async function lireValidationContrat(acteur: UtilisateurCourant, cotationId: number): Promise<EtatValidationContrat | null> {
  if (!peutLire(await niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT"))) throw new ErreurAcces("Droit insuffisant : validation de contrat.");
  const police = await obtenirPrisma().police.findUnique({ where: { cotationId }, include: { cotation: { select: { produitId: true, versionDateEffet: true } } } });
  if (!police) return null;
  const controle = await controlerSeuilContrat(acteur, police, police.cotation);
  const v = await derniere(police.id);
  return { validation: v ? lue(v) : null, requise: controle.requise, ttc: controle.ttc, seuil: controle.seuil };
}

/** Enregistre la demande « À valider » (une seule ouverte par police : une demande répétée renvoie la même). */
export async function demanderValidationContrat(acteur: UtilisateurCourant, policeId: number, numeroPolice: string, controle: ControleSeuil, adresseIp: string | null): Promise<ValidationLue> {
  const prisma = obtenirPrisma();
  return prisma.$transaction(async (tx) => {
    const ouverte = await tx.validationContrat.findFirst({ where: { policeId, statut: "A_VALIDER" } });
    if (ouverte) return lue(ouverte);
    const creee = await tx.validationContrat.create({
      data: { policeId, ttc: controle.ttc, seuil: controle.seuil ?? "0", statut: "A_VALIDER", demandeParId: acteur.id, demandeParIdentifiant: acteur.identifiant },
    });
    await journaliser(
      { acteur: auteur(acteur), action: "CONTRAT_A_VALIDER", objetType: "police", objetId: policeId, apres: { police: numeroPolice, ttc: controle.ttc, seuil: controle.seuil }, adresseIp },
      tx,
    );
    return lue(creee);
  });
}

/**
 * Avant l'émission par un profil « Oui » : le demandeur d'une validation ne la décide jamais lui-même (CDC §4.1,
 * séparation des tâches), même si ses droits ont changé depuis.
 */
export async function exigerAutreQueLeDemandeur(acteur: UtilisateurCourant, policeId: number): Promise<void> {
  const ouverte = await obtenirPrisma().validationContrat.findFirst({ where: { policeId, statut: "A_VALIDER" } });
  if (ouverte && ouverte.demandeParId === acteur.id) {
    throw new ErreurMetier("Vous avez demandé la validation de ce contrat : un autre valideur doit l'émettre (séparation des tâches).");
  }
}

/** Après l'émission : la demande ouverte, s'il y en a une, est validée par l'émetteur. */
export async function cloreValidationContrat(acteur: UtilisateurCourant, policeId: number, numeroPolice: string, adresseIp: string | null): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    const ouverte = await tx.validationContrat.findFirst({ where: { policeId, statut: "A_VALIDER" } });
    if (!ouverte) return;
    await tx.validationContrat.update({ where: { id: ouverte.id }, data: { statut: "VALIDEE", valideParId: acteur.id, valideParIdentifiant: acteur.identifiant, valideLe: new Date() } });
    await journaliser(
      { acteur: auteur(acteur), action: "CONTRAT_VALIDE", objetType: "police", objetId: policeId, apres: { police: numeroPolice, demandePar: ouverte.demandeParIdentifiant, ttc: ouverte.ttc.toFixed() }, adresseIp },
      tx,
    );
  });
}
