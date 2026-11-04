/**
 * Saisie d'un montant à l'écran (D63) : séparateur de milliers pendant la frappe (« 1 000 000 »), valeur envoyée SANS séparateur
 * (« 1000000 »), décimales avec virgule là où le champ en admet. Fonctions pures, sans React ni navigateur : le composant
 * `ChampMontant` ne fait que les brancher sur un champ.
 *
 * Ces fonctions n'ont AUCUN rôle de validation : un texte qu'elles ne reconnaissent pas est laissé tel quel, à l'écran comme à
 * l'envoi, et c'est le serveur (`analyserMontant`, seul analyseur des montants, CDC §8) qui l'accepte ou le refuse avec son message.
 * Jamais de nombre flottant : on ne manipule que du texte.
 */

/** Séparateur de milliers affiché : espace insécable, comme `formaterMontant` (le montant ne se coupe pas en fin de ligne). */
export const SEPARATEUR_MILLIERS = " ";

export type OptionsSaisieMontant = {
  /** Le champ admet une partie décimale (virgule). Faux : entier seulement ; un texte avec séparateur décimal est laissé tel quel. */
  decimales: boolean;
};

export type SaisieMontant = {
  /** Ce qui s'affiche dans le champ. */
  affiche: string;
  /** Ce qui est envoyé : « 1000000 », « 1000000.5 » (point décimal) ; le texte tel quel s'il n'est pas reconnu. */
  brut: string;
  /** Vrai si le texte est un nombre bien formé (le serveur reste seul juge de sa validité métier). */
  reconnu: boolean;
};

/** Tout ce qui sépare visuellement des groupes de chiffres, collage depuis Excel compris : espaces, insécables, fines, tabulations, sauts de ligne. */
const BLANCS = /[\s    ]/g;

/**
 * Lit un texte saisi ou collé (« 1 000 000 », « 1000000 », « 1 000 000,50 », « 1000000.5 ») : le montant sans séparateur de milliers,
 * point décimal, et le texte à afficher (groupes de trois chiffres, virgule). Un texte vide est reconnu (champ vide).
 */
export function lireSaisieMontant(texte: string, options: OptionsSaisieMontant): SaisieMontant {
  const compact = texte.replace(BLANCS, "");
  const forme = options.decimales ? /^(-?)(\d*)(?:([.,])(\d*))?$/ : /^(-?)(\d*)$/;
  const m = forme.exec(compact);
  if (!m) return { affiche: texte, brut: texte.trim(), reconnu: false };
  const [, signe, entiere, separateur, fraction] = m;
  const groupes = entiere.replace(/\B(?=(\d{3})+(?!\d))/g, SEPARATEUR_MILLIERS);
  const partieDecimale = separateur ? `,${fraction ?? ""}` : "";
  const brutDecimal = separateur ? `.${fraction ?? ""}` : "";
  return {
    affiche: `${signe}${groupes}${partieDecimale}`,
    brut: `${signe}${entiere}${brutDecimal}`,
    reconnu: true,
  };
}

/** Un caractère qui compte pour placer le curseur : un chiffre, un séparateur décimal, le signe. Les blancs de groupe, eux, vont et viennent. */
const SIGNIFICATIF = /[\d.,-]/;

/** Nombre de caractères significatifs du texte AVANT la position du curseur. */
export function significatifsAvant(texte: string, position: number): number {
  let n = 0;
  for (const c of texte.slice(0, Math.max(0, position))) if (SIGNIFICATIF.test(c)) n += 1;
  return n;
}

/**
 * Position du curseur dans le texte reformaté, pour qu'il reste là où la personne tape : juste après le même nombre de caractères
 * significatifs (les séparateurs de milliers ajoutés ou retirés ne comptent pas). Taper au milieu d'un nombre ne rejette donc
 * jamais le curseur à la fin.
 */
export function positionApresReformatage(affiche: string, significatifs: number): number {
  if (significatifs <= 0) return 0;
  let vus = 0;
  for (let i = 0; i < affiche.length; i += 1) {
    if (SIGNIFICATIF.test(affiche[i])) vus += 1;
    if (vus === significatifs) return i + 1;
  }
  return affiche.length;
}

/** Texte à afficher pour une valeur enregistrée ou initiale (« 1000000 », « 1 000 000 », « 1000000.5 ») ; vide reste vide. */
export function afficherMontantSaisi(valeur: string | number | undefined | null, options: OptionsSaisieMontant): string {
  return lireSaisieMontant(valeur === undefined || valeur === null ? "" : String(valeur), options).affiche;
}
