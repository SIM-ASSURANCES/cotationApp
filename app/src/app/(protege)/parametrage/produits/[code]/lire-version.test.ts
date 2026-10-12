import { describe, expect, it } from "vitest";

import { problemesVersion } from "@/domaine/calcul/parametrage";

import { lireGaranties, lireVersion } from "./lire-version";

/** Formulaire tel que le navigateur l'envoie : T1 (BENI), deux formules. */
function formulaireBeni(surcharge: Record<string, string> = {}): FormData {
  const d = new FormData();
  const champs: Record<string, string> = {
    dateEffet: "2026-01-01", precision: "1", sens: "PROCHE", niveau: "LIGNE",
    prorataActif: "on", primeMinimale: "", tranchesMax: "4", repartition: "", decalages: "", frais: "0",
    validiteMois: "3", formulesMax: "3", seuil: "20000000", ...surcharge,
  };
  for (const [k, v] of Object.entries(champs)) d.append(k, v);
  for (const f of [
    ["solo", "Solo", "", "93581.33", "FIXE", "3000"],
    ["FAMILLE", "Famille", "", "252657,63", "FIXE", "210000"], // virgule décimale saisie
  ]) {
    d.append("formule_code", f[0]); d.append("formule_libelle", f[1]); d.append("formule_taux", f[2]);
    d.append("formule_prime", f[3]); d.append("formule_mode", f[4]); d.append("formule_valeur", f[5]);
  }
  return d;
}

describe("lireVersion : formulaire -> version saisie", () => {
  it("lit le formulaire BENI sans rien perdre, avec les montants en texte", () => {
    const v = lireVersion(formulaireBeni());

    expect(problemesVersion(v)).toEqual([]);
    expect(v.arrondi).toEqual({ precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" });
    expect(v.prorata).toEqual({ actif: true, primeMinimale: null });
    expect(v.fractionnement).toEqual({ tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" });
    expect(v.seuilValidationTtc).toBe("20000000");
    expect(v.formules.map((f) => [f.code, f.primeUnitaire, f.accessoireMode, f.accessoireValeur])).toEqual([
      ["SOLO", "93581.33", "FIXE", "3000"], // code mis en majuscules
      ["FAMILLE", "252657.63", "FIXE", "210000"], // virgule décimale mise en écriture canonique par l'analyseur unique
    ]);
    expect(typeof v.formules[0].primeUnitaire).toBe("string");
  });

  it("lit les listes (répartition, décalages) et la case décochée", () => {
    const d = formulaireBeni({ repartition: "40 ; 30 ; 30", decalages: "0 ; 4 ; 8", tranchesMax: "3" });
    d.delete("prorataActif");
    const v = lireVersion(d);

    expect(v.fractionnement.repartitionPourcent).toEqual(["40", "30", "30"]);
    expect(v.fractionnement.decalagesMois).toEqual([0, 4, 8]);
    expect(v.prorata.actif).toBe(false);
    expect(problemesVersion(v)).toEqual([]);
  });

  it("transforme une valeur de liste inconnue ou un nombre illisible en problème signalé, pas en erreur muette", () => {
    const v = lireVersion(formulaireBeni({ sens: "AU_HASARD", precision: "7", tranchesMax: "abc", dateEffet: "2026-13-01", repartition: "50 ; 49" }));
    const problemes = problemesVersion(v).join(" | ");

    expect(problemes).toContain("sens d'arrondi");
    expect(problemes).toContain("précision d'arrondi");
    expect(problemes).toContain("nombre maximal de tranches");
    expect(problemes).toContain("date d'effet");
    expect(problemes).toContain("100");
  });

  it("session 6.2a : le mode de tarification est FORMULE quand le champ manque, GARANTIES quand il est choisi, et une valeur inconnue est signalée", () => {
    expect(lireVersion(formulaireBeni()).modeTarification).toBe("FORMULE");
    expect(lireVersion(formulaireBeni({ modeTarification: "FORMULE" })).modeTarification).toBe("FORMULE");

    const garanties = lireVersion(formulaireBeni({ modeTarification: "GARANTIES" }));
    expect(garanties.modeTarification).toBe("GARANTIES");
    expect(problemesVersion(garanties)).toEqual([]);

    const inconnu = lireVersion(formulaireBeni({ modeTarification: "AU_HASARD" }));
    expect(problemesVersion(inconnu).join(" | ")).toContain("mode de tarification");
  });
});

describe("session 6.2b : garanties du produit", () => {
  it("une garantie par ligne, « Libellé » ou « Libellé ; BRANCHE » (branche en majuscules), lignes vides ignorées", () => {
    expect(lireGaranties("Incendie ; incendie\n\n  Vol  \r\nBris de glace;IARD\n")).toEqual([
      { libelle: "Incendie", branche: "INCENDIE" },
      { libelle: "Vol", branche: null },
      { libelle: "Bris de glace", branche: "IARD" },
    ]);
    expect(lireGaranties("")).toEqual([]);
  });

  it("le formulaire porte la liste et la case « saisie libre » ; sans le marqueur du formulaire, la saisie libre reste permise", () => {
    const d = formulaireBeni({ modeTarification: "GARANTIES", garanties: "Incendie ; INCENDIE\nVol", garantiesPresentes: "1" });
    const avec = lireVersion(d);
    expect(avec.garanties).toEqual([{ libelle: "Incendie", branche: "INCENDIE" }, { libelle: "Vol", branche: null }]);
    expect(avec.garantiesSaisieLibre).toBe(false); // case décochée dans un formulaire qui la propose
    d.set("garantiesSaisieLibre", "on");
    expect(lireVersion(d).garantiesSaisieLibre).toBe(true);
    expect(lireVersion(formulaireBeni()).garantiesSaisieLibre).toBe(true); // formulaire d'avant la 6.2b
    expect(lireVersion(formulaireBeni()).garanties).toEqual([]);
  });
});
