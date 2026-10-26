// Accessoires par tranche d'effectif (B6a, D51) : chaque borne, les trous, les chevauchements, le mode du produit ou de la garantie.
import { describe, expect, it } from "vitest";

import { calculerBareme } from "./bareme";
import { documentSecurpro, parametresEssai } from "./securpro-fixture";
import { lireBareme, type Bareme } from "./schema";
import { formaterTranches, lireTranches, montantDeTranche, problemesTranches, type Tranche } from "./tranches";
import { verifierBareme } from "./verification";

const TRANCHES: Tranche[] = [
  { de: 1, a: 5, montant: "2500" },
  { de: 6, a: 10, montant: "4000" },
  { de: 11, a: 20, montant: "6000" },
];

type Doc = { produit: { accessoires?: unknown }; garanties: { code: string; accessoires?: unknown }[] };
const avec = (modif: (d: Doc) => void): Bareme => {
  const d = structuredClone(documentSecurpro) as unknown as Doc;
  modif(d);
  return lireBareme(d);
};
const essai = documentSecurpro.jeuxEssai[1].entrees; // Bureau, propriétaire : Incendie et Vol (caisse)

/** Accessoires de chaque garantie souscrite pour un effectif. */
const accessoires = (b: Bareme, effectif?: number) => {
  const r = calculerBareme(b, { champs: essai.champs as never, souscrit: essai.souscrit, ...(effectif !== undefined ? { effectif } : {}) }, parametresEssai());
  return r.ok ? r.detail.map((d) => d.accessoires.toFixed()) : r.refus.map((x) => x.code);
};

describe("accessoires par tranche d'effectif — mode du produit", () => {
  const produit = avec((d) => (d.produit.accessoires = { mode: "PAR_TRANCHE", tranches: TRANCHES }));

  it.each([
    [1, "2500"],
    [5, "2500"],
    [6, "4000"],
    [10, "4000"],
    [11, "6000"],
    [20, "6000"],
  ])("effectif %i : %s par garantie souscrite (chaque borne des trois tranches)", (effectif, montant) => {
    expect(accessoires(produit, effectif)).toEqual([montant, montant]);
  });

  it("un effectif hors tranches est refusé, nommé (0 et 21 de part et d'autre)", () => {
    expect(accessoires(produit, 0)).toEqual(["EFFECTIF_INVALIDE"]);
    const r = calculerBareme(produit, { champs: essai.champs as never, souscrit: essai.souscrit, effectif: 21 }, parametresEssai());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refus[0]).toMatchObject({ code: "EFFECTIF_HORS_TRANCHES", message: expect.stringContaining("n'est dans aucune tranche d'accessoires (de 1 à 20)") });
  });

  it("l'effectif est obligatoire : jamais un effectif de 1 supposé", () => {
    expect(accessoires(produit)).toEqual(["EFFECTIF_MANQUANT"]);
  });
});

describe("accessoires par tranche d'effectif — mode de la garantie", () => {
  it("une garantie a ses propres tranches ; les autres gardent l'accessoire du produit", () => {
    const b = avec((d) => {
      d.produit.accessoires = { mode: "PAR_GARANTIE", montant: "2500" };
      d.garanties.find((g) => g.code === "vol")!.accessoires = { mode: "PAR_TRANCHE", tranches: TRANCHES };
    });
    expect(accessoires(b, 7)).toEqual(["2500", "4000"]); // Incendie : produit ; Vol : tranche 6 à 10
    expect(accessoires(b, 21)).toEqual(["EFFECTIF_HORS_TRANCHES"]);
  });
});

describe("tranches bornées, sans trou ni chevauchement (verifierBareme)", () => {
  const codes = (tranches: unknown) => verifierBareme(avec((d) => (d.produit.accessoires = { mode: "PAR_TRANCHE", tranches }))).map((p) => p.code);

  it("des tranches valides ne donnent aucun problème, dans n'importe quel ordre", () => {
    expect(codes(TRANCHES)).toEqual([]);
    expect(codes([...TRANCHES].reverse())).toEqual([]);
  });
  it("un trou, un chevauchement, un début différent de 1 et une tranche inversée sont nommés", () => {
    expect(codes([{ de: 1, a: 5, montant: "1" }, { de: 7, a: 10, montant: "1" }])).toEqual(["TRANCHES_TROU"]);
    expect(codes([{ de: 1, a: 5, montant: "1" }, { de: 5, a: 10, montant: "1" }])).toEqual(["TRANCHES_CHEVAUCHEMENT"]);
    expect(codes([{ de: 2, a: 5, montant: "1" }])).toEqual(["TRANCHES_DEBUT"]);
    expect(codes([{ de: 1, a: 5, montant: "1" }, { de: 8, a: 6, montant: "1" }])).toContain("TRANCHE_INVERSEE");
  });
  it("le message dit quels effectifs ne sont pas couverts", () => {
    const p = verifierBareme(avec((d) => (d.produit.accessoires = { mode: "PAR_TRANCHE", tranches: [{ de: 1, a: 5, montant: "1" }, { de: 9, a: 10, montant: "1" }] })));
    expect(p[0].message).toContain("effectifs 6 à 8");
  });
  it("le schéma refuse des tranches vides ou un montant non décimal", () => {
    expect(() => avec((d) => (d.produit.accessoires = { mode: "PAR_TRANCHE", tranches: [] }))).toThrow();
    expect(() => avec((d) => (d.produit.accessoires = { mode: "PAR_TRANCHE", tranches: [{ de: 1, a: 5, montant: "abc" }] }))).toThrow();
  });
});

describe("écriture des tranches dans une cellule", () => {
  it("aller-retour exact", () => {
    expect(formaterTranches(TRANCHES)).toBe("1-5: 2500; 6-10: 4000; 11-20: 6000");
    expect(lireTranches(formaterTranches(TRANCHES))).toEqual(TRANCHES);
  });
  it("accepte la virgule décimale et « à » ; refuse le reste, avec la tranche en cause", () => {
    expect(lireTranches("1 à 5 = 2500,50")).toEqual([{ de: 1, a: 5, montant: "2500.50" }]);
    expect(() => lireTranches("1-5 2500")).toThrow(/« 1-5 2500 » illisible/);
    expect(() => lireTranches("")).toThrow();
  });
  it("montantDeTranche et problemesTranches sont cohérents", () => {
    expect(montantDeTranche(TRANCHES, 11)?.toFixed()).toBe("6000");
    expect(montantDeTranche(TRANCHES, 21)).toBeUndefined();
    expect(problemesTranches(TRANCHES)).toEqual([]);
  });
});
