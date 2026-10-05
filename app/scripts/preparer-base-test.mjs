// Prépare la base des tests d'intégration : la SUPPRIME si elle existe, puis la recrée et y
// applique les migrations. Refuse de toucher une base dont le nom ne se termine pas par « _test ».
// Lancement : npm run test:integration:preparer (appelé par npm run test:integration)
import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());

const texte = process.env.TEST_DATABASE_URL;
if (!texte) {
  console.error("TEST_DATABASE_URL manquante dans app/.env (modèle : app/.env.example).");
  process.exit(1);
}
const url = new URL(texte);
const base = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(base)) {
  console.error(`Refus : la base de test doit avoir un nom se terminant par _test (reçu : « ${base} »).`);
  process.exit(1);
}

const admin = new URL(texte);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5000 });
await client.connect();
await client.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`);
await client.end();
console.log(`Base de test « ${base} » supprimée si elle existait.`);

const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: texte },
  stdio: "inherit",
});
process.exit(migration.status ?? 1);
