import { analyserMontant, formaterMontant, montant } from "../calcul/montant";

/** Ce qu'il faut savoir d'un champ pour parler de sa plage : son type (le franc CFA ne suit que le montant) et ses bornes du barème. */
export type ChampBorne = { type: string; min?: string; max?: string };

/**
 * Plage d'un champ borné, en toutes lettres (D64) : « de 0 à 10 000 000 F CFA », « au moins 5 000 F CFA », « au plus 100 ». `null` si le
 * champ n'a aucune borne. Les bornes sont celles du barème : aucune règle n'est ajoutée ici.
 */
export function libellePlage(c: ChampBorne): string | null {
  if (c.min === undefined && c.max === undefined) return null;
  const f = (v: string) => `${formaterMontant(montant(v))}${c.type === "MONTANT" ? " F CFA" : ""}`;
  if (c.min !== undefined && c.max !== undefined) return `de ${formaterMontant(montant(c.min))} à ${f(c.max)}`;
  return c.min !== undefined ? `au moins ${f(c.min)}` : `au plus ${f(c.max as string)}`;
}

/** Message d'une saisie hors plage : nomme le champ, la valeur et la plage. Le même texte à l'écran et au serveur. */
export const messageHorsPlage = (nomDuChamp: string, valeur: string, plage: string): string =>
  `Le champ « ${nomDuChamp} » : ${valeur} est hors de la plage autorisée (${plage}).`;

/**
 * Le texte saisi est-il hors des bornes ? `null` si non, ou si le texte n'est pas un montant lisible (le serveur en juge, comme avant).
 * Valeur rendue : le montant lu, pour l'afficher sans la mise en forme de la saisie.
 */
export function horsPlage(c: ChampBorne, saisi: string): { valeur: string; plage: string } | null {
  const plage = libellePlage(c);
  if (plage === null) return null;
  let n: string;
  try {
    n = analyserMontant(saisi);
  } catch {
    return null;
  }
  const hors = (c.min !== undefined && montant(n).lt(c.min)) || (c.max !== undefined && montant(n).gt(c.max));
  return hors ? { valeur: formaterMontant(montant(n)), plage } : null;
}
