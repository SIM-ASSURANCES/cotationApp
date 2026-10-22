import { describe, expect, it } from "vitest";

import {
  DUREE_VERROUILLAGE_MINUTES,
  MAX_ECHECS_CONSECUTIFS,
  dateNouveauMotDePasse,
  estVerrouille,
  etatApresEchec,
  identifiantValide,
  normaliserIdentifiant,
  problemesMotDePasse,
  sessionToujoursValide,
} from "./securite";

const maintenant = new Date("2026-10-05T10:00:00Z");

describe("etatApresEchec", () => {
  it("compte les échecs sans verrouiller avant le seuil", () => {
    expect(etatApresEchec(0, maintenant)).toEqual({ echecsConsecutifs: 1, verrouilleJusqua: null });
    expect(etatApresEchec(MAX_ECHECS_CONSECUTIFS - 2, maintenant).verrouilleJusqua).toBeNull();
  });

  it("verrouille 15 minutes au 5e échec d'affilée et remet le compteur à zéro", () => {
    const etat = etatApresEchec(MAX_ECHECS_CONSECUTIFS - 1, maintenant);

    expect(etat.echecsConsecutifs).toBe(0);
    expect(etat.verrouilleJusqua?.getTime()).toBe(maintenant.getTime() + DUREE_VERROUILLAGE_MINUTES * 60_000);
  });
});

describe("estVerrouille", () => {
  it("est verrouillé tant que l'échéance n'est pas passée, libre ensuite", () => {
    const echeance = new Date(maintenant.getTime() + 1000);
    expect(estVerrouille(echeance, maintenant)).toBe(true);
    expect(estVerrouille(echeance, new Date(echeance.getTime()))).toBe(false);
    expect(estVerrouille(null, maintenant)).toBe(false);
  });
});

describe("problemesMotDePasse", () => {
  it("accepte une phrase de passe longue", () => {
    expect(problemesMotDePasse("cheval-agrafe-lune-42", "thierry")).toEqual([]);
  });

  it("refuse un mot de passe trop court, contenant l'identifiant, courant ou répétitif", () => {
    expect(problemesMotDePasse("Court1!", "thierry")).toContain("au moins 12 caractères");
    expect(problemesMotDePasse("xxThierryxx-abcdef", "Thierry")).toContain("ne doit pas contenir l'identifiant");
    expect(problemesMotDePasse("MonPassword-2026!", "thierry")).toContain("ne doit pas contenir un mot de passe courant");
    expect(problemesMotDePasse("aaaaaaaaaaaaaaaa", "thierry")).toContain("doit contenir au moins 5 caractères différents");
  });

  it("refuse un mot de passe de plus de 128 caractères (évite de hacher des volumes énormes)", () => {
    expect(problemesMotDePasse("ab1-".repeat(33), "thierry")).toContain("au plus 128 caractères");
  });
});

describe("identifiants", () => {
  it("normalise en minuscules sans espaces aux bords", () => {
    expect(normaliserIdentifiant("  T.Kouame ")).toBe("t.kouame");
  });

  it("n'accepte que des caractères sûrs", () => {
    expect(identifiantValide("t.kouame")).toBe(true);
    expect(identifiantValide("ab")).toBe(false);
    expect(identifiantValide("a b c")).toBe(false);
    expect(identifiantValide("admin'; DROP TABLE")).toBe(false);
  });
});

describe("session et date du mot de passe (audit m1)", () => {
  const dateEnBase = new Date("2026-10-05T10:00:00.000Z");

  it("la session reste valide tant que la date du jeton est celle de la base", () => {
    expect(sessionToujoursValide(dateEnBase.getTime(), dateEnBase)).toBe(true);
  });

  it("elle est refusée après un changement de mot de passe, ou si le jeton n'a pas de date (ouvert avant la migration)", () => {
    expect(sessionToujoursValide(dateEnBase.getTime(), new Date("2026-10-06T08:00:00.000Z"))).toBe(false);
    expect(sessionToujoursValide(undefined, dateEnBase)).toBe(false);
    expect(sessionToujoursValide("1790000000000", dateEnBase)).toBe(false);
  });

  it("la nouvelle date est toujours strictement postérieure à la précédente, même à la même milliseconde", () => {
    expect(dateNouveauMotDePasse(dateEnBase, new Date("2026-10-05T10:00:05.000Z")).toISOString()).toBe("2026-10-05T10:00:05.000Z");
    expect(dateNouveauMotDePasse(dateEnBase, dateEnBase).getTime()).toBe(dateEnBase.getTime() + 1);
    expect(dateNouveauMotDePasse(dateEnBase, new Date("2026-10-05T09:00:00.000Z")).getTime()).toBe(dateEnBase.getTime() + 1); // horloge en retard
  });
});
