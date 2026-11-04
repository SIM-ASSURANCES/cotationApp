import { DecimalMontant } from "./montant";

/**
 * Phrase qui accompagne le résultat d'un calcul (formules ou barème) : « 303 jour(s) couverts, coefficient de prorata 0,83014 ».
 * Un seul libellé pour les deux voies (D63). Le coefficient est celui que le moteur a appliqué : rien n'est recalculé ici, le texte ne
 * fait que le mettre en forme (cinq décimales, virgule). `prorataActif: false` : le produit n'applique pas de prorata, le coefficient
 * vaut 1 et la phrase le dit.
 */
export function libelleDureeEtProrata(jours: number, coefficient: string | { toString(): string }, prorataActif = true): string {
  const coef = new DecimalMontant(coefficient.toString()).toDecimalPlaces(5).toString().replace(".", ",");
  return prorataActif
    ? `${jours} jour(s) couverts, coefficient de prorata ${coef}`
    : `${jours} jour(s) couverts, coefficient de prorata ${coef} (ce produit n'applique pas de prorata)`;
}
