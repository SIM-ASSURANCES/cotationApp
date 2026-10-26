import { describe, expect, it } from "vitest";

import { calculAutomatiquePossible, compositionPossible, MODES_TARIFICATION, problemesVersion } from "../calcul/parametrage";
import { jsonCanonique } from "./canonique";
import { documentSecurpro } from "./securpro-fixture";

describe("jsonCanonique", () => {
  it("trie les clés à tous les niveaux et ne met aucun espace", () => {
    expect(jsonCanonique({ b: 1, a: { d: [{ z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}');
  });
  it("l'ordre des clés ne change pas le texte, l'ordre d'une liste le change", () => {
    expect(jsonCanonique({ a: 1, b: 2 })).toBe(jsonCanonique({ b: 2, a: 1 }));
    expect(jsonCanonique([1, 2])).not.toBe(jsonCanonique([2, 1]));
  });
  it("omet les clés undefined, garde null, refuse un nombre non fini", () => {
    expect(jsonCanonique({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => jsonCanonique({ a: Infinity })).toThrow();
  });
  it("le SECURPRO inventé : un aller-retour par JSON ne change pas le texte canonique", () => {
    const texte = jsonCanonique(documentSecurpro);
    expect(jsonCanonique(JSON.parse(texte))).toBe(texte);
  });
});

describe("mode BAREME", () => {
  it("est un mode de tarification, que ni le calcul automatique ni la composition manuelle n'acceptent encore (B6)", () => {
    expect(MODES_TARIFICATION).toContain("BAREME");
    expect(calculAutomatiquePossible("BAREME")).toBe(false);
    expect(compositionPossible("BAREME")).toBe(false);
  });
  it("une version au barème n'a pas besoin de formule", () => {
    const base = {
      dateEffet: "2030-01-01",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
      prorata: { actif: false, primeMinimale: null },
      fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: null,
      formules: [],
    } as never as Parameters<typeof problemesVersion>[0];
    expect(problemesVersion({ ...base, modeTarification: "BAREME" })).toEqual([]);
    expect(problemesVersion({ ...base, modeTarification: "FORMULE" })).toContain("Un produit doit avoir au moins une formule.");
  });
});
