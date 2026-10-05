import Decimal from "decimal.js";

/**
 * Montants : toujours des décimaux exacts (décision D3), jamais le type `number`.
 * On travaille avec une copie de Decimal.js (la bibliothèque dont Prisma tire son type Decimal),
 * réglée avec 40 chiffres significatifs : plus que nécessaire pour des francs CFA, et sans
 * aucune erreur d'arrondi cachée dans les produits et les divisions intermédiaires.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Montant = Decimal;

/** Ce que les fonctions du moteur acceptent : un texte (« 93581.33 ») ou un Montant. Jamais un nombre. */
export type EntreeMontant = string | Montant;

export class ErreurCalcul extends Error {
  override name = "ErreurCalcul";
}

export const ZERO: Montant = new D(0);

/** Convertit un texte décimal (point ou virgule) en Montant ; refuse tout ce qui n'est pas un nombre. */
export function montant(valeur: EntreeMontant): Montant {
  if (typeof valeur !== "string") {
    return new D(valeur);
  }
  const normalise = valeur.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalise)) {
    throw new ErreurCalcul(`Montant invalide : « ${valeur} ».`);
  }
  return new D(normalise);
}

export const PRECISIONS = [1, 10, 100, 1000] as const;
export type Precision = (typeof PRECISIONS)[number];

export const SENS_ARRONDI = ["PROCHE", "SUPERIEUR", "INFERIEUR"] as const;
export type SensArrondi = (typeof SENS_ARRONDI)[number];

const MODES = {
  PROCHE: Decimal.ROUND_HALF_UP, // 0,5 s'arrondit à l'unité supérieure (en valeur absolue)
  SUPERIEUR: Decimal.ROUND_CEIL,
  INFERIEUR: Decimal.ROUND_FLOOR,
} as const;

/** Arrondit à la précision voulue (1, 10, 100 ou 1 000 F) dans le sens voulu (CDC §8.5). */
export function arrondir(valeur: Montant, precision: Precision, sens: SensArrondi): Montant {
  return valeur.div(precision).toDecimalPlaces(0, MODES[sens]).mul(precision);
}

/**
 * Affichage : espace insécable entre les milliers (CDC §6.2), virgule décimale.
 * `decimales` : nombre de décimales affichées (0 par défaut : les francs CFA n'ont pas de centimes).
 */
export function formaterMontant(valeur: Montant, decimales = 0): string {
  const [entiere, fraction] = valeur.toFixed(decimales, Decimal.ROUND_HALF_UP).split(".");
  const negatif = entiere.startsWith("-");
  const groupes = (negatif ? entiere.slice(1) : entiere).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negatif ? "-" : ""}${groupes}${fraction ? "," + fraction : ""}`;
}

export { D as DecimalMontant };
