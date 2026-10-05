// Crée le premier Admin système (après npm run migrate:deploy). Le mot de passe est saisi ici,
// dans le terminal, sans s'afficher ; il ne passe par aucun fichier ni aucune variable.
// Lancement : npm run creer-admin
import nextEnv from "@next/env";
import { createInterface } from "node:readline/promises";

nextEnv.loadEnvConfig(process.cwd());

/** Lit une ligne sans l'afficher (mot de passe). */
function lireMasque(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("Terminal interactif requis (avec Docker : docker compose run --rm outils npm run creer-admin, avec -it)."));
      return;
    }
    process.stdout.write(question);
    let saisie = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const surDonnees = (morceau: string) => {
      for (const caractere of morceau) {
        if (caractere === "\r" || caractere === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", surDonnees);
          process.stdout.write("\n");
          resolve(saisie);
          return;
        }
        if (caractere === "\u0003") {
          process.stdin.setRawMode(false);
          process.exit(130); // Ctrl+C
        }
        if (caractere === "\u007f" || caractere === "\b") {
          saisie = saisie.slice(0, -1);
        } else {
          saisie += caractere;
        }
      }
    };
    process.stdin.on("data", surDonnees);
  });
}

const { initialiserProfilsEtDroits } = await import("../src/serveur/droits");
const { creerAdministrateurInitial } = await import("../src/serveur/utilisateurs");
const { ErreurMetier } = await import("../src/serveur/types");
const { obtenirPrisma } = await import("../src/serveur/prisma");

const lecteur = createInterface({ input: process.stdin, output: process.stdout });
const identifiant = (await lecteur.question("Identifiant du premier Admin système : ")).trim();
const nom = (await lecteur.question("Nom complet : ")).trim();
lecteur.close();

const motDePasse = await lireMasque("Mot de passe (12 caractères minimum) : ");
const confirmation = await lireMasque("Confirmer le mot de passe : ");

try {
  if (motDePasse !== confirmation) {
    throw new ErreurMetier("Les deux saisies du mot de passe sont différentes.");
  }
  await initialiserProfilsEtDroits();
  const id = await creerAdministrateurInitial({ identifiant, nom, motDePasse });
  console.log(`Admin système créé (identifiant : ${identifiant.toLowerCase()}, numéro ${id}). Vous pouvez vous connecter.`);
} catch (erreur) {
  if (erreur instanceof ErreurMetier) {
    console.error(`Échec : ${erreur.message}`);
    process.exitCode = 1;
  } else {
    throw erreur;
  }
} finally {
  await obtenirPrisma().$disconnect();
}
