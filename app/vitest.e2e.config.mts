import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const chemin = (relatif: string) => fileURLToPath(new URL(relatif, import.meta.url));

// Tests de bout en bout : vraie base de test (TEST_DATABASE_URL, nom en _test) ET vrai générateur (GENERATEUR_URL).
export default defineConfig({
  resolve: {
    alias: {
      "@": chemin("./src"),
      "server-only": chemin("./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.e2e.test.ts"],
    setupFiles: ["./vitest.integration.setup.ts"],
    fileParallelism: false, // une seule base partagée
    testTimeout: 120_000,
  },
});
