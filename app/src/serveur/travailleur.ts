import "server-only";

import { Worker } from "bullmq";

import { etablirListeDuJour, lotsEcheancesEnCours, traiterLotEcheances } from "./echeances";
import { lotsEnCours, traiterLot } from "./imports";
import { obtenirPrisma } from "./prisma";
import { reprendreEcriture } from "./stockage";
import { connexionRedis, enfilerEcriture, enfilerLot, enfilerLotEcheances, FILE_ECHEANCES, FILE_IMPORTS, FILE_QUOTIDIEN, FILE_STOCKAGE, planifierListeDuJour } from "./taches";

/**
 * Travailleur de la file de tâches (D24) : service `travailleur` du Docker Compose, lancé par scripts/travailleur.mts.
 * Même image et même code que l'application (serveur/ : base, générateur, stockage). Il exécute les tâches que
 * l'application enfile ; une tâche interrompue (arrêt, plantage) est reprise par BullMQ et ne refait que ce qui manque.
 */

export type Travailleur = { fermer(): Promise<void> };

export async function demarrerTravailleur(options: { journal?: (m: string) => void } = {}): Promise<Travailleur> {
  const journal = options.journal ?? ((m: string) => console.log(`[travailleur] ${m}`));
  const connection = connexionRedis();

  // Un lot à la fois : le lot convertit lui-même CONVERSIONS_SIMULTANEES certificats en parallèle. Le verrou d'une
  // tâche se renouvelle tant que le travailleur vit ; s'il meurt, la tâche est reprise par un autre démarrage.
  const imports = new Worker(FILE_IMPORTS, async (tache) => traiterLot(Number(tache.data.lotId)), { connection, concurrency: 1, lockDuration: 120_000 });
  const ecritures = new Worker(
    FILE_STOCKAGE,
    async (tache) => {
      const issue = await reprendreEcriture(Number(tache.data.documentId));
      return issue ?? "ABSENTE";
    },
    { connection, concurrency: 1 },
  );
  // Session 5b : lots d'avis et de relances (un à la fois), et la liste du jour établie chaque matin (aucun document produit).
  const echeances = new Worker(FILE_ECHEANCES, async (tache) => traiterLotEcheances(Number(tache.data.lotId)), { connection, concurrency: 1, lockDuration: 120_000 });
  const quotidien = new Worker(FILE_QUOTIDIEN, async () => etablirListeDuJour(), { connection, concurrency: 1 });
  echeances.on("completed", (t) => journal(`lot d'avis et de relances ${t.data.lotId} traité`));
  echeances.on("failed", (t, e) => journal(`lot d'avis et de relances ${t?.data.lotId} en échec (essai ${t?.attemptsMade}) : ${e.message}`));
  quotidien.on("completed", (_t, r: { avis: number; relances: number }) => journal(`liste du jour : ${r.avis} avis et ${r.relances} relance(s) à produire`));
  quotidien.on("failed", (_t, e) => journal(`liste du jour impossible : ${e.message}`));
  imports.on("completed", (t) => journal(`lot ${t.data.lotId} traité`));
  imports.on("failed", (t, e) => journal(`lot ${t?.data.lotId} en échec (essai ${t?.attemptsMade}) : ${e.message}`));
  ecritures.on("completed", (t, issue) => journal(`écriture du document ${t.data.documentId} : ${issue}`));
  ecritures.on("failed", (t, e) => journal(`écriture du document ${t?.data.documentId} encore impossible (essai ${t?.attemptsMade}) : ${e.message}`));
  for (const w of [imports, ecritures, echeances, quotidien]) w.on("error", (e) => journal(`erreur : ${e.message}`));

  // Au démarrage : tout ce qui attend est (re)confié à la file. Les identifiants stables évitent les doublons.
  const differees = await obtenirPrisma().ecritureDifferee.findMany({ select: { documentId: true } });
  for (const { documentId } of differees) await enfilerEcriture(documentId);
  const lots = await lotsEnCours();
  for (const lotId of lots) await enfilerLot(lotId);
  const lotsEcheances = await lotsEcheancesEnCours();
  for (const lotId of lotsEcheances) await enfilerLotEcheances(lotId);
  await planifierListeDuJour();
  journal(`démarré : ${lots.length} lot(s) d'import, ${lotsEcheances.length} lot(s) d'avis et de relances et ${differees.length} écriture(s) différée(s) repris.`);

  return {
    async fermer() {
      await Promise.all([imports.close(), ecritures.close(), echeances.close(), quotidien.close()]);
    },
  };
}
