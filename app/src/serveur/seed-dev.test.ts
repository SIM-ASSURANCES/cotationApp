import { describe, expect, it } from "vitest";

import { COMPTES_SEED_DEV, SeedRefuse, controlerEnvironnementSeed } from "./seed-dev";

// Mot de passe de test, inventé, conforme à la politique (12 caractères au moins, pas de mot courant…).
const CONFORME = "Rx7-cobalt-lune-42";
const ok = { NODE_ENV: "development", AUTORISER_SEED_DEV: "oui", SEED_MOT_DE_PASSE: CONFORME };

describe("seed de développement : gardes", () => {
  it("accepte un environnement de développement explicitement autorisé", () => {
    expect(controlerEnvironnementSeed(ok)).toBe(CONFORME);
    expect(controlerEnvironnementSeed({ ...ok, NODE_ENV: undefined })).toBe(CONFORME);
  });

  it("refuse si NODE_ENV=production, même autorisé", () => {
    expect(() => controlerEnvironnementSeed({ ...ok, NODE_ENV: "production" })).toThrow(/NODE_ENV=production/);
  });

  it.each([undefined, "", "non", "OUI", "true"])("refuse sans AUTORISER_SEED_DEV=oui (%s)", (valeur) => {
    expect(() => controlerEnvironnementSeed({ ...ok, AUTORISER_SEED_DEV: valeur })).toThrow(/AUTORISER_SEED_DEV=oui/);
  });

  it("refuse sans SEED_MOT_DE_PASSE", () => {
    expect(() => controlerEnvironnementSeed({ ...ok, SEED_MOT_DE_PASSE: undefined })).toThrow(/absente ou vide/);
    expect(() => controlerEnvironnementSeed({ ...ok, SEED_MOT_DE_PASSE: "" })).toThrow(/absente ou vide/);
  });

  it.each(["court-1", "Password123!", "aaaaaaaaaaaaaaaa", "secret-test.admin-2026"])("refuse un mot de passe hors politique, sans l'afficher (%s)", (faible) => {
    let message = "";
    try {
      controlerEnvironnementSeed({ ...ok, SEED_MOT_DE_PASSE: faible });
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(SeedRefuse);
      message = (erreur as Error).message;
    }
    expect(message).toMatch(/politique de mot de passe/);
    expect(message).not.toContain(faible);
  });

  it("un compte par profil du CDC §4, identifiants de test", () => {
    expect(COMPTES_SEED_DEV.map((c) => c.profil).sort()).toEqual(["ADMIN_SYSTEME", "COMMERCIAL", "COMPTABILITE", "DIRECTION_GENERALE", "GESTIONNAIRE_PRODUCTION", "TECHNIQUE"]);
    expect(COMPTES_SEED_DEV.every((c) => c.identifiant.startsWith("test."))).toBe(true);
  });
});
