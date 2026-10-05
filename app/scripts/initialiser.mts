// Crée les 6 profils du CDC §4 et leurs droits par défaut. Idempotent : peut être relancé à chaque
// déploiement sans écraser les droits modifiés par l'administrateur.
// Lancement : npm run initialiser
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { initialiserProfilsEtDroits } = await import("../src/serveur/droits");
const { obtenirPrisma } = await import("../src/serveur/prisma");

const { profilsCrees, droitsCrees } = await initialiserProfilsEtDroits();
console.log(`Profils créés : ${profilsCrees} ; droits par défaut créés : ${droitsCrees}.`);
await obtenirPrisma().$disconnect();
