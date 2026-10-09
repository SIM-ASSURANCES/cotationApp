import { describe, expect, it } from "vitest";

import { estOuverte, tachesOuvertes } from "./taches";

// H64 : l'état d'une tâche se déduit des pièces émises.
describe("tâches d'une police après un import (H64)", () => {
  const cp = { type: "CP_A_EMETTRE" as const, versionAdherents: 3 };
  const avenant = { type: "FACTURE_AVENANT_A_EMETTRE" as const, versionAdherents: 3 };
  const rien = { cpVersionsAdherents: [], avenantsEmis: [] };

  it("ouvertes tant qu'aucune pièce n'est émise", () => {
    expect(tachesOuvertes([cp, avenant], rien)).toEqual([cp, avenant]);
  });

  it("CP : fermée par une version des CP qui reprend cette liste ou une plus récente, pas une plus ancienne", () => {
    expect(estOuverte(cp, { ...rien, cpVersionsAdherents: [1, 2] })).toBe(true);
    expect(estOuverte(cp, { ...rien, cpVersionsAdherents: [1, 3] })).toBe(false);
    expect(estOuverte(cp, { ...rien, cpVersionsAdherents: [4] })).toBe(false);
    expect(estOuverte(cp, { ...rien, cpVersionsAdherents: [null] })).toBe(true);
  });

  it("facture d'avenant : fermée seulement par une facture émise pour CETTE version de la liste", () => {
    expect(estOuverte(avenant, { ...rien, avenantsEmis: [2, 4] })).toBe(true);
    expect(estOuverte(avenant, { ...rien, avenantsEmis: [3] })).toBe(false);
  });
});
