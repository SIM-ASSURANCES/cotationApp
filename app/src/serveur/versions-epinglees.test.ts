import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const paquet = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const toutes = { ...paquet.devDependencies, ...paquet.dependencies };

// Décision du 05/10/2026 : ces bibliothèques ne se mettent JAMAIS à jour automatiquement.
// Auth.js v5 est encore une pré-version (la même que le portail RH, en production). Pour changer
// de version, on modifie package.json ET ce test, en le sachant (voir docs/decisions.md, D6).
const EPINGLEES: Record<string, string> = {
  "next-auth": "5.0.0-beta.32",
  next: "16.3.8",
  prisma: "7.10.0",
  "@prisma/client": "7.10.0",
  "@prisma/adapter-pg": "7.10.0",
  "decimal.js": "10.6.0",
};

describe("versions épinglées dans package.json", () => {
  it.each(Object.entries(EPINGLEES))("%s reste à la version exacte %s", (nom, version) => {
    expect(toutes[nom]).toBe(version);
  });

  it("aucune dépendance de calcul ou de sécurité n'accepte une plage de versions", () => {
    for (const nom of Object.keys(EPINGLEES)) {
      expect(toutes[nom], nom).not.toMatch(/^[\^~><*]/);
    }
  });
});
