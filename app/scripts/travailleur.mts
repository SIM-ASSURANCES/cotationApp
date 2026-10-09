// Travailleur de la file de tâches (phase 5, D24 : BullMQ + Redis) : import en masse des adhérents et reprise des
// écritures différées du stockage (T14). Service `travailleur` du Docker Compose (même image que les outils).
// Lancement : npm run travailleur   (exige REDIS_URL, en plus de la configuration de l'application)
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { obtenirConfig } = await import("../src/serveur/config");
const config = obtenirConfig();
if (!config.REDIS_URL) {
  console.error("REDIS_URL manquante : le travailleur ne peut pas joindre la file de tâches (modèle : app/.env.example).");
  process.exit(1);
}
const { demarrerTravailleur } = await import("../src/serveur/travailleur");
const { fermerFiles } = await import("../src/serveur/taches");
const { obtenirPrisma } = await import("../src/serveur/prisma");

const travailleur = await demarrerTravailleur();
console.log(`[travailleur] prêt (${config.CONVERSIONS_SIMULTANEES} conversion(s) simultanée(s)).`);

// Arrêt propre (docker compose stop) : les tâches en cours se terminent ou seront reprises au prochain démarrage.
let arret = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (arret) return;
    arret = true;
    console.log(`[travailleur] ${signal} reçu : arrêt.`);
    await travailleur.fermer();
    await fermerFiles();
    await obtenirPrisma().$disconnect();
    process.exit(0);
  });
}
