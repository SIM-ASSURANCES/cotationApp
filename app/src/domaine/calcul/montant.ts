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

/** Espaces acceptés comme séparateur de milliers : espace normale, insécable (U+00A0), fine insécable (U+202F). */
const ESPACES = /[ \u00A0\u202F]/;

/**
 * SEUL analyseur des montants saisis (CDC §8, recette 2.3a) : tout formulaire passe par lui, directement
 * ou par `montant()`. Renvoie l'écriture canonique (« 93581.33 ») ou lève une ErreurCalcul en français.
 *
 * Accepte : « 93581.33 », « 93581,33 », « 93 581,33 » (espace normale, insécable ou fine entre les
 * groupes de trois chiffres). Refuse les écritures ambiguës : point ET virgule (« 1.234,5 », « 1,234.5 »),
 * plusieurs virgules ou plusieurs points, groupes de chiffres mal formés (« 93 58 1 »).
 */
export function analyserMontant(valeur: string, options: { negatif?: boolean } = {}): string {
  const texte = valeur.trim();
  const refus = (raison: string): never => {
    throw new ErreurCalcul(`Montant invalide : « ${valeur} » (${raison}).`);
  };
  if (texte === "") refus("aucun chiffre");
  const signe = texte.startsWith("-") ? "-" : "";
  if (signe && !options.negatif) refus("un montant négatif n'est pas accepté ici");
  const corps = signe ? texte.slice(1) : texte;
  const virgules = (corps.match(/,/g) ?? []).length;
  const points = (corps.match(/\./g) ?? []).length;
  if (virgules > 0 && points > 0) refus("point et virgule mélangés : écrivez par exemple 1 234,5");
  if (virgules > 1 || points > 1) refus("un seul séparateur décimal est permis");
  const [entiere, decimale] = corps.split(/[.,]/);
  if (decimale !== undefined && !/^\d+$/.test(decimale)) refus("partie décimale invalide");
  if (ESPACES.test(entiere)) {
    if (!/^\d{1,3}([ \u00A0\u202F]\d{3})+$/.test(entiere)) refus("les espaces séparent des groupes de trois chiffres");
  } else if (!/^\d+$/.test(entiere)) {
    refus("caractères non numériques");
  }
  const canonique = `${signe}${entiere.replace(/[ \u00A0\u202F]/g, "")}${decimale !== undefined ? `.${decimale}` : ""}`;
  return canonique === "-0" ? "0" : canonique;
}

/**
 * Pour la lecture d'un formulaire : l'écriture canonique si le texte est un montant valide, sinon le texte
 * tel quel (la validation du service le refusera ensuite avec le message de `analyserMontant`).
 */
export function normaliserMontantSaisi(valeur: string): string {
  try {
    return analyserMontant(valeur);
  } catch {
    return valeur.trim();
  }
}

/** Convertit un texte décimal (analyseur unique ci-dessus) ou un Montant ; refuse tout ce qui n'est pas un nombre. */
export function montant(valeur: EntreeMontant): Montant {
  if (typeof valeur !== "string") {
    return new D(valeur);
  }
  return new D(analyserMontant(valeur, { negatif: true }));
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
