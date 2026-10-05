import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Couches de src/ (décision D4) : app/ → serveur/ → domaine/, jamais l'inverse ;
// composants/ n'importe jamais serveur/ (les pages de app/ lui passent les données).
const SENS = "Sens des couches : app/ → serveur/ → domaine/ (voir docs/decisions.md, D4).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/domaine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: `domaine/ : règles métier pures, sans Next.js. ${SENS}` },
            { name: "react", message: `domaine/ : règles métier pures, sans React. ${SENS}` },
            { name: "react-dom", message: `domaine/ : règles métier pures, sans React. ${SENS}` },
            { name: "server-only", message: `domaine/ : code pur, utilisable partout. ${SENS}` },
            { name: "prisma", message: `domaine/ n'accède pas à la base : c'est le rôle de serveur/. ${SENS}` },
            { name: "pg", message: `domaine/ n'accède pas à la base : c'est le rôle de serveur/. ${SENS}` },
            { name: "fs", message: "domaine/ n'accède pas au système de fichiers." },
            { name: "node:fs", message: "domaine/ n'accède pas au système de fichiers." },
            { name: "fs/promises", message: "domaine/ n'accède pas au système de fichiers." },
            { name: "node:fs/promises", message: "domaine/ n'accède pas au système de fichiers." },
          ],
          patterns: [
            {
              group: ["next/*", "react/*", "react-dom/*"],
              message: `domaine/ : règles métier pures, sans Next.js ni React. ${SENS}`,
            },
            {
              group: ["@prisma/*", "prisma/*", "pg/*", "@/generated", "@/generated/*"],
              message: `domaine/ n'accède pas à la base : c'est le rôle de serveur/. ${SENS}`,
            },
            {
              group: [
                "@/serveur",
                "@/serveur/*",
                "@/app",
                "@/app/*",
                "@/composants",
                "@/composants/*",
                "**/serveur/**",
                "**/app/**",
                "**/composants/**",
              ],
              message: `domaine/ ne dépend d'aucune autre couche. ${SENS}`,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/serveur/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app", "@/app/*", "@/composants", "@/composants/*", "**/app/**", "**/composants/**"],
              message: `serveur/ ne dépend jamais de app/ ni de composants/. ${SENS}`,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/composants/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/serveur", "@/serveur/*", "**/serveur/**", "@prisma/*", "@/generated", "@/generated/*"],
              message: `composants/ n'importe jamais serveur/ ni Prisma : les données arrivent par les props. ${SENS}`,
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Client Prisma généré (recréé par `prisma generate`) : pas de lint.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
