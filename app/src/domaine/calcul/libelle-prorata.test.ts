import { describe, expect, it } from "vitest";

import { DecimalMontant } from "./montant";
import { libelleDureeEtProrata } from "./libelle-prorata";

describe("libelleDureeEtProrata", () => {
  it("303 jours : la phrase du calcul par formules, coefficient à cinq décimales et virgule", () => {
    const coef = new DecimalMontant(303).div(365);
    expect(libelleDureeEtProrata(303, coef)).toBe("303 jour(s) couverts, coefficient de prorata 0,83014");
    expect(libelleDureeEtProrata(303, coef.toFixed())).toBe("303 jour(s) couverts, coefficient de prorata 0,83014");
  });

  it("année pleine : coefficient 1", () => {
    expect(libelleDureeEtProrata(365, "1")).toBe("365 jour(s) couverts, coefficient de prorata 1");
  });

  it("sans prorata pour le produit : la phrase le dit", () => {
    expect(libelleDureeEtProrata(303, "1", false)).toBe("303 jour(s) couverts, coefficient de prorata 1 (ce produit n'applique pas de prorata)");
  });
});
