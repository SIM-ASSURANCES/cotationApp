// Configuration de la CLI Prisma (migrations, génération du client).
// Nom du fichier : Prisma 7.10 cherche d'abord « prisma7.config.ts », puis l'ancien
// « prisma.config.ts », afin de pouvoir cohabiter plus tard avec Prisma 8.
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Prisma ne lit pas .env tout seul. On charge les fichiers .env exactement comme
// Next.js (même ordre, même syntaxe) : l'application et la CLI lisent la même DATABASE_URL.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // process.env et non env() : `prisma generate` doit fonctionner sans base de
    // données (installation neuve, construction). Les commandes qui ont besoin de
    // la base, elles, refusent de s'exécuter si DATABASE_URL manque.
    url: process.env["DATABASE_URL"],
  },
});
