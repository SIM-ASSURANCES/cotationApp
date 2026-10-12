// Captures d'écran des écrans de l'application, en 1440 px et 390 px de large (refonte visuelle : « avant » / « après »).
// Ce n'est PAS un test et ce n'est pas une dépendance du projet : Playwright et Chromium sont déjà installés dans le conteneur
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) ; hors conteneur, installer Playwright à part.
//
// Usage :
//   node scripts/capturer-ecrans.mjs <url-de-base> <dossier-de-sortie> <config.json> [--apres]
// config.json (HORS du dépôt, avec des données de test inventées uniquement) :
//   { "mdp": "…", "produit": "CODE_PRODUIT", "comptes": { "technique": "id1", "motDePasseAChanger": "id2", "commercial": "id3", "admin": "id4" },
//     "jetons": { "valide": "…", "annule": "…", "expire": "…", "inconnu": "…" } }
// "admin" (facultatif) : compte Admin système ; la capture « alerte-stockage » exige une écriture différée en base (T14).
// --apres ajoute les captures de ce qui n'existait pas avant : barre latérale repliée, tiroir mobile, menu du profil.
// Les animations sont coupées (prefers-reduced-motion) pour que les captures soient reproductibles.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const exiger = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = exiger("playwright"));
} catch {
  ({ chromium } = exiger("/opt/node22/lib/node_modules/playwright"));
}

const [base, sortie, fichierConfig, ...options] = process.argv.slice(2);
if (!base || !sortie || !fichierConfig) {
  console.error("Usage : node scripts/capturer-ecrans.mjs <url-de-base> <dossier-de-sortie> <config.json> [--apres]");
  process.exit(2);
}
const apres = options.includes("--apres");
const config = JSON.parse(readFileSync(fichierConfig, "utf8"));
mkdirSync(sortie, { recursive: true });

const TAILLES = [
  { nom: "1440", largeur: 1440, hauteur: 900 },
  { nom: "390", largeur: 390, hauteur: 844 },
];

const navigateur = await chromium.launch();
let n = 0;
const nom = (slug, taille) => join(sortie, `${String(++n).padStart(2, "0")}-${slug}-${taille.nom}.png`);

async function contexte(taille) {
  return navigateur.newContext({ viewport: { width: taille.largeur, height: taille.hauteur }, reducedMotion: "reduce", locale: "fr-FR" });
}

async function prete(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function photographier(page, slug, taille, options = {}) {
  await prete(page);
  const fichier = nom(slug, taille);
  await page.screenshot({ path: fichier, fullPage: options.pleinePage ?? true });
  console.log(fichier);
}

async function seConnecter(page, identifiant) {
  await page.goto(`${base}/connexion`);
  await page.getByLabel("Identifiant").fill(identifiant);
  await page.getByLabel("Mot de passe").fill(config.mdp);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/connexion"), { timeout: 30000 }), page.getByRole("button", { name: "Se connecter" }).click()]);
}

for (const taille of TAILLES) {
  // --- Pages publiques
  let ctx = await contexte(taille);
  let page = await ctx.newPage();
  await page.goto(`${base}/connexion`);
  await photographier(page, "connexion", taille);
  // Échec de connexion : message d'erreur (même Server Action qu'avant).
  await page.getByLabel("Identifiant").fill("inconnu");
  await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("alert").waitFor({ timeout: 15000 });
  await photographier(page, "connexion-erreur", taille);
  for (const [cle, jeton] of Object.entries(config.jetons)) {
    await page.goto(`${base}/verif/${jeton}`);
    await photographier(page, `verif-${cle}`, taille);
  }
  await ctx.close();

  // --- Compte qui doit changer son mot de passe (écran de changement obligatoire)
  ctx = await contexte(taille);
  page = await ctx.newPage();
  await seConnecter(page, config.comptes.motDePasseAChanger);
  await photographier(page, "mot-de-passe-obligatoire", taille);
  await ctx.close();

  // --- Accès refusé : un profil sans droit ouvre une page réservée
  ctx = await contexte(taille);
  page = await ctx.newPage();
  await seConnecter(page, config.comptes.commercial);
  await page.goto(`${base}/parametrage/produits`);
  await photographier(page, "acces-refuse", taille);
  await ctx.close();

  // --- Application authentifiée (profil Technique : la plupart des branches de navigation)
  ctx = await contexte(taille);
  page = await ctx.newPage();
  await seConnecter(page, config.comptes.technique);
  await page.goto(`${base}/`);
  await photographier(page, "accueil", taille);
  await page.goto(`${base}/cotations`);
  await photographier(page, "cotations-liste", taille);
  await page.goto(`${base}/cotations/nouvelle`);
  await photographier(page, "cotation-choix-produit", taille);
  await page.goto(`${base}/cotations/nouvelle?produit=${encodeURIComponent(config.produit)}`);
  await photographier(page, "cotation-formulaire", taille);
  await page.goto(`${base}/factures`);
  await photographier(page, "factures-liste", taille);

  if (apres) {
    await page.goto(`${base}/cotations`);
    if (taille.largeur >= 1024) {
      await page.getByRole("button", { name: "Réduire le menu" }).click();
      await page.waitForTimeout(400);
      await photographier(page, "barre-repliee", taille, { pleinePage: false });
      await page.getByRole("button", { name: "Déployer le menu" }).click();
      await page.waitForTimeout(400);
    } else {
      await page.getByRole("button", { name: "Ouvrir le menu" }).click();
      await page.waitForTimeout(500);
      await photographier(page, "tiroir-mobile", taille, { pleinePage: false });
      await page.getByRole("button", { name: "Fermer le menu" }).first().click();
    }
    await page.getByRole("button", { name: /Technique|Menu du profil|profil/i }).first().click().catch(() => {});
    await page.waitForTimeout(300);
    await photographier(page, "menu-profil", taille, { pleinePage: false });
  }
  await ctx.close();

  // --- Alerte de stockage (T14) : visible de l'administrateur seulement, tant qu'une écriture attend
  if (config.comptes.admin) {
    ctx = await contexte(taille);
    page = await ctx.newPage();
    await seConnecter(page, config.comptes.admin);
    await page.goto(`${base}/`);
    await photographier(page, "alerte-stockage-admin", taille, { pleinePage: false });
    await ctx.close();
  }
}

await navigateur.close();
console.log(`${n} captures dans ${sortie}`);
