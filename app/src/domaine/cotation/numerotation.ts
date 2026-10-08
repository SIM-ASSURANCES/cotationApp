import { dateValide, type DateIso } from "../calcul/dates";

/**
 * Numéros de documents (CDC §11.4) : AAAA-MM-NNNN, avec un compteur ANNUEL (il ne repart pas à zéro
 * chaque mois), unique, continu et sans trou, attribué uniquement à l'émission.
 *
 * Session 4b : le format est PARAMÉTRABLE par type (paramètre historisé, modifications journalisées). Il s'écrit
 * avec trois repères : {AAAA} l'année (obligatoire : le compteur est annuel, l'année évite tout doublon d'une année
 * sur l'autre), {MM} le mois d'émission (facultatif), {NNNN} le compteur sur autant de chiffres que de N (obligatoire,
 * 3 à 8 N). Un compteur plus long que sa largeur s'écrit en entier : jamais tronqué.
 */
export const PREFIXES_NUMERO = ["COT", "FAC", "AV", "REC"] as const;
export type PrefixeNumero = (typeof PREFIXES_NUMERO)[number];

export const LIBELLE_PREFIXE: Record<PrefixeNumero, string> = { COT: "Cotation", FAC: "Facture", AV: "Avoir", REC: "Reçu" };

/** Formats par défaut (CDC §11.4). */
export const FORMATS_NUMERO_DEFAUT: Record<PrefixeNumero, string> = {
  COT: "COT-{AAAA}-{MM}-{NNNN}",
  FAC: "FAC-{AAAA}-{MM}-{NNNN}",
  AV: "AV-{AAAA}-{MM}-{NNNN}",
  REC: "REC-{AAAA}-{MM}-{NNNN}",
};

/** Clé du paramètre historisé du format d'un type. */
export const cleFormatNumero = (prefixe: PrefixeNumero): string => `numerotation.format.${prefixe}`;

export const estPrefixeNumero = (valeur: string): valeur is PrefixeNumero => (PREFIXES_NUMERO as readonly string[]).includes(valeur);

function composantes(date: DateIso): { annee: string; mois: string } {
  if (!dateValide(date)) throw new Error(`Date invalide : « ${date} ».`);
  return { annee: date.slice(0, 4), mois: date.slice(5, 7) };
}

/** Clé du compteur : un compteur par type de document et par année civile (« COT-2026 »), quel que soit le format. */
export function cleCompteur(prefixe: string, date: DateIso): string {
  return `${prefixe}-${composantes(date).annee}`;
}

const REPERE = /\{(AAAA|MM|N+)\}/g;

/** Problèmes d'un format saisi (vide s'il est acceptable). */
export function problemesFormatNumero(format: string): string[] {
  const p: string[] = [];
  const reperes = [...format.matchAll(REPERE)].map((r) => r[1]);
  const compte = (nom: (r: string) => boolean) => reperes.filter(nom).length;
  if (compte((r) => r === "AAAA") !== 1) p.push("Le format doit contenir une fois {AAAA} (l'année : le compteur est annuel).");
  if (compte((r) => r.startsWith("N")) !== 1) p.push("Le format doit contenir une fois le compteur, {NNNN} (de 3 à 8 N).");
  const n = reperes.find((r) => r.startsWith("N"));
  if (n && (n.length < 3 || n.length > 8)) p.push("Le compteur s'écrit sur 3 à 8 chiffres : {NNN} à {NNNNNNNN}.");
  if (compte((r) => r === "MM") > 1) p.push("Le mois {MM} ne peut figurer qu'une fois.");
  const reste = format.replace(REPERE, "");
  if (!/^[A-Z0-9/_-]*$/.test(reste)) p.push("En dehors des repères, seuls les majuscules, chiffres, « - », « _ » et « / » sont permis.");
  if (!/^[A-Z]/.test(format)) p.push("Le format commence par une lettre (le préfixe du type, par exemple FAC).");
  if (format.length > 40) p.push("Le format fait 40 caractères au plus.");
  return p;
}

/** Applique un format : FAC-{AAAA}-{MM}-{NNNN}, 16/09/2026, 3 → FAC-2026-09-0003. */
export function formaterSelon(format: string, date: DateIso, compteur: number): string {
  if (!Number.isInteger(compteur) || compteur < 1) throw new Error("Le compteur doit être un entier positif.");
  const problemes = problemesFormatNumero(format);
  if (problemes.length > 0) throw new Error(`Format de numéro invalide « ${format} » : ${problemes.join(" ")}`);
  const { annee, mois } = composantes(date);
  return format.replace(REPERE, (_tout, repere: string) => (repere === "AAAA" ? annee : repere === "MM" ? mois : String(compteur).padStart(repere.length, "0")));
}

/** COT-2026-10-0001 : le mois est celui de l'émission, le compteur est celui de l'année (format par défaut). */
export function formaterNumero(prefixe: PrefixeNumero, date: DateIso, compteur: number): string {
  return formaterSelon(FORMATS_NUMERO_DEFAUT[prefixe], date, compteur);
}

// Le numéro de police n'est plus généré ici : il est saisi (H10, D18), voir police.ts.
