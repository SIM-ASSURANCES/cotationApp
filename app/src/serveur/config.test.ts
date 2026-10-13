import { describe, expect, it } from "vitest";

import { ConfigurationInvalide, validerConfig } from "./config";

// Valeurs de test inventées.
const configComplete = {
  DATABASE_URL: "postgresql://utilisateur_test:mot_de_passe_test@localhost:5432/sim_documents_test",
  GENERATEUR_URL: "http://127.0.0.1:8001",
  GENERATEUR_SECRET: "secret-de-test-invente-0123456789-abcdefghij",
  AUTH_SECRET: "cle-de-session-de-test-inventee-0123456789-abcdef",
};

/** Message de l'erreur levée par fn (échoue si fn ne lève rien). */
function messageDErreur(fn: () => unknown): string {
  try {
    fn();
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ConfigurationInvalide);
    return (erreur as Error).message;
  }
  throw new Error("une ConfigurationInvalide était attendue");
}

describe("validerConfig", () => {
  it("accepte une configuration complète", () => {
    expect(validerConfig(configComplete)).toEqual({ ...configComplete, CONVERSIONS_SIMULTANEES: 2 });
  });

  it("file de tâches (phase 5) : REDIS_URL facultative mais en redis:// ; CONVERSIONS_SIMULTANEES de 1 à 16, 2 par défaut", () => {
    const avec = validerConfig({ ...configComplete, REDIS_URL: "redis://:mot-de-passe-invente@redis:6379", CONVERSIONS_SIMULTANEES: "3" });
    expect(avec.REDIS_URL).toBe("redis://:mot-de-passe-invente@redis:6379");
    expect(avec.CONVERSIONS_SIMULTANEES).toBe(3);
    expect(messageDErreur(() => validerConfig({ ...configComplete, REDIS_URL: "http://redis:6379" }))).toContain("REDIS_URL : doit être une adresse redis://");
    expect(messageDErreur(() => validerConfig({ ...configComplete, CONVERSIONS_SIMULTANEES: "0" }))).toContain("CONVERSIONS_SIMULTANEES : doit être un nombre entier de 1 à 16");
    expect(messageDErreur(() => validerConfig({ ...configComplete, CONVERSIONS_SIMULTANEES: "deux" }))).toContain("CONVERSIONS_SIMULTANEES : doit être un nombre entier de 1 à 16");
  });

  it("refuse une configuration où il manque DATABASE_URL, en nommant la variable", () => {
    const message = messageDErreur(() =>
      validerConfig({ ...configComplete, DATABASE_URL: undefined }),
    );
    expect(message).toContain("DATABASE_URL : obligatoire");
  });

  it("refuse un GENERATEUR_SECRET trop court, sans recopier sa valeur dans le message", () => {
    const secretCourt = "secret-trop-court-31-caracteres";
    expect(secretCourt).toHaveLength(31);

    const message = messageDErreur(() =>
      validerConfig({ ...configComplete, GENERATEUR_SECRET: secretCourt }),
    );
    expect(message).toContain("GENERATEUR_SECRET : doit contenir au moins 32 caractères");
    expect(message).not.toContain(secretCourt);
  });

  it("liste toutes les variables en faute en une seule fois", () => {
    const message = messageDErreur(() => validerConfig({}));
    expect(message).toContain("DATABASE_URL : obligatoire");
    expect(message).toContain("GENERATEUR_URL : obligatoire");
    expect(message).toContain("GENERATEUR_SECRET : obligatoire");
    expect(message).toContain("AUTH_SECRET : obligatoire");
  });
  it("PROXIES_DE_CONFIANCE (audit M1) : absent ou vide accepté, entier de 0 à 5 accepté, le reste refuse le démarrage", () => {
    expect(() => validerConfig(configComplete)).not.toThrow();
    expect(() => validerConfig({ ...configComplete, PROXIES_DE_CONFIANCE: "" })).not.toThrow();
    expect(() => validerConfig({ ...configComplete, PROXIES_DE_CONFIANCE: "2" })).not.toThrow();
    for (const mauvais of ["6", "-1", "un"]) {
      expect(messageDErreur(() => validerConfig({ ...configComplete, PROXIES_DE_CONFIANCE: mauvais }))).toContain("PROXIES_DE_CONFIANCE : doit être un entier de 0 à 5");
    }
  });
});
