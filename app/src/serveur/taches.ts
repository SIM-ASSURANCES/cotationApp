import "server-only";

import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

import { obtenirConfig } from "./config";
import { ErreurMetier } from "./types";

/**
 * File de tâches (CDC §15.1, décision D24) : BullMQ sur le Redis du Docker Compose. L'application ENFILE ; le service
 * `travailleur` (scripts/travailleur.mts, même image, même code serveur/) EXÉCUTE. Quatre files :
 *   - « imports » : traitement d'un lot d'import en masse (un lot à la fois ; le lot convertit lui-même
 *     CONVERSIONS_SIMULTANEES certificats en parallèle) ;
 *   - « stockage » : reprise des écritures différées (T14), avec des délais croissants ;
 *   - « echeances » : lot d'avis d'échéance et de relances (session 5b) ;
 *   - « quotidien » : tâche planifiée chaque matin qui établit la liste du jour des avis et relances (session 5b).
 *
 * Une tâche est REJOUABLE sans effet de bord : son identifiant est stable (« lot-12 », « ecriture-345 ») et son
 * traitement ne refait que ce qui manque (un certificat par adhérent, garanti par la base ; une ligne d'écriture
 * différée supprimée une fois écrite). Relancer une tâche interrompue ne crée jamais de document en double.
 */

export const FILE_IMPORTS = "imports";
export const FILE_STOCKAGE = "stockage";
export const FILE_ECHEANCES = "echeances";
export const FILE_QUOTIDIEN = "quotidien";

/** Liste du jour des avis et relances : chaque matin à 6 h, heure d'Abidjan (UTC). */
export const PLANIFICATION_LISTE = { pattern: "0 6 * * *", tz: "Africa/Abidjan" };

/** Reprise des écritures différées : 1er essai après 30 s, puis délai doublé à chaque échec (≈ 17 h au 12e). */
export const REPRISE = { tentatives: 12, delaiMs: 30_000 };

/** Tests seulement : délais plus courts. */
export function reglerReprise(r: Partial<typeof REPRISE>): void {
  Object.assign(REPRISE, r);
}

export function connexionRedis(): ConnectionOptions {
  const url = obtenirConfig().REDIS_URL;
  if (!url) throw new ErreurMetier("File de tâches non configurée (variable REDIS_URL) : prévenez l'administrateur.");
  // maxRetriesPerRequest: null : exigé par BullMQ pour un travailleur (les commandes bloquantes attendent Redis).
  return { url, maxRetriesPerRequest: null };
}

const files = new Map<string, Queue>();

function file(nom: string): Queue {
  let f = files.get(nom);
  if (!f) {
    // enableOfflineQueue: false : si Redis est arrêté, l'ajout échoue tout de suite au lieu d'attendre indéfiniment.
    f = new Queue(nom, { connection: { ...connexionRedis(), maxRetriesPerRequest: 1, enableOfflineQueue: false } });
    f.on("error", (e) => console.error(`[taches] file ${nom} : ${e.message}`));
    files.set(nom, f);
  }
  return f;
}

/** Une tâche terminée ou abandonnée libère son identifiant : elle pourra être enfilée de nouveau (relance). */
const commun: JobsOptions = { removeOnComplete: true, removeOnFail: true };

/** Traitement d'un lot d'import confirmé (une seule tâche par lot à la fois : identifiant stable). */
export async function enfilerLot(lotId: number): Promise<void> {
  await file(FILE_IMPORTS).add("lot", { lotId }, { ...commun, jobId: `lot-${lotId}`, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
}

/** Lot d'avis et de relances (identifiant stable : enfiler deux fois ne crée qu'une tâche). */
export async function enfilerLotEcheances(lotId: number): Promise<void> {
  await file(FILE_ECHEANCES).add("lot", { lotId }, { ...commun, jobId: `echeances-${lotId}`, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
}

/** Planifie (ou met à jour) la tâche quotidienne de la liste du jour : une seule planification, quel que soit le nombre de démarrages. */
export async function planifierListeDuJour(): Promise<void> {
  await file(FILE_QUOTIDIEN).upsertJobScheduler("liste-echeances", PLANIFICATION_LISTE, { name: "liste", data: {}, opts: { removeOnComplete: true, removeOnFail: true } });
}

/**
 * Reprise de l'écriture différée d'un document (T14). `immediat` (« Relancer maintenant » de l'administrateur) : une
 * reprise déjà programmée plus tard est avancée à tout de suite.
 */
export async function enfilerEcriture(documentId: number, options: { immediat?: boolean } = {}): Promise<void> {
  const jobId = `ecriture-${documentId}`;
  if (options.immediat) {
    const existante = await file(FILE_STOCKAGE).getJob(jobId);
    if (existante && (await existante.isDelayed())) {
      await existante.promote();
      return;
    }
  }
  await file(FILE_STOCKAGE).add(
    "ecriture",
    { documentId },
    { ...commun, jobId, delay: options.immediat ? 0 : REPRISE.delaiMs, attempts: REPRISE.tentatives, backoff: { type: "exponential", delay: REPRISE.delaiMs } },
  );
}

/** Ferme les connexions des files (fin d'un script ou d'un test). */
export async function fermerFiles(): Promise<void> {
  await Promise.all([...files.values()].map((f) => f.close()));
  files.clear();
}

/** Tests seulement : vide une file. */
export async function viderFile(nom: string): Promise<void> {
  await file(nom).obliterate({ force: true });
}
