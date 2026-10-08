import { describe, expect, it } from "vitest";

import { choisirTaux, periodesSeChevauchent, type LigneTaux } from "./taxes";

const ligne = (surcharge: Partial<LigneTaux>): LigneTaux => ({
  branche: "SANTE",
  typeContrat: null,
  tauxPourcent: "1",
  tauxMixte: false,
  assiette: "NETTE_ACCESSOIRES",
  dateEffet: "2026-01-01",
  dateFin: null,
  ...surcharge,
});

/** Taux de la loi communiqués par la Technique le 08/10/2026 (D18), en données de test. */
const loi: LigneTaux[] = [
  ligne({ branche: "IA", tauxPourcent: "7.25" }),
  ligne({ branche: "DECES", tauxPourcent: "0" }),
  ligne({ branche: "SANTE", typeContrat: "INDIVIDUEL", tauxPourcent: "4" }),
  ligne({ branche: "SANTE", typeContrat: "GROUPE", tauxPourcent: "1.5" }),
  ligne({ branche: "IARD", tauxPourcent: null, tauxMixte: true }),
];

describe("choix du taux de taxe (D18, H29)", () => {
  it("prend la ligne la plus précise : le type du contrat avant « tous types »", () => {
    const lignes = [...loi, ligne({ branche: "IA", typeContrat: "GROUPE", tauxPourcent: "5" })];

    expect(choisirTaux(lignes, "IA", "GROUPE", "2026-10-08").tauxPourcent).toBe("5");
    expect(choisirTaux(lignes, "IA", "INDIVIDUEL", "2026-10-08").tauxPourcent).toBe("7.25");
    expect(choisirTaux(lignes, "DECES", "FAMILLE", "2026-10-08").tauxPourcent).toBe("0");
  });

  it("santé : 4 % en individuel, 1,5 % en groupe ; FAMILLE → INDIVIDUEL et GROUPE_OUVERT → GROUPE (H29)", () => {
    expect(choisirTaux(loi, "SANTE", "INDIVIDUEL", "2026-10-08").tauxPourcent).toBe("4");
    expect(choisirTaux(loi, "SANTE", "GROUPE", "2026-10-08").tauxPourcent).toBe("1.5");
    expect(choisirTaux(loi, "SANTE", "FAMILLE", "2026-10-08").tauxPourcent).toBe("4");
    expect(choisirTaux(loi, "SANTE", "GROUPE_OUVERT", "2026-10-08").tauxPourcent).toBe("1.5");
  });

  it("une ligne propre au type FAMILLE l'emporte sur le rattachement H29", () => {
    const lignes = [...loi, ligne({ branche: "SANTE", typeContrat: "FAMILLE", tauxPourcent: "3" })];

    expect(choisirTaux(lignes, "SANTE", "FAMILLE", "2026-10-08").tauxPourcent).toBe("3");
  });

  it("IARD : refuse le calcul tant que le taux mixte n'est pas paramétré", () => {
    expect(() => choisirTaux(loi, "IARD", "INDIVIDUEL", "2026-10-08")).toThrow("taux mixte non pris en charge : à paramétrer");
  });

  it("refuse une date sans taux et choisit la période en vigueur, bornes incluses", () => {
    const lignes = [
      ligne({ tauxPourcent: "1.5", dateEffet: "2020-01-01", dateFin: "2026-08-31" }),
      ligne({ tauxPourcent: "1.9", dateEffet: "2026-09-01" }),
    ];

    expect(() => choisirTaux(lignes, "SANTE", "GROUPE", "2019-12-31")).toThrow(/Aucune taxe/);
    expect(choisirTaux(lignes, "SANTE", "GROUPE", "2026-08-31").tauxPourcent).toBe("1.5");
    expect(choisirTaux(lignes, "SANTE", "GROUPE", "2026-09-01").tauxPourcent).toBe("1.9");
  });

  it("détecte le chevauchement de deux périodes (fin incluse, sans fin = toujours)", () => {
    const ouverte = { dateEffet: "2026-01-01", dateFin: null };

    expect(periodesSeChevauchent(ouverte, { dateEffet: "2030-01-01", dateFin: null })).toBe(true);
    expect(periodesSeChevauchent({ dateEffet: "2026-01-01", dateFin: "2026-06-30" }, { dateEffet: "2026-06-30", dateFin: null })).toBe(true);
    expect(periodesSeChevauchent({ dateEffet: "2026-01-01", dateFin: "2026-06-30" }, { dateEffet: "2026-07-01", dateFin: null })).toBe(false);
  });
});
