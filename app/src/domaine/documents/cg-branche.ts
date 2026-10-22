// Conditions générales par branche principale (étape 6, D42) : une CG par branche, historisée par date d'effet.
// Fonctions pures : aucune lecture de base ici.
import { dateValide, type DateIso } from "../calcul/dates";

/** Une ligne de rattachement : à partir de `dateEffet`, la branche utilise le modèle de CG `modeleCode`. */
export type RattachementCg = { dateEffet: DateIso; modeleCode: string };

const CODE_MODELE = /^[A-Z0-9_-]{2,60}$/;

/** Rattachement en vigueur à une date : la ligne la plus récente dont la date d'effet est atteinte (null : aucune). */
export function cgEnVigueurLe(lignes: readonly RattachementCg[], date: DateIso): RattachementCg | null {
  let retenue: RattachementCg | null = null;
  for (const l of lignes) {
    if (l.dateEffet <= date && (retenue === null || l.dateEffet > retenue.dateEffet)) retenue = l;
  }
  return retenue;
}

/** Problèmes d'une saisie de rattachement (vide si valide). */
export function problemesRattachementCg(saisie: { modeleCode: string; dateEffet: string }): string[] {
  const p: string[] = [];
  if (!CODE_MODELE.test(saisie.modeleCode)) p.push("Choisissez le modèle de conditions générales (code invalide).");
  if (!dateValide(saisie.dateEffet)) p.push("La date d'effet est invalide.");
  return p;
}

/** Message d'un produit sans branche principale ou d'une branche sans CG en vigueur (émission des CP refusée avant tout numéro). */
export function messageCgManquante(produitCode: string, branche: { code: string; libelle: string } | null, date: DateIso): string {
  if (!branche) {
    return `Le produit ${produitCode} n'a pas de branche principale : renseignez-la (Paramétrage > Produits) pour qu'il reçoive les conditions générales de sa branche avant d'émettre le contrat.`;
  }
  return `La branche « ${branche.libelle} » n'a pas de conditions générales en vigueur au ${date} : rattachez-lui un modèle de CG (Paramétrage > Conditions générales) avant d'émettre le contrat du produit ${produitCode}.`;
}
