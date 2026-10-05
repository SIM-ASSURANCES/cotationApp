import { montant, type EntreeMontant } from "./montant";

/** Double validation (CDC §4.1). */

/** Un document dont le TTC DÉPASSE le seuil du produit passe en « À valider ». Pas de seuil : jamais. */
export function exigeDoubleValidation(ttc: EntreeMontant, seuil: EntreeMontant | null): boolean {
  return seuil !== null && montant(ttc).greaterThan(montant(seuil));
}

/** Le valideur ne peut jamais être l'auteur du document (séparation des tâches). */
export function valideurAutorise(auteurId: number, valideurId: number): boolean {
  return auteurId !== valideurId;
}
