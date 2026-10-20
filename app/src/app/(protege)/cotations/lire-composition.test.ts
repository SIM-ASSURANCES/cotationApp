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

  it("lit le montant garanti facultatif (en écriture canonique, ou null s'il est laissé vide)", () => {
    const d = new FormData();
    d.append("ligne_libelle", "Incendie");
    d.append("ligne_branche", "INCENDIE");
    d.append("ligne_montant_garanti", "50 000 000");
    d.append("ligne_nette", "100 000");
    d.append("ligne_accessoires", "5 000");
    d.append("ligne_libelle", "Responsabilité civile");
    d.append("ligne_branche", "IARD");
    d.append("ligne_montant_garanti", "");
    d.append("ligne_nette", "25 000");
    d.append("ligne_accessoires", "2 500");

    const l = lireLignesDePrime(d);
    expect(l).toEqual([
      { libelle: "Incendie", branche: "INCENDIE", montantGaranti: "50000000", primeNette: "100000", accessoires: "5000" },
      { libelle: "Responsabilité civile", branche: "IARD", montantGaranti: null, primeNette: "25000", accessoires: "2500" },
    ]);
    expect(problemesLignesDePrime(l)).toEqual([]);
  });
});
