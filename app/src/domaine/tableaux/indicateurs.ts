import { ecartEnJours, type DateIso } from "../calcul/dates";
import { montant, ZERO } from "../calcul/montant";
import { statutEffectif, STATUTS, type StatutCotation } from "../cotation/statuts";

/**
 * Tableaux de bord (session 5b, CDC §9.4 et §12) : agrégations PURES. Chaque chiffre est recalculé depuis la base à
 * chaque affichage (le serveur lit les lignes, ces fonctions comptent) : aucun indicateur n'est stocké à part.
 */

export type Periode = { debut: DateIso; fin: DateIso };

export const dansPeriode = (date: DateIso | null, p: Periode): boolean => date !== null && date >= p.debut && date <= p.fin;

// ------------------------------------------------------------------ Cotations (§9.4)

/** Nombre de cotations par statut RÉEL (une cotation émise dont la validité est dépassée compte « Expirée »). */
export function cotationsParStatut(cotations: readonly { statut: StatutCotation; dateValidite: DateIso | null }[], aujourdhui: DateIso): Record<StatutCotation, number> {
  const compte = Object.fromEntries(STATUTS.map((s) => [s, 0])) as Record<StatutCotation, number>;
  for (const c of cotations) compte[statutEffectif(c.statut, c.dateValidite, aujourdhui)] += 1;
  return compte;
}

export type LigneTransformation = { cle: string; emises: number; acceptees: number; taux: string | null };

/**
 * Taux de transformation (H70) : parmi les cotations ÉMISES dans la période (numéro COT attribué), la part qui a été
 * acceptée (police créée), quelle que soit la date de l'acceptation. Taux en pourcentage à une décimale ; null si aucune
 * cotation émise. Lignes triées par libellé.
 */
export function tauxTransformation(cotations: readonly { cle: string; acceptee: boolean }[]): LigneTransformation[] {
  const parCle = new Map<string, { emises: number; acceptees: number }>();
  for (const c of cotations) {
    const l = parCle.get(c.cle) ?? { emises: 0, acceptees: 0 };
    l.emises += 1;
    if (c.acceptee) l.acceptees += 1;
    parCle.set(c.cle, l);
  }
  return [...parCle]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([cle, l]) => ({ cle, ...l, taux: pourcentage(l.acceptees, l.emises) }));
}

export const pourcentage = (n: number, total: number): string | null => (total === 0 ? null : montant(String(n)).times(100).dividedBy(total).toDecimalPlaces(1).toFixed(1));

// ------------------------------------------------------------------ Facturation (§11, §12)

export const TRANCHES_ANCIENNETE = ["0-30", "31-60", "60+"] as const;
export type TrancheAnciennete = (typeof TRANCHES_ANCIENNETE)[number];

export const LIBELLE_TRANCHE: Record<TrancheAnciennete, string> = { "0-30": "0 à 30 jours", "31-60": "31 à 60 jours", "60+": "Plus de 60 jours" };

export const trancheDe = (joursDeRetard: number): TrancheAnciennete => (joursDeRetard <= 30 ? "0-30" : joursDeRetard <= 60 ? "31-60" : "60+");

/**
 * Impayés par ancienneté : reste dû des échéances ÉCHUES (date passée ou du jour) et non payées, par nombre de jours
 * depuis la date de l'échéance. Une échéance à venir n'est pas un impayé.
 */
export function impayesParAnciennete(echeances: readonly { date: DateIso; restant: string }[], aujourdhui: DateIso): Record<TrancheAnciennete, { nombre: number; montant: string }> {
  const r = Object.fromEntries(TRANCHES_ANCIENNETE.map((t) => [t, { nombre: 0, montant: ZERO }])) as Record<TrancheAnciennete, { nombre: number; montant: ReturnType<typeof montant> }>;
  for (const e of echeances) {
    const reste = montant(e.restant);
    if (!reste.greaterThan(0) || !e.date || e.date > aujourdhui) continue;
    const t = trancheDe(ecartEnJours(e.date, aujourdhui));
    r[t].nombre += 1;
    r[t].montant = r[t].montant.plus(reste);
  }
  return Object.fromEntries(TRANCHES_ANCIENNETE.map((t) => [t, { nombre: r[t].nombre, montant: r[t].montant.toFixed() }])) as Record<TrancheAnciennete, { nombre: number; montant: string }>;
}

export const somme = (montants: readonly string[]): string => montants.reduce((s, m) => s.plus(montant(m)), ZERO).toFixed();

// ------------------------------------------------------------------ Production

/** Mois d'une date (AAAA-MM). */
export const moisDe = (date: DateIso): string => date.slice(0, 7);

/** Nombre par (type, mois), trié par mois puis type. */
export function parTypeEtMois(documents: readonly { type: string; date: DateIso }[]): { type: string; mois: string; nombre: number }[] {
  const compte = new Map<string, number>();
  for (const d of documents) {
    const cle = `${moisDe(d.date)}|${d.type}`;
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  return [...compte]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cle, nombre]) => {
      const [mois, type] = cle.split("|");
      return { type, mois, nombre };
    });
}

/** Période par défaut : du 1er janvier de l'année au jour. */
export const periodeParDefaut = (aujourdhui: DateIso): Periode => ({ debut: `${aujourdhui.slice(0, 4)}-01-01`, fin: aujourdhui });

export function problemesPeriode(p: Periode, dateValide: (d: string) => boolean): string[] {
  if (!dateValide(p.debut) || !dateValide(p.fin)) return ["Période : dates au format AAAA-MM-JJ."];
  if (p.debut > p.fin) return ["Période : le début est après la fin."];
  if (ecartEnJours(p.debut, p.fin) > 366 * 5) return ["Période : cinq ans au plus."];
  return [];
}
