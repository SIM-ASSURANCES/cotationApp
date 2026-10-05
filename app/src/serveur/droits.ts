import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  ACTIONS,
  PROFILS,
  droitsParDefaut,
  estCodeAction,
  estCodeNiveau,
  estCodeProfil,
  modificationDroitInterdite,
  type CodeAction,
  type CodeNiveau,
  type CodeProfil,
  type MatriceDroits,
} from "@/domaine/droits";

import { journaliser } from "./audit";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

type ClientPrisma = PrismaClient | Prisma.TransactionClient;

/**
 * Matrice des droits en vigueur : la matrice du CDC, surchargée par les lignes de la base
 * (modifiables par l'Admin système).
 */
export async function lireMatrice(client: ClientPrisma = obtenirPrisma()): Promise<MatriceDroits> {
  const matrice = droitsParDefaut();
  const lignes = await client.profilDroit.findMany({ include: { profil: { select: { code: true } } } });
  for (const ligne of lignes) {
    if (estCodeProfil(ligne.profil.code) && estCodeAction(ligne.action) && estCodeNiveau(ligne.niveau)) {
      matrice[ligne.profil.code][ligne.action] = ligne.niveau;
    }
  }
  return matrice;
}

export async function niveauDuProfil(profil: CodeProfil, action: CodeAction): Promise<CodeNiveau> {
  const ligne = await obtenirPrisma().profilDroit.findFirst({
    where: { action, profil: { code: profil } },
    select: { niveau: true },
  });
  return ligne && estCodeNiveau(ligne.niveau) ? ligne.niveau : droitsParDefaut()[profil][action];
}

/**
 * Vérifie, au plus près de la donnée, que l'utilisateur a le niveau voulu sur l'action.
 * `acceptable` est un des prédicats de domaine/droits.ts (peutLire, peutAgir, peutValider).
 */
export async function exigerNiveau(
  utilisateur: Pick<UtilisateurCourant, "profil">,
  action: CodeAction,
  acceptable: (niveau: CodeNiveau) => boolean,
): Promise<CodeNiveau> {
  const niveau = await niveauDuProfil(utilisateur.profil, action);
  if (!acceptable(niveau)) {
    throw new ErreurAcces(`Droit insuffisant : ${action}`);
  }
  return niveau;
}

/** Modifie un droit (Admin système) ; journalisé dans la même transaction. */
export async function enregistrerDroit(
  acteur: UtilisateurCourant,
  modification: { profil: string; action: string; niveau: string },
  adresseIp: string | null,
): Promise<boolean> {
  const { profil, action, niveau } = modification;
  if (!estCodeProfil(profil) || !estCodeAction(action) || !estCodeNiveau(niveau)) {
    throw new ErreurMetier("Droit inconnu.");
  }
  await exigerNiveau(acteur, "GERER_UTILISATEURS", (n) => n === "OUI");
  const interdit = modificationDroitInterdite(profil, action, niveau);
  if (interdit) {
    throw new ErreurMetier(interdit);
  }

  return obtenirPrisma().$transaction(async (tx) => {
    const enregistre = await tx.profil.findUniqueOrThrow({
      where: { code: profil },
      select: { id: true, droits: { where: { action }, select: { niveau: true } } },
    });
    const avant = enregistre.droits[0]?.niveau ?? droitsParDefaut()[profil][action];
    if (avant === niveau) {
      return false;
    }
    await tx.profilDroit.upsert({
      where: { profilId_action: { profilId: enregistre.id, action } },
      create: { profilId: enregistre.id, action, niveau },
      update: { niveau },
    });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "DROIT_MODIFIE",
        objetType: "profil",
        objetId: profil,
        avant: { action, niveau: avant },
        apres: { action, niveau },
        adresseIp,
      },
      tx,
    );
    return true;
  });
}

/**
 * Crée les profils du CDC et leurs droits par défaut. Idempotent : ne touche jamais aux droits
 * déjà en base, pour ne pas écraser les réglages de l'administrateur à chaque déploiement.
 */
export async function initialiserProfilsEtDroits(
  client: ClientPrisma = obtenirPrisma(),
): Promise<{ profilsCrees: number; droitsCrees: number }> {
  const defauts = droitsParDefaut();
  let profilsCrees = 0;
  let droitsCrees = 0;
  for (const profil of PROFILS) {
    const existant = await client.profil.findUnique({ where: { code: profil.code } });
    const enregistre =
      existant ??
      (await client.profil.create({ data: { code: profil.code, libelle: profil.libelle } }));
    if (!existant) {
      profilsCrees += 1;
    }
    const resultat = await client.profilDroit.createMany({
      data: ACTIONS.map((a) => ({ profilId: enregistre.id, action: a.code, niveau: defauts[profil.code][a.code] })),
      skipDuplicates: true,
    });
    droitsCrees += resultat.count;
  }
  return { profilsCrees, droitsCrees };
}
