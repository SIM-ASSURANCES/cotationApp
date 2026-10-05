import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const chemin = (relatif: string) => fileURLToPath(new URL(relatif, import.meta.url));

// Tests d'intégration : ils utilisent une VRAIE base PostgreSQL (TEST_DATABASE_URL, nom en _test).
export default defineConfig({
  resolve: {
    alias: {
      "@": chemin("./src"),
      "server-only": chemin("./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./vitest.integration.setup.ts"],
    fileParallelism: false, // une seule base partagée
    testTimeout: 30_000,
  },
});
