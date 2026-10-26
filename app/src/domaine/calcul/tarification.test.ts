import { describe, expect, it } from "vitest";

import {
  calculAutomatiquePossible,
  compositionPossible,
  MESSAGE_TARIFICATION_PAR_GARANTIES,
  MODES_TARIFICATION,
  problemesLibellesGaranties,
  problemesVersion,
  type VersionSaisie,
} from "./parametrage";

/** Version minimale valide (chiffres inventés). */
const version = (surcharge: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet: "2026-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: true, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [{ code: "UNIQUE", libelle: "Formule unique", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" }],
  ...surcharge,
});

describe("session 6.2a : mode de tarification", () => {
  it("trois modes, FORMULE d'abord (c'est le comportement d'avant), BAREME ajouté en B3 (D49)", () => {
    expect([...MODES_TARIFICATION]).toEqual(["FORMULE", "GARANTIES", "BAREME"]);
  });

  it("le message de refus est celui fixé par la Technique, mot pour mot", () => {
    expect(MESSAGE_TARIFICATION_PAR_GARANTIES).toBe("Ce produit se tarifie par garanties : la prime doit être composée par la Technique (composition manuelle)");
  });

  it("seul FORMULE se calcule automatiquement ; GARANTIES, une valeur vide, une casse différente ou inconnue sont refusés (sûreté par défaut)", () => {
    expect(calculAutomatiquePossible("FORMULE")).toBe(true);
    for (const mode of ["GARANTIES", "", "formule", "Formule", " FORMULE", "AUTRE", "INVALIDE"]) {
      expect(calculAutomatiquePossible(mode), `mode « ${mode} »`).toBe(false);
    }
  });

  it("une version sans mode (saisie d'avant la 6.2a) reste valide ; les deux modes sont acceptés", () => {
    expect(problemesVersion(version())).toEqual([]);
    expect(problemesVersion(version({ modeTarification: "FORMULE" }))).toEqual([]);
    expect(problemesVersion(version({ modeTarification: "GARANTIES" }))).toEqual([]);
  });

  it("un mode inconnu est signalé par un message, pas ignoré", () => {
    const problemes = problemesVersion(version({ modeTarification: "INVALIDE" as never }));
    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain("mode de tarification");
  });
});

describe("session 6.2b : composition, formules facultatives et liste des garanties", () => {
  it("seul GARANTIES se compose (la chaîne exacte) ; FORMULE se calcule, jamais les deux", () => {
    expect(compositionPossible("GARANTIES")).toBe(true);
    for (const mode of ["FORMULE", "", "garanties", "AUTRE"]) expect(compositionPossible(mode), mode).toBe(false);
    for (const mode of MODES_TARIFICATION) expect(compositionPossible(mode) && calculAutomatiquePossible(mode)).toBe(false);
  });

  it("une version par garanties n'a pas besoin de formule (H85 relâchée) ; à la formule, il en faut une", () => {
    expect(problemesVersion(version({ modeTarification: "GARANTIES", formules: [] }))).toEqual([]);
    expect(problemesVersion(version({ modeTarification: "FORMULE", formules: [] }))).toEqual(["Un produit doit avoir au moins une formule."]);
  });

  it("les frais de fractionnement ne s'ajoutent pas en mode par garanties (ils se saisissent comme une ligne de prime)", () => {
    const frais = { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "500" };
    expect(problemesVersion(version({ modeTarification: "GARANTIES", fractionnement: frais })).join(" ")).toContain("frais de fractionnement");
    expect(problemesVersion(version({ modeTarification: "FORMULE", fractionnement: frais }))).toEqual([]);
  });

  it("liste des garanties : libellés uniques de 1 à 100 caractères, branche en code valide, 30 au plus, interdite à la formule", () => {
    const g = (libelle: string, branche: string | null = null) => ({ libelle, branche });
    expect(problemesVersion(version({ modeTarification: "GARANTIES", garanties: [g("Incendie", "INCENDIE"), g("Vol")] }))).toEqual([]);
    expect(problemesVersion(version({ modeTarification: "GARANTIES", garanties: [g("Vol"), g(" vol ")] })).join(" ")).toContain("en double");
    expect(problemesVersion(version({ modeTarification: "GARANTIES", garanties: [g("")] })).join(" ")).toContain("libellé");
    expect(problemesVersion(version({ modeTarification: "GARANTIES", garanties: [g("x".repeat(101))] })).join(" ")).toContain("libellé");
    expect(problemesVersion(version({ modeTarification: "GARANTIES", garanties: [g("Vol", "iard")] })).join(" ")).toContain("branche invalide");
    expect(problemesVersion(version({ modeTarification: "GARANTIES", garanties: Array.from({ length: 31 }, (_, i) => g(`G${i}`)) })).join(" ")).toContain("Au plus 30");
    expect(problemesVersion(version({ modeTarification: "FORMULE", garanties: [g("Vol")] })).join(" ")).toContain("n'a de sens qu'en mode par garanties");
    expect(problemesVersion(version({ modeTarification: "GARANTIES", garantiesSaisieLibre: false, garanties: [] })).join(" ")).toContain("saisie libre est interdite");
  });

  it("libellés refusés : seulement quand la saisie libre est interdite, sans tenir compte de la casse ni des espaces de bord", () => {
    const v = { garanties: [{ libelle: "Incendie", branche: null }, { libelle: "Vol", branche: null }] };
    expect(problemesLibellesGaranties({ ...v, garantiesSaisieLibre: true }, ["Bris de glace"])).toEqual([]);
    expect(problemesLibellesGaranties({ garanties: [], garantiesSaisieLibre: undefined }, ["Quoi que ce soit"])).toEqual([]);
    expect(problemesLibellesGaranties({ ...v, garantiesSaisieLibre: false }, ["  vol ", "INCENDIE"])).toEqual([]);
    expect(problemesLibellesGaranties({ ...v, garantiesSaisieLibre: false }, ["Vol", "Bris de glace"])).toEqual(["Ligne 2 : « Bris de glace » n'est pas une garantie de ce produit (la saisie libre est interdite)."]);
  });
});
