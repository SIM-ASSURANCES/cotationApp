// Session 5b : avis d'échéance et relances (CDC §12), règles pures. Données inventées.
import { describe, expect, it } from "vitest";

import { avisDu, echeancesDe, factureAppelable, PARAMETRES_RELANCE_DEFAUT, problemesParametresRelance, relanceDue } from "./echeances";

const facture = { statut: "EMISE", type: "AFFAIRE_NOUVELLE", dateEffet: "2026-01-01", ttc: "11592000", echeances: [1, 2, 3, 4].map((n) => ({ numero: n, date: `2026-${String(1 + (n - 1) * 3).padStart(2, "0")}-01`, montant: "2898000" })) };

describe("échéances d'une facture", () => {
  it("paiements imputés dans l'ordre : payée seulement si couverte en entier (H49)", () => {
    const e = echeancesDe(facture, "4898000");
    expect(e.map((x) => [x.numero, x.paye, x.restant, x.payee])).toEqual([
      [1, "2898000", "0", true],
      [2, "2000000", "898000", false],
      [3, "0", "2898000", false],
      [4, "0", "2898000", false],
    ]);
  });

  it("facture sans échéancier : une seule échéance, le terme, TTC entier à la date d'effet (H67)", () => {
    expect(echeancesDe({ ...facture, echeances: [], dateEffet: "2026-07-22", ttc: "122442" }, "41000")).toEqual([
      { numero: 1, date: "2026-07-22", montant: "122442", paye: "41000", restant: "81442", payee: false },
    ]);
  });

  it("seule une facture émise et non annulée appelle des paiements ; jamais un avoir", () => {
    expect(factureAppelable(facture)).toBe(true);
    expect(factureAppelable({ ...facture, statut: "ANNULEE" })).toBe(false);
    expect(factureAppelable({ ...facture, statut: "BROUILLON" })).toBe(false);
    expect(factureAppelable({ ...facture, statut: "A_VALIDER" })).toBe(false);
    expect(factureAppelable({ ...facture, type: "AVOIR" })).toBe(false);
  });
});

describe("avis d'échéance (J-x)", () => {
  const e = { date: "2026-04-01", payee: false };
  const p = { delaiAvisJours: 15 };
  it("de J-15 au jour de l'échéance ; pas avant, pas après (relances)", () => {
    expect(avisDu(e, p, "2026-03-16", false)).toBe(false);
    expect(avisDu(e, p, "2026-03-17", false)).toBe(true);
    expect(avisDu(e, p, "2026-04-01", false)).toBe(true);
    expect(avisDu(e, p, "2026-04-02", false)).toBe(false);
  });
  it("un seul avis par échéance ; rien pour une échéance payée", () => {
    expect(avisDu(e, p, "2026-03-20", true)).toBe(false);
    expect(avisDu({ ...e, payee: true }, p, "2026-03-20", false)).toBe(false);
  });
});

describe("relances (J+7, J+15, J+30)", () => {
  const e = { date: "2026-04-01", payee: false };
  const p = PARAMETRES_RELANCE_DEFAUT;
  it("le niveau atteint, un seul document par niveau", () => {
    expect(relanceDue(e, p, "2026-04-07", [])).toBeNull();
    expect(relanceDue(e, p, "2026-04-08", [])?.niveau).toBe(1);
    expect(relanceDue(e, p, "2026-04-10", [1])).toBeNull();
    expect(relanceDue(e, p, "2026-04-16", [1])?.niveau).toBe(2);
    expect(relanceDue(e, p, "2026-05-01", [1, 2])).toMatchObject({ niveau: 3, libelle: "Mise en demeure" });
    expect(relanceDue(e, p, "2026-06-01", [1, 2, 3])).toBeNull();
  });
  it("retard rattrapé : seulement le niveau le plus élevé atteint, jamais un niveau inférieur après lui (H68)", () => {
    expect(relanceDue(e, p, "2026-05-15", [])?.niveau).toBe(3);
    expect(relanceDue(e, p, "2026-04-20", [3])).toBeNull();
  });
  it("arrêt dès paiement", () => {
    expect(relanceDue({ ...e, payee: true }, p, "2026-05-01", [])).toBeNull();
  });
});

describe("paramètres des avis et relances", () => {
  it("les valeurs du CDC sont acceptées ; niveaux en ordre, délais croissants, libellés", () => {
    expect(problemesParametresRelance(PARAMETRES_RELANCE_DEFAUT)).toEqual([]);
    expect(problemesParametresRelance({ delaiAvisJours: -1, niveaux: [] })).toEqual(["Délai de l'avis d'échéance : un nombre entier de jours, de 0 à 365.", "Au moins un niveau de relance."]);
    expect(
      problemesParametresRelance({
        delaiAvisJours: 15,
        niveaux: [
          { niveau: 1, jours: 15, libelle: "A" },
          { niveau: 2, jours: 7, libelle: " " },
        ],
      }),
    ).toEqual(["Niveau 2 : son délai doit dépasser celui du niveau 1.", "Niveau 2 : libellé obligatoire (100 caractères au plus)."]);
  });
});
