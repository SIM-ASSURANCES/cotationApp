import { describe, expect, it } from "vitest";

import {
  CLE_SEUIL_VALIDATION_GLOBAL,
  problemesSeuilValidationGlobal,
  SEUIL_VALIDATION_GLOBAL_DEFAUT,
} from "./seuil-validation";

describe("seuil unique de validation global", () => {
  it("constantes par défaut", () => {
    expect(CLE_SEUIL_VALIDATION_GLOBAL).toBe("seuil_validation_global");
    expect(SEUIL_VALIDATION_GLOBAL_DEFAUT).toBe("10000000");
  });

  it("accepte un montant valide strictement positif", () => {
    expect(problemesSeuilValidationGlobal("10000000")).toEqual([]);
    expect(problemesSeuilValidationGlobal("10 000 000")).toEqual([]);
    expect(problemesSeuilValidationGlobal("5000000")).toEqual([]);
  });

  it("refuse un montant vide, négatif ou nul", () => {
    expect(problemesSeuilValidationGlobal("")).toContain("Le seuil de validation est obligatoire.");
    expect(problemesSeuilValidationGlobal("   ")).toContain("Le seuil de validation est obligatoire.");
    expect(problemesSeuilValidationGlobal("0")).toEqual(["Le seuil de validation doit être un montant strictement positif."]);
    expect(problemesSeuilValidationGlobal("-100")).toEqual(["Le seuil de validation doit être un montant strictement positif."]);
  });

  it("refuse une valeur non numérique", () => {
    const p = problemesSeuilValidationGlobal("abc");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/pas un montant valide/);
  });
});
