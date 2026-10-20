import { normaliserMontantSaisi } from "@/domaine/calcul/montant";
import type { LigneDePrime } from "@/domaine/calcul/composition";

const colonne = (d: FormData, nom: string) => d.getAll(nom).map((v) => String(v).trim());

/**
 * Lit les lignes de prime du formulaire « Composer la prime » (session 6.2b) : une ligne par garantie, surprime ou majoration. Aucune validation
 * ici (elle est faite par le domaine, avec des messages en français) ; les montants restent des TEXTES, mis en écriture canonique quand ils sont
 * lisibles. Une ligne entièrement vide est ignorée.
 */
export function lireLignesDePrime(d: FormData): LigneDePrime[] {
  const [libelles, branches, montantsGarantis, nettes, accessoires] = [
    "ligne_libelle",
    "ligne_branche",
    "ligne_montant_garanti",
    "ligne_nette",
    "ligne_accessoires",
  ].map((n) => colonne(d, n));
  const aMontantGaranti = d.has("ligne_montant_garanti");
  return libelles
    .map((libelle, i) => {
      const mg = (montantsGarantis[i] ?? "").trim();
      return {
        libelle,
        branche: branches[i] ?? "",
        ...(aMontantGaranti ? { montantGaranti: mg === "" ? null : normaliserMontantSaisi(mg) } : {}),
        primeNette: normaliserMontantSaisi(nettes[i] ?? ""),
        // Accessoires laissés vides : zéro (aucun accessoire), pas une erreur.
        accessoires: (accessoires[i] ?? "") === "" ? "0" : normaliserMontantSaisi(accessoires[i]),
      };
    })
    .filter((l) => !(l.libelle === "" && l.branche === "" && (l.montantGaranti ?? null) === null && l.primeNette === "" && l.accessoires === "0"));
}
