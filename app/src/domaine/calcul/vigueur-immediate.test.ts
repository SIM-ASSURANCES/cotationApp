// D66 : version au barème « en préparation », date provisoire « dès la publication », mode figé par produit. Pur, sans base.
import { describe, expect, it } from "vitest";

import { DATE_EFFET_A_LA_PUBLICATION, enVigueur, estEffetALaPublication, estEnPreparation, problemeChangementDeMode, problemesVersion, type VersionSaisie } from "./parametrage";

const base: VersionSaisie = {
  dateEffet: "2026-11-09",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
};

describe("D66 : état « en préparation »", () => {
  it("seule une version au barème sans barème publié est en préparation", () => {
    expect(estEnPreparation({ modeTarification: "BAREME" }, false)).toBe(true);
    expect(estEnPreparation({ modeTarification: "BAREME" }, true)).toBe(false);
    expect(estEnPreparation({ modeTarification: "GARANTIES" }, false)).toBe(false); // version provisoire d'avant D66 : inchangée
    expect(estEnPreparation({ modeTarification: "FORMULE" }, false)).toBe(false);
  });

  it("enVigueur ne retient jamais une version en préparation : la précédente continue de servir", () => {
    const versions = [
      { id: 1, dateEffet: "2026-01-01", enPreparation: false },
      { id: 2, dateEffet: "2026-10-01", enPreparation: true },
      { id: 3, dateEffet: DATE_EFFET_A_LA_PUBLICATION, enPreparation: true },
    ];
    expect(enVigueur(versions, "2026-11-09")?.id).toBe(1);
    expect(enVigueur(versions.slice(1), "2026-11-09")).toBeNull();
    // Une version sans l'indicateur (appelants d'avant D66) se comporte comme avant.
    expect(enVigueur([{ dateEffet: "2026-01-01" }, { dateEffet: "2026-10-01" }], "2026-11-09")?.dateEffet).toBe("2026-10-01");
  });

  it("la date provisoire est lointaine et se reconnaît", () => {
    expect(estEffetALaPublication(DATE_EFFET_A_LA_PUBLICATION)).toBe(true);
    expect(estEffetALaPublication("2026-11-09")).toBe(false);
    expect(DATE_EFFET_A_LA_PUBLICATION > "2999-12-31").toBe(true);
  });

  it("« dès la publication » n'existe que pour une version au barème", () => {
    expect(problemesVersion({ ...base, modeTarification: "BAREME", dateEffet: DATE_EFFET_A_LA_PUBLICATION })).toEqual([]);
    expect(problemesVersion({ ...base, modeTarification: "GARANTIES", dateEffet: DATE_EFFET_A_LA_PUBLICATION }).join(" ")).toMatch(/Dès la publication/);
    expect(problemesVersion({ ...base, modeTarification: undefined, dateEffet: DATE_EFFET_A_LA_PUBLICATION, formules: [] }).join(" ")).toMatch(/Dès la publication/);
  });
});

describe("D66 : le mode de tarification est figé par produit", () => {
  it("première version : aucun refus, quel que soit le mode", () => {
    for (const m of ["FORMULE", "GARANTIES", "BAREME", undefined]) expect(problemeChangementDeMode(null, m)).toBeNull();
  });

  it("une version suivante garde le mode de la précédente ; le mode absent est accepté", () => {
    expect(problemeChangementDeMode("FORMULE", "FORMULE")).toBeNull();
    expect(problemeChangementDeMode("BAREME", undefined)).toBeNull();
  });

  it("tout passage vers un autre mode est refusé, dans les six sens, avec le nom des deux modes", () => {
    const modes = ["FORMULE", "GARANTIES", "BAREME"];
    for (const de of modes) {
      for (const vers of modes.filter((m) => m !== de)) {
        const refus = problemeChangementDeMode(de, vers);
        expect(refus, `${de} -> ${vers}`).toMatch(/figé par produit/);
        expect(refus).toMatch(/nouveau produit/);
      }
    }
    expect(problemeChangementDeMode("FORMULE", "BAREME")).toContain("Par formule");
    expect(problemeChangementDeMode("FORMULE", "BAREME")).toContain("Au barème");
  });
});
