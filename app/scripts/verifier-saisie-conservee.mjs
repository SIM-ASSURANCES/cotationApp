// Recette de la saisie conservée (FormulaireAction), dans un vrai navigateur, à 1440 px. Ce n'est PAS un test unitaire et Playwright
// n'est pas une dépendance du projet (installé à part, comme pour verifier-cotation-bareme.mjs).
//
// Base à part (nom en _test) : migrations, puis
//   DATABASE_URL=… npx tsx --conditions=react-server scripts/preparer-recette-bareme.mts
//   DATABASE_URL=… npx tsx --conditions=react-server scripts/preparer-recette-saisie.mts
// lancer l'application sur cette base, puis :
//   node scripts/verifier-saisie-conservee.mjs <url-de-base> <mot-de-passe>
// Variables facultatives : PLAYWRIGHT_MODULE (chemin du module playwright), NAVIGATEUR (canal : « msedge », « chrome »).
//
// Trois formulaires représentatifs :
//  - Société (MODIFICATION) : un refus garde la saisie ; un succès garde les valeurs enregistrées.
//  - Ajouter une version de produit (CRÉATION) : un refus garde la saisie (champs, liste, case, date) ; un succès remet le formulaire à zéro.
//  - Facture (paiement REFUSÉ) : la saisie est conservée.
import { createRequire } from "node:module";

const exiger = createRequire(import.meta.url);
const { chromium } = exiger(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const [base, motDePasse] = process.argv.slice(2);
if (!base || !motDePasse) {
  console.error("Usage : node scripts/verifier-saisie-conservee.mjs <url-de-base> <mot-de-passe>");
  process.exit(2);
}

let echecs = 0;
function verifier(nom, condition, detail = "") {
  if (!condition) echecs++;
  console.log(`${condition ? "OK     " : "ÉCHEC  "} ${nom}${detail ? `  [${detail}]` : ""}`);
}

const jour = (decalage) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Décalage aléatoire : la Société et les versions n'acceptent qu'une valeur par date d'effet, le script peut donc être relancé sur la même base.
const DECALAGE = 5 + Math.floor(Math.random() * 300);

const navigateur = await chromium.launch({ headless: true, ...(process.env.NAVIGATEUR ? { channel: process.env.NAVIGATEUR } : {}) });

async function ouvrir(identifiant) {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await contexte.newPage();
  await page.goto(`${base}/connexion`);
  await page.locator('input[name="identifiant"]').fill(identifiant);
  await page.locator('input[name="motDePasse"]').fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 20000 });
  return page;
}

/** Valeur de chaque champ du formulaire qui contient le bouton donné : nom#rang → valeur (cases : coché / non coché). */
async function instantane(page, bouton) {
  return page.getByRole("button", { name: bouton, exact: true }).evaluate((b) => {
    const vu = {};
    const rang = {};
    for (const el of b.closest("form").querySelectorAll("input[name], select[name], textarea[name]")) {
      if (el.type === "hidden") continue;
      const n = (rang[el.name] = (rang[el.name] ?? -1) + 1);
      vu[`${el.name}#${n}`] = el.type === "checkbox" || el.type === "radio" ? (el.checked ? "coché" : "non coché") : el.value;
    }
    return vu;
  });
}

function differences(attendu, obtenu) {
  const liste = [];
  for (const cle of new Set([...Object.keys(attendu), ...Object.keys(obtenu)])) if (attendu[cle] !== obtenu[cle]) liste.push(`${cle} : « ${attendu[cle]} » → « ${obtenu[cle]} »`);
  return liste;
}

/** Envoie le formulaire et attend l'issue : bandeau d'erreur (role=alert non vide) ou de réussite (role=status non vide). */
async function envoyer(page, bouton, issue) {
  await page.getByRole("button", { name: bouton, exact: true }).click();
  const sel = issue === "refus" ? '[role="alert"]:not(:empty)' : '[role="status"]:not(:empty)';
  await page.locator(sel).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600); // laisse React finir la remise à zéro éventuelle et l'actualisation de la page
}

const texteAlerte = async (page) => (await page.locator('[role="alert"]:not(:empty)').first().innerText()).replace(/\s+/g, " ");

// ------------------------------------------------------------------------------------------------------------------ Société
{
  console.log("\n=== Société (modification), 1440 px ===");
  const page = await ouvrir("recette-technique");
  await page.goto(`${base}/parametrage/societe`);
  const BOUTON = "Enregistrer";
  const f = page.locator("form").filter({ has: page.getByRole("button", { name: BOUTON, exact: true }) });
  const saisie = {
    raison_sociale: "Société de recette inventée",
    forme: "SA",
    capital: "1000000000",
    adresse: "Plateau, rue inventée",
    rccm: "CI-ABJ-INV-0001",
    lieu_emission: "Abidjan-recette",
    signataire_nom: "Signataire Inventé",
    dateEffet: jour(DECALAGE),
  };
  for (const [nom, valeur] of Object.entries(saisie)) await f.locator(`input[name="${nom}"]`).fill(valeur);
  await f.locator('textarea[name="rib"]').fill("Banque inventée ; CI000-0000-RECETTE");
  const avant = await instantane(page, BOUTON);

  // 1. Succès : un formulaire de modification garde les valeurs enregistrées.
  await envoyer(page, BOUTON, "succes");
  let apres = await instantane(page, BOUTON);
  let ecarts = differences(avant, apres);
  verifier("succès : toutes les valeurs enregistrées sont gardées", ecarts.length === 0, ecarts.slice(0, 3).join(" | "));

  // 2. Refus (même date d'effet que la valeur déjà enregistrée) : la saisie, modifiée, reste intacte.
  await f.locator('input[name="raison_sociale"]').fill("Autre raison sociale inventée");
  await f.locator('input[name="signataire_nom"]').fill("Autre signataire");
  await f.locator('textarea[name="rib"]').fill("Banque inventée ; AUTRE-COMPTE-RECETTE");
  const avantRefus = await instantane(page, BOUTON);
  await envoyer(page, BOUTON, "refus");
  apres = await instantane(page, BOUTON);
  ecarts = differences(avantRefus, apres);
  verifier("refus : message affiché", (await texteAlerte(page)).length > 0, await texteAlerte(page));
  verifier("refus : toute la saisie est conservée (champs, zones de texte, date)", ecarts.length === 0, ecarts.slice(0, 3).join(" | "));
  await page.context().close();
}

// ------------------------------------------------------------------------------------------------- Version de produit
{
  console.log("\n=== Ajouter une version de produit (création), 1440 px ===");
  const page = await ouvrir("recette-technique");
  await page.goto(`${base}/parametrage/produits/RECETTE_SANTE`);
  const BOUTON = "Enregistrer la version";
  const f = page.locator("form").filter({ has: page.getByRole("button", { name: BOUTON, exact: true }) });
  const parDefaut = await instantane(page, BOUTON);

  // Saisie complète : champs, listes, case décochée, date. Date d'effet déjà prise par la première version du produit (2020-01-01) → refus métier.
  await f.locator('input[name="dateEffet"]').fill("2020-01-01");
  // Chaque champ prend une valeur DIFFÉRENTE de celle de départ (le formulaire est pré-rempli avec la dernière version).
  await f.locator('input[name="primeMinimale"]').fill(`${5000 + DECALAGE}`);
  for (const nom of ["precision", "sens"]) {
    const liste = f.locator(`select[name="${nom}"]`);
    const valeurs = await liste.locator("option").evaluateAll((o) => o.map((x) => x.value));
    const courante = await liste.inputValue();
    await liste.selectOption(valeurs.find((v) => v !== courante));
  }
  const prorata = f.locator('input[name="prorataActif"]');
  await prorata.setChecked(!(await prorata.isChecked()));
  for (const nom of ["tranchesMax", "validiteMois"]) {
    const champ = f.locator(`input[name="${nom}"]`);
    await champ.fill(String((Number(await champ.inputValue()) % 9) + 2));
  }
  const avantRefus = await instantane(page, BOUTON);
  verifier("préparation : la saisie diffère bien des valeurs par défaut", differences(parDefaut, avantRefus).length >= 6, `${differences(parDefaut, avantRefus).length} champs modifiés`);
  await envoyer(page, BOUTON, "refus");
  let apres = await instantane(page, BOUTON);
  let ecarts = differences(avantRefus, apres);
  verifier("refus : message affiché", (await texteAlerte(page)).length > 0, await texteAlerte(page));
  verifier("refus : champs, listes, case et date conservés", ecarts.length === 0, ecarts.slice(0, 4).join(" | "));

  // Succès : date future valide → le formulaire de création se vide (prêt pour la saisie suivante).
  await f.locator('input[name="dateEffet"]').fill(jour(DECALAGE + 400));
  await envoyer(page, BOUTON, "succes");
  // « Remis à zéro » = chaque champ est revenu à sa valeur par défaut HTML (la page, actualisée, peut avoir changé ces valeurs par défaut).
  const nonRemis = await page.getByRole("button", { name: BOUTON, exact: true }).evaluate((b) =>
    [...b.closest("form").querySelectorAll("input[name], select[name]")]
      .filter((el) => el.type !== "hidden" && (el.type === "checkbox" ? el.checked !== el.defaultChecked : el.tagName === "SELECT" ? el.selectedIndex !== [...el.options].findIndex((o) => o.defaultSelected) : el.value !== el.defaultValue))
      .map((el) => el.name),
  );
  verifier("succès : formulaire de création remis à zéro (aucun champ ne diffère de sa valeur par défaut)", nonRemis.length === 0, nonRemis.join(", "));
  await page.context().close();
}

// ------------------------------------------------------------------------------------------------ Facture, paiement refusé
{
  console.log("\n=== Facture : paiement refusé, 1440 px ===");
  const page = await ouvrir("recette-gestionnaire");
  await page.goto(`${base}/factures/1`);
  const BOUTON = "Enregistrer le paiement";
  const f = page.locator("form").filter({ has: page.getByRole("button", { name: BOUTON, exact: true }) });
  await f.locator('input[name="montant"]').fill("abc");
  await f.locator('select[name="canal"]').selectOption({ index: 2 });
  await f.locator('input[name="reference"]').fill("REF-INVENTEE-42");
  await f.locator('input[name="payeur"]').fill("Payeur inventé");
  await f.locator('input[name="date"]').fill(jour(-1));
  const avant = await instantane(page, BOUTON);
  await envoyer(page, BOUTON, "refus");
  const apres = await instantane(page, BOUTON);
  const ecarts = differences(avant, apres);
  verifier("refus : message affiché", (await texteAlerte(page)).length > 0, await texteAlerte(page));
  verifier("refus : date, montant, canal, référence et payeur conservés", ecarts.length === 0, ecarts.slice(0, 4).join(" | "));
  await page.context().close();
}

await navigateur.close();
console.log(echecs === 0 ? "\nTous les contrôles passent." : `\n${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
