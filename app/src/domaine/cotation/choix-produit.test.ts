import { describe, expect, it } from "vitest";

import { branchesDesProduits, produitsDeLaBranche, SANS_BRANCHE, type ProduitProposable } from "./choix-produit";

const p = (code: string, branchePrincipale: string | null, branchePrincipaleLibelle: string | null): ProduitProposable => ({ code, libelle: `Produit ${code}`, branchePrincipale, branchePrincipaleLibelle });

const PRODUITS = [
  p("SECURPRO", "IARD", "IARD"),
  p("RELAXSANTE", "SANTE", "Santé"),
  p("ABATA", "ACCIDENTS", "Accidents"),
  p("RELAXACCIDENTS", "ACCIDENTS", "Accidents"),
  p("ANCIEN", null, null),
];

describe("branchesDesProduits", () => {
  it("une entrée par branche qui a des produits, par libellé, avec leur nombre", () => {
    expect(branchesDesProduits(PRODUITS).map((b) => [b.code, b.produits])).toEqual([
      ["ACCIDENTS", 2],
      ["IARD", 1],
      ["SANTE", 1],
      [SANS_BRANCHE, 1],
    ]);
  });

  it("les produits sans branche principale ne disparaissent pas : dernière entrée", () => {
    const b = branchesDesProduits(PRODUITS);
    expect(b[b.length - 1]).toMatchObject({ code: SANS_BRANCHE, libelle: "Sans branche principale (à renseigner)" });
  });

  it("aucune entrée sans produit, et aucune entrée « sans branche » si tous en ont une", () => {
    expect(branchesDesProduits([])).toEqual([]);
    expect(branchesDesProduits([p("A", "SANTE", "Santé")]).map((b) => b.code)).toEqual(["SANTE"]);
  });
});

describe("produitsDeLaBranche : liste filtrée", () => {
  it("ne garde que les produits de la branche choisie, par code", () => {
    expect(produitsDeLaBranche(PRODUITS, "ACCIDENTS").map((x) => x.code)).toEqual(["ABATA", "RELAXACCIDENTS"]);
    expect(produitsDeLaBranche(PRODUITS, "SANTE").map((x) => x.code)).toEqual(["RELAXSANTE"]);
  });

  it("les produits sans branche se choisissent par leur entrée dédiée", () => {
    expect(produitsDeLaBranche(PRODUITS, SANS_BRANCHE).map((x) => x.code)).toEqual(["ANCIEN"]);
  });

  it("aucune branche choisie, ou branche inconnue : aucun produit (on choisit la branche d'abord)", () => {
    expect(produitsDeLaBranche(PRODUITS, "")).toEqual([]);
    expect(produitsDeLaBranche(PRODUITS, "MOTO")).toEqual([]);
  });

  it("l'union des listes filtrées retrouve tous les produits : rien n'est perdu ni dupliqué", () => {
    const codes = branchesDesProduits(PRODUITS).flatMap((b) => produitsDeLaBranche(PRODUITS, b.code).map((x) => x.code));
    expect(codes.sort()).toEqual(PRODUITS.map((x) => x.code).sort());
  });
});
