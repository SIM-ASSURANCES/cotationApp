// Session 5b : tableaux de bord, agrégations pures. Données inventées.
import { describe, expect, it } from "vitest";

import { dateValide } from "../calcul/dates";
import { cotationsParStatut, impayesParAnciennete, parTypeEtMois, pourcentage, problemesPeriode, somme, tauxTransformation, trancheDe } from "./indicateurs";

describe("cotations", () => {
  it("par statut réel : une émise dont la validité est dépassée compte « Expirée »", () => {
    const c = cotationsParStatut(
      [
        { statut: "BROUILLON", dateValidite: null },
        { statut: "EMISE", dateValidite: "2026-12-31" },
        { statut: "EMISE", dateValidite: "2026-01-31" },
        { statut: "ACCEPTEE", dateValidite: "2026-01-31" },
      ],
      "2026-10-09",
    );
    expect(c).toEqual({ BROUILLON: 1, A_VALIDER: 0, EMISE: 1, ACCEPTEE: 1, REFUSEE: 0, EXPIREE: 1 });
  });

  it("taux de transformation : acceptées / émises, à une décimale ; null sans cotation émise", () => {
    expect(tauxTransformation([
      { cle: "RELAXSANTE", acceptee: true },
      { cle: "RELAXSANTE", acceptee: false },
      { cle: "RELAXSANTE", acceptee: false },
      { cle: "AUTO", acceptee: true },
    ])).toEqual([
      { cle: "AUTO", emises: 1, acceptees: 1, taux: "100.0" },
      { cle: "RELAXSANTE", emises: 3, acceptees: 1, taux: "33.3" },
    ]);
    expect(pourcentage(0, 0)).toBeNull();
    expect(pourcentage(2, 3)).toBe("66.7");
  });
});

describe("facturation", () => {
  it("impayés par ancienneté : échéances échues seulement, bornes 30 et 60 jours incluses dans la tranche basse", () => {
    expect([0, 30, 31, 60, 61].map(trancheDe)).toEqual(["0-30", "0-30", "31-60", "31-60", "60+"]);
    expect(
      impayesParAnciennete(
        [
          { date: "2026-10-09", restant: "100" }, // échue du jour : 0 jour
          { date: "2026-09-09", restant: "200" }, // 30 jours
          { date: "2026-09-08", restant: "300" }, // 31 jours
          { date: "2026-07-01", restant: "400" }, // 100 jours
          { date: "2026-07-01", restant: "0" }, // payée
          { date: "2026-10-10", restant: "999" }, // à venir : pas un impayé
        ],
        "2026-10-09",
      ),
    ).toEqual({ "0-30": { nombre: 2, montant: "300" }, "31-60": { nombre: 1, montant: "300" }, "60+": { nombre: 1, montant: "400" } });
  });

  it("somme de montants en texte", () => {
    expect(somme(["11592000", "-11592000", "122442"])).toBe("122442");
  });
});

describe("production et période", () => {
  it("documents par type et par mois", () => {
    expect(parTypeEtMois([{ type: "FACTURE", date: "2026-09-30" }, { type: "FACTURE", date: "2026-10-01" }, { type: "AVOIR", date: "2026-10-02" }, { type: "FACTURE", date: "2026-10-09" }])).toEqual([
      { mois: "2026-09", type: "FACTURE", nombre: 1 },
      { mois: "2026-10", type: "AVOIR", nombre: 1 },
      { mois: "2026-10", type: "FACTURE", nombre: 2 },
    ]);
  });

  it("période contrôlée", () => {
    expect(problemesPeriode({ debut: "2026-01-01", fin: "2026-10-09" }, dateValide)).toEqual([]);
    expect(problemesPeriode({ debut: "2026-10-10", fin: "2026-10-09" }, dateValide)).toEqual(["Période : le début est après la fin."]);
    expect(problemesPeriode({ debut: "2026-13-01", fin: "2026-10-09" }, dateValide)).toHaveLength(1);
  });
});
