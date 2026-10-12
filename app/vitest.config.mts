import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const chemin = (relatif: string) => fileURLToPath(new URL(relatif, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Même alias que tsconfig.json : « @/... » désigne src/.
      "@": chemin("./src"),
      // Hors de Next.js, le paquet « server-only » lève une erreur dès l'import. Les
      // tests tournent côté serveur (Node) : on utilise sa version vide, celle que
      // reçoit le code serveur de React.
      "server-only": chemin("./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Lancés par npm run test:integration (base de test) et npm run test:e2e (base et générateur).
    exclude: ["src/**/*.integration.test.ts", "src/**/*.e2e.test.ts", "node_modules/**"],
  },
});
