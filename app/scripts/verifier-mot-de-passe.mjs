// Recette du changement de mot de passe, dans un vrai navigateur (défaut de recette du 13/10/2026). Ce n'est PAS un test unitaire et
// ce n'est pas une dépendance du projet : Playwright est installé à part (comme pour capturer-ecrans.mjs).
//
// Usage (application lancée, base de recette avec UN compte Admin système) :
//   node scripts/verifier-mot-de-passe.mjs <url-de-base> <identifiant-admin> <mot-de-passe-admin>
// Variables facultatives : PLAYWRIGHT_MODULE (chemin du module playwright), NAVIGATEUR (canal : « msedge », « chrome »).
//
// Pour 1440 px puis 390 px de large, avec des comptes créés à chaque fois (noms inventés) :
//   A. changement OBLIGATOIRE : création du compte par l'Admin → première connexion → changement → page de connexion avec le
//      message, session fermée (aucune page de l'application accessible) → reconnexion avec le nouveau mot de passe → accueil
//      en pleine largeur (coquille de l'application : menu et barre du haut), sans défilement horizontal ;
//   B. changement VOLONTAIRE depuis « Mon compte » : même comportement.
import { createRequire } from "node:module";

const exiger = createRequire(import.meta.url);
const { chromium } = exiger(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const [base, idAdmin, mdpAdmin] = process.argv.slice(2);
if (!base || !idAdmin || !mdpAdmin) {
  console.error("Usage : node scripts/verifier-mot-de-passe.mjs <url-de-base> <identifiant-admin> <mot-de-passe-admin>");
  process.exit(2);
}

const MESSAGE = "Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.";
const TAILLES = [
  { nom: "1440 px", width: 1440, height: 900 },
  { nom: "390 px", width: 390, height: 844 },
];

let echecs = 0;
function verifier(nom, condition, detail = "") {
  if (!condition) echecs++;
  console.log(`${condition ? "OK     " : "ÉCHEC  "} ${nom}${detail ? `  [${detail}]` : ""}`);
}

const navigateur = await chromium.launch({ headless: true, ...(process.env.NAVIGATEUR ? { channel: process.env.NAVIGATEUR } : {}) });

async function connecter(page, identifiant, motDePasse) {
  await page.goto(`${base}/connexion`);
  await page.locator('input[name="identifiant"]').fill(identifiant);
  await page.locator('input[name="motDePasse"]').fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 15000 }).catch(() => {});
}

/** Coquille de l'application (menu + barre du haut) ou coquille de connexion (carte étroite) ? */
async function coquille(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('nav[aria-label="Navigation principale"]');
    const barre = document.querySelector("header");
    const contenu = document.querySelector("main");
    return {
      application: Boolean(menu && barre),
      largeurContenu: contenu ? Math.round(contenu.getBoundingClientRect().width) : 0,
      defilementHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

async function creerCompte(contexteAdmin, identifiant, motDePasseProvisoire) {
  const page = await contexteAdmin.newPage();
  await page.goto(`${base}/admin/utilisateurs`);
  const formulaire = page.locator("form", { has: page.getByRole("button", { name: "Créer", exact: true }) });
  await formulaire.locator('input[name="identifiant"]').fill(identifiant);
  await formulaire.locator('input[name="nom"]').fill(`Compte ${identifiant} Inventé`);
  await formulaire.locator('select[name="profil"]').selectOption("TECHNIQUE");
  await formulaire.locator('input[name="motDePasse"]').fill(motDePasseProvisoire);
  await formulaire.getByRole("button", { name: "Créer", exact: true }).click();
  await page.getByText("Utilisateur créé").waitFor({ timeout: 15000 });
  await page.close();
}

async function changerMotDePasse(page, actuel, nouveau) {
  await page.locator('input[name="actuel"]').fill(actuel);
  await page.locator('input[name="nouveau"]').fill(nouveau);
  await page.locator('input[name="confirmation"]').fill(nouveau);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/connexion"), { timeout: 15000 }).catch(() => {});
}

/** Après le changement : page de connexion + message, session fermée, rien d'accessible sans se reconnecter. */
async function verifierSessionFermee(page, contexte, libelle) {
  verifier(`${libelle} : retour sur la page de connexion`, new URL(page.url()).pathname === "/connexion", page.url());
  const message = page.getByText(MESSAGE);
  verifier(`${libelle} : message « ${MESSAGE} » affiché`, (await message.count()) === 1);
  verifier(`${libelle} : message annoncé comme statut (bandeau de succès)`, (await page.locator('[role="status"]', { hasText: MESSAGE }).count()) === 1);
  for (const chemin of ["/", "/cotations", "/mon-compte", "/admin/utilisateurs"]) {
    await page.goto(`${base}${chemin}`);
    verifier(`${libelle} : ${chemin} sans se reconnecter renvoie vers /connexion`, new URL(page.url()).pathname === "/connexion", page.url());
  }
  const cookies = (await contexte.cookies()).filter((c) => /session-token/.test(c.name));
  verifier(`${libelle} : aucun cookie de session`, cookies.length === 0, cookies.map((c) => c.name).join(","));
  await page.goto(`${base}/connexion`);
  verifier(`${libelle} : le message ne reste pas affiché sur une connexion ordinaire`, (await page.getByText(MESSAGE).count()) === 0);
}

async function accueilEnPleineLargeur(page, taille, libelle) {
  verifier(`${libelle} : arrivée sur l'accueil`, new URL(page.url()).pathname === "/", page.url());
  const c = await coquille(page);
  verifier(`${libelle} : coquille de l'application (menu et barre du haut)`, c.application);
  verifier(`${libelle} : pas de défilement horizontal`, !c.defilementHorizontal);
  if (taille.width >= 1024) verifier(`${libelle} : contenu en pleine largeur`, c.largeurContenu > 700, `${c.largeurContenu} px`);
  else verifier(`${libelle} : contenu qui occupe la largeur de l'écran`, c.largeurContenu > taille.width - 80, `${c.largeurContenu} px sur ${taille.width}`);
}

for (const taille of TAILLES) {
  console.log(`\n=== ${taille.nom} ===`);
  const alea = Math.random().toString(36).slice(2, 8);
  const contexteAdmin = await navigateur.newContext({ viewport: { width: taille.width, height: taille.height } });
  const pageAdmin = await contexteAdmin.newPage();
  await connecter(pageAdmin, idAdmin, mdpAdmin);

  // A. changement obligatoire
  {
    const libelle = `A (${taille.nom})`;
    const identifiant = `recette.a.${alea}`;
    const provisoire = "mot-de-passe-provisoire-inventé-2026";
    const nouveau = `nouvelle-phrase-de-passe-inventée-${alea}`;
    await creerCompte(contexteAdmin, identifiant, provisoire);
    const contexte = await navigateur.newContext({ viewport: { width: taille.width, height: taille.height } });
    const page = await contexte.newPage();
    await connecter(page, identifiant, provisoire);
    await page.waitForURL((u) => u.pathname === "/mon-compte", { timeout: 15000 }).catch(() => {});
    verifier(`${libelle} : la première connexion mène au changement obligatoire`, new URL(page.url()).pathname === "/mon-compte", page.url());
    await changerMotDePasse(page, provisoire, nouveau);
    const apres = await coquille(page);
    console.log(`         (après le changement : ${page.url()} ; coquille de l'application : ${apres.application} ; contenu ${apres.largeurContenu} px)`);
    await verifierSessionFermee(page, contexte, libelle);
    await connecter(page, identifiant, "ancien-mot-de-passe-faux");
    verifier(`${libelle} : l'ancien mot de passe ne connecte plus`, new URL(page.url()).pathname === "/connexion", page.url());
    await connecter(page, identifiant, nouveau);
    await accueilEnPleineLargeur(page, taille, libelle);
    await contexte.close();
  }

  // B. changement volontaire depuis « Mon compte »
  {
    const libelle = `B (${taille.nom})`;
    const identifiant = `recette.b.${alea}`;
    const provisoire = "mot-de-passe-provisoire-inventé-2026";
    const premier = `premiere-phrase-de-passe-inventée-${alea}`;
    const second = `seconde-phrase-de-passe-inventée-${alea}`;
    await creerCompte(contexteAdmin, identifiant, provisoire);
    const contexte = await navigateur.newContext({ viewport: { width: taille.width, height: taille.height } });
    const page = await contexte.newPage();
    await connecter(page, identifiant, provisoire);
    await page.waitForURL((u) => u.pathname === "/mon-compte", { timeout: 15000 }).catch(() => {});
    await changerMotDePasse(page, provisoire, premier); // changement obligatoire d'abord
    await connecter(page, identifiant, premier);
    await page.goto(`${base}/mon-compte`);
    verifier(`${libelle} : « Mon compte » dans la coquille de l'application`, (await coquille(page)).application);
    await changerMotDePasse(page, premier, second);
    await verifierSessionFermee(page, contexte, libelle);
    await connecter(page, identifiant, premier);
    verifier(`${libelle} : l'ancien mot de passe ne connecte plus`, new URL(page.url()).pathname === "/connexion", page.url());
    await connecter(page, identifiant, second);
    await accueilEnPleineLargeur(page, taille, libelle);
    await contexte.close();
  }
  await contexteAdmin.close();
}

await navigateur.close();
console.log(echecs === 0 ? "\nOK : tous les contrôles passent." : `\n${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
