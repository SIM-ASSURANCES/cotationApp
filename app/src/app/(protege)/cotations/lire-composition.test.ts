import { describe, expect, it } from "vitest";

import { problemesLignesDePrime } from "@/domaine/calcul/composition";

import { lireLignesDePrime } from "./lire-composition";

function formulaire(lignes: string[][]): FormData {
  const d = new FormData();
  for (const [libelle, branche, nette, accessoires] of lignes) {
    d.append("ligne_libelle", libelle);
    d.append("ligne_branche", branche);
    d.append("ligne_nette", nette);
    d.append("ligne_accessoires", accessoires);
  }
  return d;
}

describe("lireLignesDePrime : formulaire -> lignes de prime", () => {
  it("lit chaque ligne en texte, en écriture canonique (« 9 850,50 » devient « 9850.50 »)", () => {
    const l = lireLignesDePrime(formulaire([["Incendie", "INCENDIE", "10 000", "2 500"], ["Vol", "IARD", "9850,50", "0"]]));
    expect(l).toEqual([
      { libelle: "Incendie", branche: "INCENDIE", primeNette: "10000", accessoires: "2500" },
      { libelle: "Vol", branche: "IARD", primeNette: "9850.50", accessoires: "0" },
    ]);
    expect(typeof l[0].primeNette).toBe("string");
    expect(problemesLignesDePrime(l)).toEqual([]);
  });

  it("des accessoires laissés vides valent zéro ; une ligne entièrement vide est ignorée", () => {
    const l = lireLignesDePrime(formulaire([["Vol", "IARD", "1000", ""], ["", "", "", ""]]));
    expect(l).toEqual([{ libelle: "Vol", branche: "IARD", primeNette: "1000", accessoires: "0" }]);
  });

  it("un montant illisible reste tel quel : le domaine le refuse avec un message, jamais lu comme zéro", () => {
    const l = lireLignesDePrime(formulaire([["Vol", "IARD", "1.234,5", "0"]]));
    expect(l[0].primeNette).toBe("1.234,5");
    expect(problemesLignesDePrime(l).join(" ")).toContain("Montant invalide");
  });
});
