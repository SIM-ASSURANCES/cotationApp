import { describe, expect, it } from "vitest";

import { regrouperParProduit, type ModeleRegroupable, type ProduitRegroupable } from "./regroupement-modeles";

const m = (id: number, type: string, produitCode: string | null, branchePrincipale: string | null): ModeleRegroupable => ({ id, type, produitCode, branchePrincipale });
const p = (code: string, branchePrincipale: string | null): ProduitRegroupable => ({ code, libelle: `Produit ${code}`, branchePrincipale });

const PRODUITS = [p("SECURPRO", "IARD"), p("ABATA", "ACCIDENTS"), p("RELAXACCIDENTS", "ACCIDENTS"), p("ANCIEN", null)];
const MODELES = [
  m(1, "COTATION", "SECURPRO", "IARD"),
  m(2, "CP", "SECURPRO", "IARD"),
  m(3, "SOUS_MODELE", "SECURPRO", "IARD"),
  m(4, "CG", null, "IARD"), // conditions générales de la branche
  m(5, "CP", "ABATA", "ACCIDENTS"),
  m(6, "CERTIFICAT", "ABATA", "ACCIDENTS"),
  m(7, "COTATION", "ABATA", "ACCIDENTS"),
  m(8, "FACTURE", null, null), // modèle transversal
];

describe("regrouperParProduit", () => {
  it("un produit = ses trois modèles attendus, déposés ou manquants", () => {
    const g = regrouperParProduit("IARD", PRODUITS, MODELES);
    expect(g.produits.map((x) => x.produit.code)).toEqual(["SECURPRO"]);
    const securpro = g.produits[0];
    expect(securpro.attendus.map((s) => [s.type, s.modeles.map((x) => x.id)])).toEqual([
      ["COTATION", [1]],
      ["CP", [2]],
      ["CERTIFICAT", []], // manque
    ]);
    expect(securpro.manquants).toBe(1);
    expect(securpro.autres.map((x) => x.id)).toEqual([3]); // le sous-modèle reste visible
  });

  it("un produit complet n'a aucun manquant ; un produit sans aucun modèle manque de tout", () => {
    const g = regrouperParProduit("ACCIDENTS", PRODUITS, MODELES);
    expect(g.produits.map((x) => [x.produit.code, x.manquants])).toEqual([
      ["ABATA", 0],
      ["RELAXACCIDENTS", 3],
    ]);
  });

  it("les modèles sans produit de la branche (CG…) sont à part ; ceux d'une autre branche ne s'y mêlent pas", () => {
    expect(regrouperParProduit("IARD", PRODUITS, MODELES).communs.map((x) => x.id)).toEqual([4]);
    expect(regrouperParProduit("ACCIDENTS", PRODUITS, MODELES).communs).toEqual([]);
  });

  it("branche sans branche principale : produits sans branche et modèles transversaux", () => {
    const g = regrouperParProduit(null, PRODUITS, MODELES);
    expect(g.produits.map((x) => x.produit.code)).toEqual(["ANCIEN"]);
    expect(g.communs.map((x) => x.id)).toEqual([8]);
  });

  it("rien ne disparaît : chaque modèle est dans un produit, ses autres, ou les communs de sa branche", () => {
    const vus: number[] = [];
    for (const b of ["IARD", "ACCIDENTS", null]) {
      const g = regrouperParProduit(b, PRODUITS, MODELES);
      for (const x of g.produits) vus.push(...x.attendus.flatMap((s) => s.modeles.map((y) => y.id)), ...x.autres.map((y) => y.id));
      vus.push(...g.communs.map((y) => y.id));
    }
    expect(vus.sort()).toEqual(MODELES.map((x) => x.id).sort());
  });

  it("un modèle d'un produit absent de la liste reste visible, dans les communs", () => {
    const g = regrouperParProduit("IARD", PRODUITS, [...MODELES, m(9, "CP", "FANTOME", "IARD")]);
    expect(g.communs.map((x) => x.id)).toEqual([4, 9]);
  });

  it("plusieurs modèles du même type pour un produit : tous listés", () => {
    const g = regrouperParProduit("IARD", PRODUITS, [...MODELES, m(10, "CP", "SECURPRO", "IARD")]);
    expect(g.produits[0].attendus[1].modeles.map((x) => x.id)).toEqual([2, 10]);
  });
});
