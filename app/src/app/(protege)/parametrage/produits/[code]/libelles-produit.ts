import { montant } from "@/domaine/calcul/montant";

/** Libellés partagés par la fiche d'un produit et son formulaire de version. */
export const LIBELLE_SENS = { PROCHE: "Au plus proche", SUPERIEUR: "Au supérieur", INFERIEUR: "À l'inférieur" } as const;
export const LIBELLE_NIVEAU = { LIGNE: "Chaque ligne", TOTAL: "Total seulement" } as const;
export const LIBELLE_MODE = {
  FORMULE: "Par formule (calcul automatique)",
  GARANTIES: "Par garanties (prime composée par la Technique, calcul automatique refusé)",
  BAREME: "Au barème (prime tirée du barème publié de la version)",
} as const;

/** Décimal en texte sans zéros inutiles (« 3000.000000 » devient « 3000 »). */
export const net = (texte: string) => montant(texte).toString();
