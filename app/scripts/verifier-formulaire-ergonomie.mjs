// Recette navigateur de l'ergonomie du formulaire de cotation au barème (D62), à 1440 px puis 390 px, avec captures.
// Comme verifier-cotation-bareme.mjs : pas un test unitaire, Playwright installé à part. Même préparation (base « …_test »,
// scripts/preparer-recette-bareme.mts, application lancée sur cette base) ; puis :
//   node scripts/verifier-formulaire-ergonomie.mjs <url-de-base> <identifiant-commercial> <mot-de-passe> [code-produit]
// Variables facultatives : PLAYWRIGHT_MODULE, NAVIGATEUR (canal « chrome », « msedge »), CAPTURES (dossier des captures, défaut ./captures-ergonomie).
//
// Vérifie : les champs d'une garantie s'affichent JUSTE sous sa case (position, aria-expanded / aria-controls, clavier), décocher les masque
// et ne les envoie pas ; le total apparaît sans clic, se met à jour quand on modifie un montant ; une seule requête serveur pour une frappe
// rapide (anti-rebond) ; saisie incomplète → « Complétez : … » sans requête ni erreur rouge ; aucun débordement horizontal du formulaire.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const exiger = createRequire(import.meta.url);
const { chromium } = exiger(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const [base, identifiant, motDePasse, produit = "RECETTE_SECURPRO"] = process.argv.slice(2);
if (!base || !identifiant || !motDePasse) {
  console.error("Usage : node scripts/verifier-formulaire-ergonomie.mjs <url-de-base> <identifiant-commercial> <mot-de-passe> [code-produit]");
  process.exit(2);
}
const CAPTURES = process.env.CAPTURES ?? "./captures-ergonomie";
mkdirSync(CAPTURES, { recursive: true });

const TAILLES = [
  { nom: "1440", width: 1440, height: 900 },
  { nom: "390", width: 390, height: 844 },
];

let echecs = 0;
function verifier(nom, condition, detail = "") {
  if (!condition) echecs++;
  console.log(`${condition ? "OK     " : "ÉCHEC  "} ${nom}${detail ? `  [${detail}]` : ""}`);
}

const navigateur = await chromium.launch({ headless: true, ...(process.env.NAVIGATEUR ? { channel: process.env.NAVIGATEUR } : {}) });

async function connecter(page) {
  await page.goto(`${base}/connexion`);
  await page.locator('input[name="identifiant"]').fill(identifiant);
  await page.locator('input[name="motDePasse"]').fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 20000 });
}

const jour = (decalage) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const champ = (page, nom) => page.locator(`[name="bareme_${nom}"]`);
const caseDe = (page, valeur) => page.locator(`input[name="souscrit"][value="${valeur}"]`);
const normaliser = (t) => t.replace(/[  ]/g, " ");
const tableau = (page) => page.locator("table", { hasText: "Prime nette" });
const messageComplétez = (page) => page.getByText(/^Complétez :/);

async function saisir(page, nom, valeur) {
  const cible = champ(page, nom);
  if ((await cible.evaluate((el) => el.tagName)) === "SELECT") await cible.selectOption(valeur);
  else await cible.fill(valeur);
}

async function attendre(condition, delai = 20000) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
const totalAffiche = async (page) => ((await tableau(page).count()) > 0 ? normaliser(await tableau(page).innerText()) : "");

/** Jeu d'essai n° 1 du SECURPRO inventé (TTC 139 420), SANS jamais cliquer sur « Calculer ». */
async function remplir(page) {
  await page.locator('input[name="souscripteur_nom"]').fill("Kouassi");
  await page.locator('input[name="souscripteur_prenoms"]').fill("Aya Inventée");
  await page.locator('input[name="souscripteur_telephone"]').fill("0700000000");
  await page.locator('select[name="typeContrat"]').selectOption("INDIVIDUEL");
  await page.locator('select[name="regimeTaxe"]').selectOption("INDIVIDUEL");
  await page.locator('input[name="dateEffet"]').fill(jour(0));
  await page.locator('input[name="dateEcheance"]').fill(jour(364));
  for (const s of ["vol.contenu", "vol.caisse", "dde", "de", "bdg", "tri"]) await caseDe(page, s).check();
  await champ(page, "type_commerce").selectOption("ELECTRONIQUE");
  await champ(page, "occupation").selectOption("LOCATAIRE");
  await champ(page, "situation").selectOption("BOUTIQUE");
  await champ(page, "gardien").selectOption("OUI");
  await champ(page, "extincteurs").selectOption("NON");
  await champ(page, "camera").selectOption("OUI");
  await champ(page, "volet").selectOption("NON");
  const montants = { loyer_mensuel: "150000", stocks: "6866500", materiel: "1000000", mobilier: "500000", amenagement: "500000", informatique: "0", vol_caisse_montant: "200000", dde_montant: "2000000", de_montant: "1000000", bdg_montant: "500000", tri_montant: "10000000" };
  for (const [nom, valeur] of Object.entries(montants)) await saisir(page, nom, valeur);
}

for (const taille of TAILLES) {
  console.log(`\n=== ${taille.nom} px ===`);
  const contexte = await navigateur.newContext({ viewport: { width: taille.width, height: taille.height } });
  const page = await contexte.newPage();
  const libelle = (t) => `${taille.nom} px : ${t}`;
  let requetesCalcul = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"] && new URL(r.url()).pathname === "/cotations/nouvelle") requetesCalcul++;
  });
  await connecter(page);
  await page.goto(`${base}/cotations/nouvelle?produit=${produit}`);
  await champ(page, "type_commerce").waitFor({ timeout: 20000 });

  // 1. Garanties : les champs propres sous leur case.
  const caisse = caseDe(page, "vol.caisse");
  verifier(libelle("case décochée : aucun champ de montant dans la page"), (await champ(page, "vol_caisse_montant").count()) === 0);
  verifier(libelle("case décochée : aria-expanded=false"), (await caisse.getAttribute("aria-expanded")) === "false");
  const idPanneau = await caisse.getAttribute("aria-controls");
  verifier(libelle("aria-controls désigne un panneau présent (caché)"), !!idPanneau && (await page.locator(`[id="${idPanneau}"]`).count()) === 1 && (await page.locator(`[id="${idPanneau}"]`).isHidden()));

  await caisse.focus();
  await page.keyboard.press("Space"); // clavier : la case se coche
  verifier(libelle("clavier (Espace) : la case se coche et le champ s'affiche"), (await caisse.isChecked()) && (await champ(page, "vol_caisse_montant").isVisible()));
  verifier(libelle("case cochée : aria-expanded=true"), (await caisse.getAttribute("aria-expanded")) === "true");
  const bCase = await caisse.boundingBox();
  const bChamp = await champ(page, "vol_caisse_montant").boundingBox();
  const bSuivante = await caseDe(page, "dde").boundingBox();
  verifier(libelle("le champ est juste sous la case (même bloc visuel)"), bChamp.y >= bCase.y + bCase.height - 2 && bChamp.y - (bCase.y + bCase.height) < 90, `case y=${Math.round(bCase.y)}+${Math.round(bCase.height)} champ y=${Math.round(bChamp.y)}`);
  verifier(libelle("le champ est en retrait de la case, avant la garantie suivante"), bChamp.x >= bCase.x && bChamp.y + bChamp.height <= bSuivante.y, `suivante y=${Math.round(bSuivante.y)}`);
  verifier(libelle("la case voisine (contenu) n'ouvre rien"), (await champ(page, "vol_contenu_montant").count()) === 0);
  await caisse.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/${taille.nom}-1-champ-sous-la-case.png` });

  // Décocher masque, et la saisie masquée n'est pas envoyée.
  await saisir(page, "vol_caisse_montant", await champ(page, "vol_caisse_montant").locator("option").nth(1).getAttribute("value"));
  await caisse.uncheck();
  verifier(libelle("case décochée : le champ disparaît"), (await champ(page, "vol_caisse_montant").count()) === 0);
  verifier(libelle("case décochée : le champ masqué n'est pas envoyé"), await page.evaluate(() => !new FormData(document.querySelector('input[name="baremeProduit"]').form).has("bareme_vol_caisse_montant")));
  verifier(libelle("case décochée : aria-expanded=false de nouveau"), (await caisse.getAttribute("aria-expanded")) === "false");
  await caisse.check();
  verifier(libelle("recocher : le champ revient avec sa valeur"), (await champ(page, "vol_caisse_montant").inputValue()) !== "");
  await caisse.uncheck();

  // 2. Saisie incomplète : message neutre, aucune requête, aucune erreur rouge.
  verifier(libelle("saisie incomplète : « Complétez : … » affiché"), await attendre(async () => (await messageComplétez(page).count()) > 0, 5000));
  await page.waitForTimeout(1500);
  verifier(libelle("saisie incomplète : aucune requête de calcul envoyée"), requetesCalcul === 0, String(requetesCalcul));
  verifier(libelle("saisie incomplète : aucune erreur rouge"), (await page.locator("form [role=alert]:not(:empty)").count()) === 0);
  await page.screenshot({ path: `${CAPTURES}/${taille.nom}-2-completez.png`, fullPage: true });

  // 3. Tout remplir SANS cliquer sur « Calculer » : le total apparaît seul.
  await remplir(page);
  verifier(libelle("saisie complète : le total 139 420 apparaît sans clic"), await attendre(async () => /Total[\s\S]*139 420/.test(await totalAffiche(page))));
  verifier(libelle("le message « Complétez » a disparu"), (await messageComplétez(page).count()) === 0);
  await tableau(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/${taille.nom}-3-total-sans-clic.png` });

  // 4. Modifier un montant (liste) : le total se met à jour sans clic.
  const avant = await totalAffiche(page);
  await saisir(page, "dde_montant", await champ(page, "dde_montant").locator("option").nth(1).getAttribute("value"));
  verifier(libelle("montant de liste modifié : le total change sans clic"), await attendre(async () => { const t = await totalAffiche(page); return t !== "" && t !== avant; }));

  // 5. Frappe rapide : une seule requête (anti-rebond), puis le total reflète la dernière valeur.
  await attendre(async () => (await page.locator("[role=status]", { hasText: "Calcul en cours" }).count()) === 0, 10000);
  await page.waitForTimeout(800);
  const totalAvantFrappe = await totalAffiche(page);
  requetesCalcul = 0;
  await champ(page, "stocks").fill("");
  await champ(page, "stocks").pressSequentially("6000000", { delay: 60 });
  await page.waitForTimeout(2500);
  verifier(libelle("frappe rapide de 7 caractères : une seule requête serveur"), requetesCalcul === 1, `${requetesCalcul} requêtes`);
  verifier(libelle("frappe rapide : le total est celui de la dernière valeur"), (await totalAffiche(page)) !== totalAvantFrappe && (await totalAffiche(page)) !== "");

  // 6. Vider un champ obligatoire visible : message neutre, plus de total périmé, aucune requête, pas d'erreur rouge.
  requetesCalcul = 0;
  await champ(page, "loyer_mensuel").fill("");
  verifier(libelle("champ obligatoire vidé : « Complétez : Loyer… »"), await attendre(async () => (await page.getByText(/^Complétez : .*[Ll]oyer/).count()) > 0, 5000));
  await page.waitForTimeout(1500);
  verifier(libelle("champ obligatoire vidé : aucune requête, aucun total périmé, aucune erreur rouge"), requetesCalcul === 0 && (await tableau(page).count()) === 0 && (await page.locator("form [role=alert]:not(:empty)").count()) === 0, `${requetesCalcul} requêtes`);
  await champ(page, "loyer_mensuel").fill("150000");
  verifier(libelle("champ remis : le total revient seul"), await attendre(async () => (await tableau(page).count()) > 0));

  // 7. Refus E4 : affiché comme avant, sans clic.
  await champ(page, "stocks").fill("6866500");
  await champ(page, "situation").selectOption("MARCHE");
  verifier(libelle("refus E4 : le message du barème s'affiche sans clic"), await attendre(async () => (await page.locator('[role="alert"]', { hasText: "ne peut pas être assuré dans ce barème" }).count()) > 0));
  await champ(page, "situation").selectOption("BOUTIQUE");
  verifier(libelle("refus levé : le total revient"), await attendre(async () => (await tableau(page).count()) > 0 && (await page.locator('[role="alert"]:not(:empty)').count()) === 0));

  // 8. Débordement horizontal.
  const mesure = await page.evaluate(() => {
    const racine = document.querySelector("[data-formulaire-bareme]");
    const champs = [...racine.querySelectorAll("input:not([type=checkbox]), select")].map((el) => el.getBoundingClientRect().right);
    return { racine: racine.scrollWidth - racine.clientWidth, plusADroite: Math.max(...champs), fenetre: document.documentElement.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  verifier(libelle("aucun débordement du formulaire ni des champs"), mesure.racine <= 0 && mesure.plusADroite <= mesure.fenetre, `racine +${mesure.racine}, champ le plus à droite ${Math.round(mesure.plusADroite)} / fenêtre ${mesure.fenetre}`);
  console.log(`INFO    ${taille.nom} px : défilement horizontal de la page = ${mesure.page} px (filigrane de la coquille, connu depuis B4)`);
  await page.screenshot({ path: `${CAPTURES}/${taille.nom}-4-formulaire-complet.png`, fullPage: true });
  await contexte.close();
}

await navigateur.close();
console.log(echecs === 0 ? "\nTOUT EST VERT" : `\n${echecs} ÉCHEC(S)`);
process.exit(echecs === 0 ? 0 : 1);
