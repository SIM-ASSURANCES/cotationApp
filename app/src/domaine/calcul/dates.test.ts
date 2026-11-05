import { describe, expect, it } from "vitest";

import {
  aujourdhui,
  FUSEAU_ABIDJAN,
  fixerDateMinimumEffetPourTests,
  formaterDate,
  MESSAGE_DATE_EFFET_PASSEE,
  normaliserDateSaisie,
  problemesDateEffetCotation,
} from "./dates";

describe("dates (D37, H107)", () => {
  it("calcule la date du jour dans le fuseau Africa/Abidjan (UTC+0)", () => {
    expect(FUSEAU_ABIDJAN).toBe("Africa/Abidjan");
    expect(aujourdhui(new Date("2026-10-20T23:30:00.000Z"))).toBe("2026-10-20");
    expect(aujourdhui(new Date("2026-10-21T00:05:00.000Z"))).toBe("2026-10-21");
  });

  it("formate les dates en JJ/MM/AAAA", () => {
    expect(formaterDate("2026-10-20")).toBe("20/10/2026");
    expect(formaterDate(null)).toBe("—");
    expect(formaterDate(undefined)).toBe("—");
    expect(formaterDate("")).toBe("—");
  });

  it("normalise une date saisie en JJ/MM/AAAA vers AAAA-MM-JJ", () => {
    expect(normaliserDateSaisie("20/10/2026")).toBe("2026-10-20");
    expect(normaliserDateSaisie("2026-10-20")).toBe("2026-10-20");
  });

  it("refuse une date d'effet antérieure à aujourd'hui et accepte aujourd'hui ou le futur", () => {
    fixerDateMinimumEffetPourTests(null);
    expect(problemesDateEffetCotation("2026-10-19", "2026-10-20")).toEqual([MESSAGE_DATE_EFFET_PASSEE]);
    expect(problemesDateEffetCotation("2026-10-20", "2026-10-20")).toEqual([]);
    expect(problemesDateEffetCotation("2026-10-21", "2026-10-20")).toEqual([]);
  });
});

describe("échéance d'une durée imposée (D64)", () => {
  it("effet + 1 an - 1 jour", async () => {
    const { echeanceUnAn } = await import("./dates");
    expect(echeanceUnAn("2027-01-01")).toBe("2027-12-31");
    expect(echeanceUnAn("2026-11-05")).toBe("2027-11-04");
    expect(echeanceUnAn("2027-03-01")).toBe("2028-02-29"); // l'année suivante est bissextile : 366 jours
    expect(echeanceUnAn("2028-02-29")).toBe("2029-02-27"); // H192 : le 29 février retombe au 28 février
  });
});
