/**
 * Numéro de police (CDC §9.4, réponse H10 de la Technique, D18). Règles pures.
 *
 * Le numéro est attribué par SIM et SAISI à la transformation de la cotation en contrat : le module ne
 * le génère jamais. Son format est contrôlé par une expression régulière paramétrable (historisée,
 * modifications journalisées). Valeur par défaut, d'après l'exemple `SCD-2026-000088-G00000` ; le sens
 * des 5 chiffres après G ou I est inconnu (H31).
 */

export const CLE_FORMAT_NUMERO_POLICE = "police.format_numero";
export const FORMAT_NUMERO_POLICE_DEFAUT = "^[A-Z0-9]+-\\d{4}-\\d{6}-[GI]\\d{5}$";
export const LONGUEUR_MAX_NUMERO_POLICE = 60;

/** Problèmes d'une expression de format (vide si elle est acceptable). */
export function problemesFormatNumeroPolice(format: string): string[] {
  const p: string[] = [];
  if (!format.startsWith("^") || !format.endsWith("$")) p.push("Le format doit commencer par ^ et finir par $ (le numéro entier doit correspondre).");
  if (format.length > 200) p.push("Le format est trop long (200 caractères au plus).");
  try {
    new RegExp(format);
  } catch {
    p.push("Le format n'est pas une expression régulière valide.");
  }
  return p;
}

/** Normalise un numéro saisi : espaces retirés aux bords, lettres en majuscules. */
export const normaliserNumeroPolice = (saisi: string): string => saisi.trim().toUpperCase();

/** Problèmes d'un numéro saisi au regard du format en vigueur (vide s'il est conforme). */
export function problemesNumeroPolice(numero: string, format: string): string[] {
  if (numero === "") return ["Le numéro de police est obligatoire : il est attribué par SIM et saisi ici."];
  if (numero.length > LONGUEUR_MAX_NUMERO_POLICE) return [`Le numéro de police est trop long (${LONGUEUR_MAX_NUMERO_POLICE} caractères au plus).`];
  if (!new RegExp(format).test(numero)) return [`Le numéro de police « ${numero} » ne respecte pas le format attendu (${format}).`];
  return [];
}
