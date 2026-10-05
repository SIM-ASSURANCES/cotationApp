import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Les tests d'intégration ne doivent JAMAIS tourner sur la base de développement :
// on remplace DATABASE_URL par la base de test, après avoir vérifié son nom.
const urlTest = process.env.TEST_DATABASE_URL;
if (!urlTest || !/_test$/.test(new URL(urlTest).pathname)) {
  throw new Error("TEST_DATABASE_URL absente ou dont le nom ne se termine pas par _test : tests d'intégration refusés.");
}
process.env.DATABASE_URL = urlTest;
