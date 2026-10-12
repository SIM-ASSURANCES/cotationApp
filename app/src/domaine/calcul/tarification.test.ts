import { describe, expect, it } from "vitest";

import {
  calculAutomatiquePossible,
  MESSAGE_TARIFICATION_PAR_GARANTIES,
  MODES_TARIFICATION,
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
  it("deux modes seulement, FORMULE d'abord (c'est le comportement d'avant)", () => {
    expect([...MODES_TARIFICATION]).toEqual(["FORMULE", "GARANTIES"]);
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
