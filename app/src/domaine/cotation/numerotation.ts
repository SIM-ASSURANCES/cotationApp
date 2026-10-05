import { dateValide, type DateIso } from "../calcul/dates";

/**
 * Numéros de documents (CDC §11.4) : AAAA-MM-NNNN, avec un compteur ANNUEL (il ne repart pas à zéro
 * chaque mois), unique, continu et sans trou, attribué uniquement à l'émission.
 */
export const PREFIXES_NUMERO = ["COT", "FAC", "AV", "REC"] as const;
export type PrefixeNumero = (typeof PREFIXES_NUMERO)[number];

function composantes(date: DateIso): { annee: string; mois: string } {
  if (!dateValide(date)) throw new Error(`Date invalide : « ${date} ».`);
  return { annee: date.slice(0, 4), mois: date.slice(5, 7) };
}

/** Clé du compteur : un compteur par type de document et par année civile (« COT-2026 »). */
export function cleCompteur(prefixe: string, date: DateIso): string {
  return `${prefixe}-${composantes(date).annee}`;
}

/** COT-2026-10-0001 : le mois est celui de l'émission, le compteur est celui de l'année. */
export function formaterNumero(prefixe: PrefixeNumero, date: DateIso, compteur: number): string {
  if (!Number.isInteger(compteur) || compteur < 1) throw new Error("Le compteur doit être un entier positif.");
  const { annee, mois } = composantes(date);
  return `${prefixe}-${annee}-${mois}-${String(compteur).padStart(4, "0")}`;
}

/**
 * Numéro de police. Le format réel est décidé par la Direction Technique (question en attente) :
 * POL-AAAA-NNNNNN est un format PROVISOIRE, produit par le seul code ci-dessous pour être facile à changer.
 */
export function formaterNumeroPolice(date: DateIso, compteur: number): string {
  if (!Number.isInteger(compteur) || compteur < 1) throw new Error("Le compteur doit être un entier positif.");
  return `POL-${composantes(date).annee}-${String(compteur).padStart(6, "0")}`;
}
