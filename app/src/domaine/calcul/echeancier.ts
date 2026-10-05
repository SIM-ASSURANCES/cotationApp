import { ajouterMois, dateValide, type DateIso } from "./dates";
import {
  ErreurCalcul,
  ZERO,
  arrondir,
  montant,
  type EntreeMontant,
  type Montant,
  type Precision,
  type SensArrondi,
} from "./montant";

/** Fractionnement et échéancier (CDC §8.4) : la somme des tranches est TOUJOURS égale au TTC. */

export type Tranche = { numero: number; date: DateIso; montant: Montant };

export type EntreeEcheancier = {
  ttc: EntreeMontant;
  nombreTranches: number;
  dateEffet: DateIso;
  /** Pourcentage de chaque tranche, somme égale à 100. Absent : tranches égales. */
  repartitionPourcent?: EntreeMontant[];
  /** Décalage de chaque tranche en mois depuis l'effet. Absent : 12 / n mois (entier) entre les tranches. */
  decalagesMois?: number[];
  /** Ou les dates exactes des tranches (ordre croissant). */
  dates?: DateIso[];
  /** Arrondi des tranches (comme celui du produit) ; la dernière tranche absorbe l'écart. */
  arrondi: { precision: Precision; sens: SensArrondi };
};

export const NOMBRE_MAX_TRANCHES = 12;

export function genererEcheancier(entree: EntreeEcheancier): Tranche[] {
  const ttc = montant(entree.ttc);
  const n = entree.nombreTranches;
  if (!Number.isInteger(n) || n < 1 || n > NOMBRE_MAX_TRANCHES) {
    throw new ErreurCalcul(`Le nombre de tranches doit être un entier de 1 à ${NOMBRE_MAX_TRANCHES}.`);
  }
  if (ttc.lessThanOrEqualTo(0)) {
    throw new ErreurCalcul("Le TTC à fractionner doit être positif.");
  }

  // Part théorique de chaque tranche. Sans répartition : TTC / n (et non 100/n % : 100/3 × 3 ne ferait pas
  // exactement 100 en décimal). Avec répartition : pourcentages saisis, dont la somme doit faire 100.
  let parts: Montant[];
  if (entree.repartitionPourcent) {
    const pourcents = entree.repartitionPourcent.map(montant);
    if (pourcents.length !== n) {
      throw new ErreurCalcul("La répartition doit compter autant de pourcentages que de tranches.");
    }
    if (!pourcents.reduce((s, p) => s.plus(p), ZERO).eq(100)) {
      throw new ErreurCalcul("Les pourcentages de la répartition doivent totaliser exactement 100.");
    }
    if (pourcents.some((p) => p.lessThanOrEqualTo(0))) {
      throw new ErreurCalcul("Chaque pourcentage de la répartition doit être positif.");
    }
    parts = pourcents.map((p) => ttc.mul(p).div(100));
  } else {
    parts = Array.from({ length: n }, () => ttc.div(n));
  }

  const dates = entree.dates ?? (entree.decalagesMois ?? Array.from({ length: n }, (_, i) => i * Math.floor(12 / n))).map((m) => ajouterMois(entree.dateEffet, m));
  if (dates.length !== n || dates.some((d) => !dateValide(d)) || dates.some((d, i) => i > 0 && d <= dates[i - 1])) {
    throw new ErreurCalcul("Les dates des tranches doivent être valides, distinctes et croissantes.");
  }

  const montants: Montant[] = [];
  let cumule = ZERO;
  for (let i = 0; i < n - 1; i += 1) {
    const tranche = arrondir(parts[i], entree.arrondi.precision, entree.arrondi.sens);
    montants.push(tranche);
    cumule = cumule.plus(tranche);
  }
  montants.push(ttc.minus(cumule)); // la dernière tranche absorbe l'écart d'arrondi

  const echeancier = montants.map((m, i) => ({ numero: i + 1, date: dates[i], montant: m }));
  verifierEcheancier(ttc, echeancier);
  return echeancier;
}

/**
 * Contrôle bloquant : somme des tranches = TTC, chaque tranche positive. S'applique aussi à un
 * échéancier modifié à la main lors de la cotation (CDC §8.4 : « modifiable »).
 */
export function verifierEcheancier(ttc: EntreeMontant, tranches: Tranche[]): void {
  if (tranches.length === 0) {
    throw new ErreurCalcul("L'échéancier est vide.");
  }
  if (tranches.some((t) => t.montant.lessThanOrEqualTo(0))) {
    throw new ErreurCalcul("Chaque tranche doit être un montant positif (répartition impossible pour ce TTC).");
  }
  const total = tranches.reduce((s, t) => s.plus(t.montant), ZERO);
  if (!total.eq(montant(ttc))) {
    throw new ErreurCalcul("Contrôle bloquant : la somme des tranches n'est pas égale au TTC.");
  }
}
