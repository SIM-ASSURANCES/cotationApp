import { describe, expect, it } from "vitest";

import { ErreurExpression, formaterOperande, lireOperande } from "./expression";
import { documentSecurpro } from "./securpro-fixture";
import type { Operande } from "./schema";

describe("expressions d'assiette", () => {
  it("lit un champ, un nombre, un texte et une opération imbriquée", () => {
    expect(lireOperande("loyer_mensuel")).toBe("loyer_mensuel");
    expect(lireOperande("120")).toEqual({ k: "120" });
    expect(lireOperande('"120"')).toBe("120");
    expect(lireOperande("PREMIER(FOIS(loyer_mensuel; 120); valeur_batiment)")).toEqual(["PREMIER", ["FOIS", "loyer_mensuel", { k: "120" }], "valeur_batiment"]);
    expect(lireOperande("TABLE(limites)")).toEqual(["TABLE", "limites"]);
  });

  it("accepte la virgule comme séparateur, des espaces libres et un nom d'opération en minuscules", () => {
    expect(lireOperande("somme( stocks ,materiel )")).toEqual(["SOMME", "stocks", "materiel"]);
  });

  it("refuse une expression mal formée avec la position", () => {
    for (const mauvais of ["", "FOIS(a;", "FOIS(a b)", "a)", "FOIS()", '"ouvert', "a + b", "(a)"]) {
      expect(() => lireOperande(mauvais), mauvais).toThrow(ErreurExpression);
    }
    expect(() => lireOperande("a + b")).toThrow(/position 3/);
  });

  it("aller-retour exact sur toutes les assiettes et valeurs intermédiaires du SECURPRO inventé", () => {
    const operandes: Operande[] = [...documentSecurpro.intermediaires.map((i) => i.op as Operande), ...documentSecurpro.garanties.flatMap((g) => g.composantes.map((c) => c.assiette as Operande))];
    expect(operandes.length).toBeGreaterThan(8);
    for (const op of operandes) expect(lireOperande(formaterOperande(op))).toEqual(op);
  });

  it("un opérande texte qui ressemble à un nombre se distingue d'un nombre", () => {
    expect(lireOperande(formaterOperande("120"))).toBe("120");
    expect(lireOperande(formaterOperande({ k: "120" }))).toEqual({ k: "120" });
  });
});
