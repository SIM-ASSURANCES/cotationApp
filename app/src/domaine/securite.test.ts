import { describe, expect, it } from "vitest";

import {
  DUREE_VERROUILLAGE_MINUTES,
  MAX_ECHECS_CONSECUTIFS,
  estVerrouille,
  etatApresEchec,
  identifiantValide,
  normaliserIdentifiant,
  problemesMotDePasse,
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
