import { describe, expect, it } from "vitest";

import { cgEnVigueurLe, messageCgManquante, problemesRattachementCg } from "./cg-branche";

describe("CG par branche : rattachement en vigueur (étape 6, D42)", () => {
  const lignes = [
    { dateEffet: "2026-01-01", modeleCode: "CG_V1" },
    { dateEffet: "2026-12-01", modeleCode: "CG_V3" },
    { dateEffet: "2026-06-01", modeleCode: "CG_V2" },
  ];

  it("retient la ligne la plus récente dont la date d'effet est atteinte, quel que soit l'ordre", () => {
    expect(cgEnVigueurLe(lignes, "2026-03-15")?.modeleCode).toBe("CG_V1");
    expect(cgEnVigueurLe(lignes, "2026-06-01")?.modeleCode).toBe("CG_V2"); // le jour même
    expect(cgEnVigueurLe(lignes, "2027-01-01")?.modeleCode).toBe("CG_V3");
  });

  it("aucune CG avant la première date d'effet, ni sans ligne", () => {
    expect(cgEnVigueurLe(lignes, "2025-12-31")).toBeNull();
    expect(cgEnVigueurLe([], "2026-03-15")).toBeNull();
  });

  it("valide la saisie : code de modèle et date", () => {
    expect(problemesRattachementCg({ modeleCode: "CG_SANTE", dateEffet: "2026-11-01" })).toEqual([]);
    expect(problemesRattachementCg({ modeleCode: "", dateEffet: "2026-11-01" })).toHaveLength(1);
    expect(problemesRattachementCg({ modeleCode: "CG_SANTE", dateEffet: "2026-13-45" })).toHaveLength(1);
  });

  it("messages de refus : produit sans branche, branche sans CG", () => {
    expect(messageCgManquante("SECURPRO", null, "2026-10-22")).toContain("n'a pas de branche principale");
    const m = messageCgManquante("SECURPRO", { code: "RECOLTE", libelle: "Récolte" }, "2026-10-22");
    expect(m).toContain("« Récolte »");
    expect(m).toContain("Paramétrage > Conditions générales");
  });
});
