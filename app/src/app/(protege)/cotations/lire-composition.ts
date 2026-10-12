import { normaliserMontantSaisi } from "@/domaine/calcul/montant";
import type { LigneDePrime } from "@/domaine/calcul/composition";

const colonne = (d: FormData, nom: string) => d.getAll(nom).map((v) => String(v).trim());

/**
 * Lit les lignes de prime du formulaire « Composer la prime » (session 6.2b) : une ligne par garantie, surprime ou majoration. Aucune validation
 * ici (elle est faite par le domaine, avec des messages en français) ; les montants restent des TEXTES, mis en écriture canonique quand ils sont
 * lisibles. Une ligne entièrement vide est ignorée.
 */
export function lireLignesDePrime(d: FormData): LigneDePrime[] {
  const [libelles, branches, nettes, accessoires] = ["ligne_libelle", "ligne_branche", "ligne_nette", "ligne_accessoires"].map((n) => colonne(d, n));
  return libelles
    .map((libelle, i) => ({
      libelle,
      branche: branches[i] ?? "",
      primeNette: normaliserMontantSaisi(nettes[i] ?? ""),
      // Accessoires laissés vides : zéro (aucun accessoire), pas une erreur.
      accessoires: (accessoires[i] ?? "") === "" ? "0" : normaliserMontantSaisi(accessoires[i]),
    }))
    .filter((l) => !(l.libelle === "" && l.branche === "" && l.primeNette === "" && l.accessoires === "0"));
}
