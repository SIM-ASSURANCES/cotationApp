import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { DateIso } from "@/domaine/calcul/dates";
import { avertissementReport, type CanalPaiement, type PaiementEnregistre } from "@/domaine/facturation/factures";

/**
 * Sommes qui règlent une facture (session 6.0) : ses paiements (part hors excédent, H33) et les imputations de l'avance de la
 * police qu'elle a reçues, dont les paiements reportés depuis la facture annulée qu'elle remplace (H47). Module sans
 * dépendance vers `factures.ts`, pour être lu partout (factures, échéances, tableaux de bord).
 */

type Client = Prisma.TransactionClient;

const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

type LignePaiement = { id: number; numeroRecu: string; date: Date; montant: { toFixed(): string }; excedent: { toFixed(): string }; reference: string; canal: string; payeur: string; creeLe: Date };
type LigneImputation = { id: number; date: Date; montant: { toFixed(): string }; creeLe: Date; paiement: Omit<LignePaiement, "excedent" | "creeLe" | "id"> | null };

/** Libellé de la référence d'une imputation de l'avance qui ne vient pas d'un paiement reporté. */
export const REFERENCE_IMPUTATION = "Imputation de l'avance de la police";

/**
 * Fusion, dans l'ordre d'enregistrement : un paiement garde son montant entier et son excédent ; une imputation d'un paiement
 * reporté reprend la date, le reçu, la référence, le canal et le payeur du paiement d'origine (le reçu reste valable) ; une
 * imputation d'avance n'a pas de reçu.
 */
export function versEncaissements(paiements: readonly LignePaiement[], imputations: readonly LigneImputation[]): PaiementEnregistre[] {
  const lignes = [
    ...paiements.map((p) => ({
      cle: [p.creeLe.getTime(), 1, p.id] as const,
      valeur: { numero: p.numeroRecu, date: depuisDate(p.date), montant: p.montant.toFixed(), excedent: p.excedent.toFixed(), reference: p.reference, canal: p.canal as CanalPaiement, payeur: p.payeur },
    })),
    ...imputations.map((i) => ({
      cle: [i.creeLe.getTime(), 0, i.id] as const,
      valeur: i.paiement
        ? { numero: i.paiement.numeroRecu, date: depuisDate(i.paiement.date), montant: i.montant.toFixed(), reference: i.paiement.reference, canal: i.paiement.canal as CanalPaiement, payeur: i.paiement.payeur }
        : { numero: "", date: depuisDate(i.date), montant: i.montant.toFixed(), reference: REFERENCE_IMPUTATION, canal: "AVANCE" as const, payeur: "" },
    })),
  ];
  lignes.sort((a, b) => a.cle[0] - b.cle[0] || a.cle[1] - b.cle[1] || a.cle[2] - b.cle[2]);
  return lignes.map((l) => l.valeur);
}

/** Inclusion Prisma des imputations d'une facture, avec le paiement d'origine d'un report. */
export const inclusionImputations = {
  where: { type: "IMPUTATION" },
  include: { paiement: { select: { numeroRecu: true, date: true, montant: true, reference: true, canal: true, payeur: true } } },
  orderBy: { id: "asc" as const },
} satisfies Prisma.Facture$imputationsArgs;

export async function encaissementsDe(client: Client, factureId: number): Promise<PaiementEnregistre[]> {
  const [paiements, imputations] = await Promise.all([
    client.paiement.findMany({ where: { factureId }, orderBy: { id: "asc" } }),
    client.mouvementAvance.findMany({ ...inclusionImputations, where: { factureId, type: "IMPUTATION" } }),
  ]);
  return versEncaissements(paiements, imputations);
}

/** Avance disponible d'une police : crédits (excédents, reports) moins débits (imputations, restitutions). */
export async function avanceDisponible(client: Client, policeId: number): Promise<string> {
  const [ligne] = await client.$queryRaw<{ solde: Prisma.Decimal }[]>`SELECT avance_disponible(${policeId}::integer) AS solde`;
  return new Prisma.Decimal(ligne?.solde ?? 0).toFixed();
}

/** Somme reportée d'une facture annulée dont la facture de remplacement n'est pas encore émise (H73, session 6.1). */
export type ReportEnAttente = { mouvementId: number; factureAnnulee: string; montant: string; date: DateIso; recu: string | null; avertissement: string };

/**
 * Sommes reportées (REPORT) d'une police dont la facture annulée n'a pas encore de facture de remplacement ÉMISE (une
 * remplaçante en brouillon ou « À valider » compte pour absente : elle n'a pas encore repris les sommes). Lecture seule ; ne
 * réserve rien (H73, option a).
 */
export async function reportsEnAttente(client: Client, policeId: number): Promise<ReportEnAttente[]> {
  const reports = await client.mouvementAvance.findMany({
    where: { policeId, type: "REPORT", factureAnnuleeId: { not: null } },
    include: { paiement: { select: { numeroRecu: true } }, factureAnnulee: { select: { id: true, numero: true } } },
    orderBy: { id: "asc" },
  });
  if (reports.length === 0) return [];
  const remplacees = new Set(
    (await client.facture.findMany({ where: { remplaceId: { in: reports.map((r) => r.factureAnnuleeId!) }, numero: { not: null } }, select: { remplaceId: true } })).map((r) => r.remplaceId),
  );
  return reports
    .filter((r) => !remplacees.has(r.factureAnnuleeId))
    .map((r) => ({
      mouvementId: r.id,
      factureAnnulee: r.factureAnnulee?.numero ?? "(sans numéro)",
      montant: r.montant.toFixed(),
      date: depuisDate(r.date),
      recu: r.paiement?.numeroRecu ?? null,
      avertissement: avertissementReport(r.factureAnnulee?.numero ?? "(sans numéro)"),
    }));
}
