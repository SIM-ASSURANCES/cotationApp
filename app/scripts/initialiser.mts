// Crée les 6 profils du CDC §4 et leurs droits par défaut, les motifs de refus, les branches fiscales
// (prisma/donnees/branches.json) et les taux de taxe de démarrage (prisma/donnees/taxes-loi.json). Idempotent : peut être relancé à chaque déploiement sans
// écraser les droits modifiés par l'administrateur ni un taux déjà paramétré.
// Lancement : npm run initialiser
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";

nextEnv.loadEnvConfig(process.cwd());

const { initialiserProfilsEtDroits } = await import("../src/serveur/droits");
const { initialiserMotifsRefus } = await import("../src/serveur/clients");
const { initialiserBranches, initialiserBranchesPrincipales, initialiserTaxes } = await import("../src/serveur/parametrage");
const { obtenirPrisma } = await import("../src/serveur/prisma");

const { profilsCrees, droitsCrees } = await initialiserProfilsEtDroits();
console.log(`Profils créés : ${profilsCrees} ; droits par défaut créés : ${droitsCrees}.`);
const motifs = await initialiserMotifsRefus();
console.log(`Motifs de refus créés : ${motifs}.`);
const branchesPrincipales = JSON.parse(readFileSync(new URL("../prisma/donnees/branches-principales.json", import.meta.url), "utf8"));
console.log(`Branches principales de démarrage créées : ${await initialiserBranchesPrincipales(branchesPrincipales.lignes)}.`);
const branches = JSON.parse(readFileSync(new URL("../prisma/donnees/branches.json", import.meta.url), "utf8"));
console.log(`Branches fiscales de démarrage créées : ${await initialiserBranches(branches.lignes)}.`);
const taxes = JSON.parse(readFileSync(new URL("../prisma/donnees/taxes-loi.json", import.meta.url), "utf8"));
console.log(`Taux de taxe de démarrage créés : ${await initialiserTaxes(taxes.lignes)}.`);
await obtenirPrisma().$disconnect();
