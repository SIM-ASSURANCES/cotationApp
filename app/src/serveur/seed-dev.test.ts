import { describe, expect, it } from "vitest";

import { COMPTES_SEED_DEV, SeedRefuse, comptesHorsSeed, controlerBaseSansComptesHorsSeed, controlerEnvironnementSeed, executerSeedDev } from "./seed-dev";

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

describe("seed de développement : garde de la base (audit m7)", () => {
  const client = (identifiants: string[]) => ({ utilisateur: { findMany: async () => identifiants.map((identifiant) => ({ identifiant })) } });
  const duSeed = COMPTES_SEED_DEV.map((c) => c.identifiant);

  it("distingue les comptes du seed des autres, sans tenir compte de la casse ni des espaces", () => {
    expect(comptesHorsSeed([...duSeed, " Test.Commercial ", "marie.kone", "admin"])).toEqual(["marie.kone", "admin"]);
    expect(comptesHorsSeed([])).toEqual([]);
  });

  it("accepte une base vide ou qui ne contient que des comptes du seed (second lancement)", async () => {
    await expect(controlerBaseSansComptesHorsSeed(client([]))).resolves.toBeUndefined();
    await expect(controlerBaseSansComptesHorsSeed(client(duSeed))).resolves.toBeUndefined();
  });

  it("refuse dès qu'un compte ne vient pas du seed, sans citer son identifiant", async () => {
    const refus = await controlerBaseSansComptesHorsSeed(client([...duSeed, "marie.kone.secrete"])).catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(SeedRefuse);
    expect((refus as Error).message).toMatch(/1 compte\(s\) qui ne viennent pas du seed/);
    expect((refus as Error).message).not.toContain("marie.kone.secrete");
  });

  it("executerSeedDev s'arrête sur le refus de la garde, avant toute écriture", async () => {
    await expect(
      executerSeedDev("Rx7-cobalt-lune-42", () => controlerBaseSansComptesHorsSeed(client(["vrai.compte"]))),
    ).rejects.toBeInstanceOf(SeedRefuse);
  });
});
