// Seed de DÉVELOPPEMENT : un compte de test par profil (test.commercial…), sans changement de mot de passe
// imposé. Lancement à la main uniquement (jamais par Compose, outils, initialiser ni postinstall) :
//   npm run seed:dev                         (poste de développement, AUTORISER_SEED_DEV=oui et SEED_MOT_DE_PASSE dans app/.env)
//   docker compose run --rm -e NODE_ENV=development -e AUTORISER_SEED_DEV=oui outils npm run seed:dev
// Jamais sur le VPS. Voir docs/installation.md, « Seed de développement ».
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { controlerEnvironnementSeed, executerSeedDev, SeedRefuse } = await import("../src/serveur/seed-dev");
const { obtenirPrisma } = await import("../src/serveur/prisma");

let motDePasse: string;
try {
  motDePasse = controlerEnvironnementSeed(process.env);
} catch (erreur) {
  if (erreur instanceof SeedRefuse) {
    console.error(erreur.message);
    process.exit(1);
  }
  throw erreur;
}

let resultat: Awaited<ReturnType<typeof executerSeedDev>>;
try {
  resultat = await executerSeedDev(motDePasse);
} catch (erreur) {
  if (erreur instanceof SeedRefuse) {
    console.error(erreur.message);
    await obtenirPrisma().$disconnect();
    process.exit(1);
  }
  throw erreur;
}
const { crees, ignores } = resultat;
for (const identifiant of crees) console.log(`créé    : ${identifiant}`);
for (const identifiant of ignores) console.log(`ignoré  : ${identifiant} (existe déjà, inchangé)`);
console.log(`\n${crees.length} compte(s) créé(s), ${ignores.length} ignoré(s). Mot de passe : celui de SEED_MOT_DE_PASSE (non affiché).`);
await obtenirPrisma().$disconnect();
