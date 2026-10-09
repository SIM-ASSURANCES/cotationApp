import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import { journaliser, type ActeurAudit } from "./audit";
import { appelerGenerateur, ErreurDejaStocke } from "./generateur";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier } from "./types";

/**
 * Stockage des documents émis : UNE seule interface (CDC §14.3). Aujourd'hui, le volume persistant
 * du générateur (décision D11), en ajout seul : écrire un chemin qui existe déjà est refusé.
 *
 * Stockage indisponible (T14, adapté par D11, session 5a) : un document émis le RESTE. Son PDF est gardé en base
 * (table ecritures_differees, « en attente d'écriture »), l'administrateur est alerté (journal d'audit et bandeau),
 * et la file de tâches reprend l'écriture avec des délais croissants. Tant que l'écriture est différée, le document se
 * télécharge depuis la base (CDC §14.2 : « le document reste disponible dans l'application »).
 */
export type Stockage = {
  /** Écrit un nouveau fichier ; renvoie son empreinte SHA-256 calculée par le stockage. */
  ecrire(chemin: string, contenu: Uint8Array): Promise<{ empreinte: string }>;
  lire(chemin: string): Promise<Uint8Array>;
  /** Archive ZIP de fichiers stockés (nom dans l'archive pour chacun). */
  zip(fichiers: { chemin: string; nom: string }[]): Promise<Uint8Array>;
  /** Archive ZIP écrite directement dans le stockage (import en masse) ; à défaut, zip puis écrire. */
  zipStocker?(fichiers: { chemin: string; nom: string }[], chemin: string): Promise<{ empreinte: string; taille: number }>;
};

const DELAI_MS = 60_000;

const stockageGenerateur: Stockage = {
  async ecrire(chemin, contenu) {
    const reponse = await appelerGenerateur("/interne/stockage", { chemin, contenu: Buffer.from(contenu).toString("base64") }, DELAI_MS);
    const corps = (await reponse.json()) as { empreinte: string };
    return { empreinte: corps.empreinte };
  },
  async lire(chemin) {
    const reponse = await appelerGenerateur(`/interne/stockage?chemin=${encodeURIComponent(chemin)}`, undefined, DELAI_MS);
    return new Uint8Array(await reponse.arrayBuffer());
  },
  async zip(fichiers) {
    const reponse = await appelerGenerateur("/interne/stockage/zip", { fichiers }, DELAI_MS * 5);
    return new Uint8Array(await reponse.arrayBuffer());
  },
  async zipStocker(fichiers, chemin) {
    const reponse = await appelerGenerateur("/interne/stockage/zip/stocker", { fichiers, chemin }, DELAI_MS * 10);
    const corps = (await reponse.json()) as { empreinte: string; taille: number };
    return { empreinte: corps.empreinte, taille: corps.taille };
  },
};

let courant: Stockage = stockageGenerateur;

export const stockage = (): Stockage => courant;

/** Tests seulement : remplace le stockage (null : rétablit le vrai). */
export function remplacerStockage(s: Stockage | null): void {
  courant = s ?? stockageGenerateur;
}

const sha256 = (octets: Uint8Array) => createHash("sha256").update(octets).digest("hex");
const message = (erreur: unknown) => (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 1000);

/** Archive ZIP stockée (import en masse) : par le générateur, ou zip puis écriture si le stockage ne sait pas faire mieux. */
export async function zipStocker(fichiers: { chemin: string; nom: string }[], chemin: string): Promise<{ empreinte: string; taille: number }> {
  const s = stockage();
  if (s.zipStocker) return s.zipStocker(fichiers, chemin);
  const contenu = await s.zip(fichiers);
  const { empreinte } = await s.ecrire(chemin, contenu);
  return { empreinte, taille: contenu.byteLength };
}

// ---------------------------------------------------------------- Écriture d'un document émis, différée si besoin (T14)

export type IssueEcriture = { ecrit: true } | { ecrit: false; erreur: string };

/**
 * Tente d'écrire le PDF d'un document qui va être émis. Une indisponibilité du stockage (générateur injoignable,
 * disque plein, erreur du serveur…) n'empêche pas l'émission : elle est renvoyée pour que l'appelant DIFFÈRE
 * l'écriture. Restent bloquants : un chemin déjà pris (ajout seul) et une empreinte différente (fichier altéré).
 */
export async function tenterEcriture(chemin: string, contenu: Uint8Array, empreinte: string): Promise<IssueEcriture> {
  let ecrit: { empreinte: string };
  try {
    ecrit = await stockage().ecrire(chemin, contenu);
  } catch (erreur) {
    if (erreur instanceof ErreurDejaStocke) throw erreur;
    console.error(`[stockage] écriture de ${chemin} différée : ${message(erreur)}`);
    return { ecrit: false, erreur: message(erreur) };
  }
  if (ecrit.empreinte !== empreinte) throw new Error(`Stockage : empreinte différente pour ${chemin}`);
  return { ecrit: true };
}

/**
 * DANS la transaction qui inscrit le document émis : garde son PDF « en attente d'écriture » et alerte l'administrateur
 * (journal d'audit, action ECRITURE_PARTAGE_ECHEC du CDC §15.4). Après la transaction, appeler `programmerReprise`.
 */
export async function differerEcriture(
  tx: Prisma.TransactionClient,
  d: { documentId: number; numero: string; version: number; chemin: string; empreinte: string; contenu: Uint8Array; erreur: string },
  acteur: ActeurAudit | null,
  adresseIp: string | null,
): Promise<void> {
  await tx.ecritureDifferee.create({
    data: { documentId: d.documentId, chemin: d.chemin, empreinte: d.empreinte, contenu: Buffer.from(d.contenu), derniereErreur: d.erreur },
  });
  await journaliser(
    { acteur, action: "ECRITURE_PARTAGE_ECHEC", objetType: "document", objetId: d.documentId, apres: { numero: d.numero, version: d.version, chemin: d.chemin, erreur: d.erreur.slice(0, 300) }, adresseIp },
    tx,
  );
}

/**
 * Après la transaction : confie la reprise à la file de tâches (délais croissants). Si la file est elle-même
 * injoignable, rien n'est perdu : le travailleur reprogramme toutes les écritures différées à son démarrage, et
 * l'administrateur peut relancer depuis son écran.
 */
export async function programmerReprise(documentId: number): Promise<void> {
  try {
    const { enfilerEcriture } = await import("./taches");
    await enfilerEcriture(documentId);
  } catch (erreur) {
    console.error(`[stockage] reprise du document ${documentId} non programmée (file de tâches indisponible) : ${message(erreur)}`);
  }
}

export type IssueReprise = "ECRITE" | "DEJA_ECRITE";

/**
 * Reprise d'une écriture différée (tâche de la file). Lève une erreur si le stockage est encore indisponible : la file
 * retentera plus tard, avec un délai plus long. Un fichier déjà présent au même chemin (écriture réussie dont la
 * réponse s'est perdue) est accepté s'il a la même empreinte.
 */
export async function reprendreEcriture(documentId: number): Promise<IssueReprise | null> {
  const prisma = obtenirPrisma();
  const e = await prisma.ecritureDifferee.findUnique({ where: { documentId }, include: { document: { select: { numero: true, version: true } } } });
  if (!e) return null;
  let issue: IssueReprise;
  try {
    try {
      const ecrit = await stockage().ecrire(e.chemin, e.contenu);
      if (ecrit.empreinte !== e.empreinte) throw new ErreurMetier(`Stockage : empreinte différente pour ${e.chemin}`);
      issue = "ECRITE";
    } catch (erreur) {
      if (!(erreur instanceof ErreurDejaStocke)) throw erreur;
      if (sha256(await stockage().lire(e.chemin)) !== e.empreinte) throw new ErreurMetier(`Un autre fichier occupe déjà ${e.chemin} : vérification manuelle nécessaire.`);
      issue = "DEJA_ECRITE";
    }
  } catch (erreur) {
    await prisma.ecritureDifferee.update({ where: { id: e.id }, data: { tentatives: { increment: 1 }, derniereErreur: message(erreur), dernierEssai: new Date() } });
    throw erreur;
  }
  await prisma.$transaction(async (tx) => {
    await tx.ecritureDifferee.delete({ where: { id: e.id } });
    await journaliser(
      { acteur: null, action: "ECRITURE_REPRISE", objetType: "document", objetId: documentId, apres: { numero: e.document.numero, version: e.document.version, chemin: e.chemin, tentatives: e.tentatives + 1, issue } },
      tx,
    );
  });
  return issue;
}

/**
 * Lit le PDF d'un document émis et vérifie son intégrité (empreinte, CDC §14.3) : depuis le stockage, ou depuis la
 * base tant que son écriture est différée (T14).
 */
export async function lireDocumentEmis(d: { id: number; numero: string; version: number; chemin: string; empreinte: string }): Promise<Uint8Array> {
  const differee = await obtenirPrisma().ecritureDifferee.findUnique({ where: { documentId: d.id }, select: { contenu: true } });
  const contenu = differee ? new Uint8Array(differee.contenu) : await stockage().lire(d.chemin);
  if (sha256(contenu) !== d.empreinte) {
    console.error(`[documents] empreinte différente pour ${d.chemin}`);
    throw new ErreurMetier(`Le fichier stocké du document ${d.numero} (v${d.version}) ne correspond plus à son empreinte : prévenez l'administrateur.`);
  }
  return contenu;
}

/** Documents (identifiants) dont l'écriture est encore différée, parmi ceux donnés (tous si aucun n'est donné). */
export async function ecrituresDifferees(documentIds?: number[]): Promise<Set<number>> {
  const lignes = await obtenirPrisma().ecritureDifferee.findMany({ where: documentIds ? { documentId: { in: documentIds } } : {}, select: { documentId: true } });
  return new Set(lignes.map((l) => l.documentId));
}

export type EtatStockage = {
  enAttente: number;
  plusAncienne: Date | null;
  derniereErreur: string | null;
  lignes: { documentId: number; numero: string; version: number; chemin: string; tentatives: number; creeLe: Date; dernierEssai: Date; derniereErreur: string }[];
};

/** État des écritures différées (bandeau et écran de l'administrateur). */
export async function etatStockage(): Promise<EtatStockage> {
  const lignes = await obtenirPrisma().ecritureDifferee.findMany({
    orderBy: { creeLe: "asc" },
    take: 200,
    select: { documentId: true, chemin: true, tentatives: true, creeLe: true, dernierEssai: true, derniereErreur: true, document: { select: { numero: true, version: true } } },
  });
  const enAttente = await obtenirPrisma().ecritureDifferee.count();
  const derniere = [...lignes].sort((a, b) => b.dernierEssai.getTime() - a.dernierEssai.getTime())[0];
  return {
    enAttente,
    plusAncienne: lignes[0]?.creeLe ?? null,
    derniereErreur: derniere?.derniereErreur ?? null,
    lignes: lignes.map((l) => ({ documentId: l.documentId, numero: l.document.numero, version: l.document.version, chemin: l.chemin, tentatives: l.tentatives, creeLe: l.creeLe, dernierEssai: l.dernierEssai, derniereErreur: l.derniereErreur })),
  };
}
