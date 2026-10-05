import { describe, expect, it } from "vitest";

import { ConfigurationInvalide, validerConfig } from "./config";

// Valeurs de test inventées.
const configComplete = {
  DATABASE_URL: "postgresql://utilisateur_test:mot_de_passe_test@localhost:5432/sim_documents_test",
  GENERATEUR_URL: "http://127.0.0.1:8001",
  GENERATEUR_SECRET: "secret-de-test-invente-0123456789-abcdefghij",
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
    expect(validerConfig(configComplete)).toEqual(configComplete);
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
  });
});
