// Rangement des fichiers de DÉVELOPPEMENT (Étape 5, D41) :
// Réorganise les documents émis selon l'arborescence :
// <branche>/<produit>/<client>/<cotation>/<contrat>/<avenant>/<facture>/{avoir,recus,relances}/<nom>.pdf
//
// Lancement à la main uniquement (jamais en production) :
//   AUTORISER_RANGEMENT_DEV=oui npm run ranger:dev
//   docker compose run --rm -e NODE_ENV=development -e AUTORISER_RANGEMENT_DEV=oui outils npm run ranger:dev
// Refusé si NODE_ENV=production ou si AUTORISER_RANGEMENT_DEV n'est pas exactement « oui ».
// Les anciens fichiers ne sont jamais supprimés (stockage en ajout seul).
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { rangerDocumentsDev, ReorganisationInterditeEnProduction, GenerateurInjoignablePourRangement } = await import("../src/serveur/stockage-reorganisation");
const { obtenirPrisma } = await import("../src/serveur/prisma");

try {
  console.log("Rangement des fichiers de la base de développement selon l'arborescence du portefeuille (Étape 5)...");
  const prisma = obtenirPrisma();
  const rapport = await rangerDocumentsDev(prisma);

  console.log("\nRésumé du rangement :");
  console.log(`  - Total documents examinés : ${rapport.total}`);
  console.log(`  - Documents rangés vers la nouvelle arborescence : ${rapport.deplaces}`);
  console.log(`  - Documents déjà bien rangés : ${rapport.dejaRanges}`);
  if (rapport.introuvables > 0) {
    console.log(`  - Fichiers physiques introuvables : ${rapport.introuvables}`);
  }
  if (rapport.erreurs.length > 0) {
    console.log(`  - Erreurs rencontrées : ${rapport.erreurs.length}`);
    for (const e of rapport.erreurs) {
      console.log(`    * Doc #${e.id} (${e.numero}): ${e.erreur}`);
    }
  }
  await prisma.$disconnect();
} catch (erreur) {
  if (erreur instanceof ReorganisationInterditeEnProduction || erreur instanceof GenerateurInjoignablePourRangement) {
    console.error(erreur.message);
    process.exit(1);
  }
  throw erreur;
}

