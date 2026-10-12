/**
 * Intermédiaires (CDC §10.1 et §9.4 ; session 6.0, H71 fermée). Règles PURES : saisie du référentiel et choix sur une
 * cotation (0 à 2, dans l'ordre de la saisie, sans doublon). Les noms du dictionnaire sont `intermediaires[].nom`,
 * `.code` et `.role`.
 */

export const NOMBRE_MAX_INTERMEDIAIRES = 2;
export const LONGUEUR_MAX_NOM_INTERMEDIAIRE = 200;
export const LONGUEUR_MAX_ROLE_INTERMEDIAIRE = 100;
const CODE_INTERMEDIAIRE = /^[A-Z0-9][A-Z0-9_-]{0,29}$/;

export type IntermediaireSaisi = { code: string; nom: string; role: string };

/** Intermédiaire tel que les documents le reprennent (copie faite au moment du choix sur la cotation). */
export type IntermediaireDocument = { nom: string; code: string; role: string };

/** Problèmes d'un intermédiaire saisi dans le référentiel (vide s'il est acceptable). */
export function problemesIntermediaire(i: IntermediaireSaisi): string[] {
  const p: string[] = [];
  if (!CODE_INTERMEDIAIRE.test(i.code)) p.push("Code d'intermédiaire invalide (majuscules, chiffres, - et _, 30 caractères au plus).");
  const nom = i.nom.trim();
  const role = i.role.trim();
  if (nom === "") p.push("Le nom de l'intermédiaire est obligatoire.");
  else if (nom.length > LONGUEUR_MAX_NOM_INTERMEDIAIRE) p.push(`Nom de l'intermédiaire trop long (${LONGUEUR_MAX_NOM_INTERMEDIAIRE} caractères au plus).`);
  if (role === "") p.push("Le rôle de l'intermédiaire est obligatoire (ex. Apporteur, Gestionnaire).");
  else if (role.length > LONGUEUR_MAX_ROLE_INTERMEDIAIRE) p.push(`Rôle trop long (${LONGUEUR_MAX_ROLE_INTERMEDIAIRE} caractères au plus).`);
  return p;
}

/** Codes choisis sur une cotation : majuscules, vides retirés, ordre de la saisie conservé. */
export const normaliserChoixIntermediaires = (codes: readonly string[]): string[] => codes.map((c) => c.trim().toUpperCase()).filter((c) => c !== "");

/** Problèmes du choix des intermédiaires d'une cotation (codes déjà normalisés). */
export function problemesChoixIntermediaires(codes: readonly string[]): string[] {
  const p: string[] = [];
  if (codes.length > NOMBRE_MAX_INTERMEDIAIRES) p.push(`Au plus ${NOMBRE_MAX_INTERMEDIAIRES} intermédiaires par cotation.`);
  if (new Set(codes).size !== codes.length) p.push("Le même intermédiaire est choisi deux fois.");
  return p;
}
