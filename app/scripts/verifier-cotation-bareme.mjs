// Recette de l'écran de cotation au barème, dans un vrai navigateur (défaut de recette B6a : « Calculer » effaçait la saisie).
// Ce n'est PAS un test unitaire et ce n'est pas une dépendance du projet : Playwright est installé à part (comme pour verifier-mot-de-passe.mjs).
//
// Base à part : créer une base « …_test », y appliquer les migrations, puis
//   DATABASE_URL=… npx tsx --conditions=react-server scripts/preparer-recette-bareme.mts      (SECURPRO inventé publié + comptes inventés)
// lancer l'application sur cette base, puis :
//   node scripts/verifier-cotation-bareme.mjs <url-de-base> <identifiant-commercial> <mot-de-passe> [code-produit]
// Variables facultatives : PLAYWRIGHT_MODULE (chemin du module playwright), NAVIGATEUR (canal : « msedge », « chrome »).
//
// Pour 1440 px puis 390 px : remplir tout le formulaire (jeu d'essai 1 du SECURPRO inventé), cocher les garanties, Calculer → chaque
// champ garde sa valeur et le TTC est 139 420 ; changer un champ → résultat effacé, champs conservés ; refus E4 (calcul puis
// enregistrement) → champs conservés ; champ obligatoire manquant → refus, champs conservés ; enregistrement réussi → fiche de la cotation.
import { createRequire } from "node:module";

const exiger = createRequire(import.meta.url);
const { chromium } = exiger(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const [base, identifiant, motDePasse, produit = "RECETTE_SECURPRO"] = process.argv.slice(2);
if (!base || !identifiant || !motDePasse) {
  console.error("Usage : node scripts/verifier-cotation-bareme.mjs <url-de-base> <identifiant-commercial> <mot-de-passe> [code-produit]");
  process.exit(2);
}

const TAILLES = [
  { nom: "1440 px", width: 1440, height: 900 },
  { nom: "390 px", width: 390, height: 844 },
];
const MESSAGE_E4 = "ne peut pas être assuré dans ce barème";

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

/** Valeur de chaque champ du formulaire de cotation : nom (et rang) → valeur, ou coché / non coché. */
async function instantane(page) {
  return page.evaluate(() => {
    const formulaire = document.querySelector('input[name="baremeProduit"]')?.closest("form");
    const vu = {};
    const rang = {};
    for (const el of formulaire.querySelectorAll("input[name], select[name], textarea[name]")) {
      const n = (rang[el.name] = (rang[el.name] ?? -1) + 1);
      vu[`${el.name}#${n}`] = el.type === "checkbox" || el.type === "radio" ? (el.checked ? `coché:${el.value}` : `non coché:${el.value}`) : el.value;
    }
    return vu;
  });
}

function differences(avant, apres) {
  const liste = [];
  for (const cle of new Set([...Object.keys(avant), ...Object.keys(apres)])) if (avant[cle] !== apres[cle]) liste.push(`${cle} : « ${avant[cle]} » → « ${apres[cle]} »`);
  return liste;
}

const jour = (decalage) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const champ = (page, nom) => page.locator(`[name="bareme_${nom}"]`);

/** Champ libre : on tape ; liste de montants (le descripteur propose des valeurs) : on choisit. */
async function saisir(page, nom, valeur) {
  const cible = champ(page, nom);
  if ((await cible.evaluate((el) => el.tagName)) === "SELECT") await cible.selectOption(valeur);
  else await cible.fill(valeur);
}

/** Jeu d'essai n° 1 du SECURPRO inventé : TTC attendu 139 420 F. */
async function remplir(page) {
  await page.locator('input[name="souscripteur_nom"]').fill("Kouassi");
  await page.locator('input[name="souscripteur_prenoms"]').fill("Aya Inventée");
  await page.locator('input[name="souscripteur_telephone"]').fill("0700000000");
  await page.locator('select[name="typeContrat"]').selectOption("INDIVIDUEL");
  await page.locator('select[name="regimeTaxe"]').selectOption("INDIVIDUEL");
  await page.locator('input[name="dateEffet"]').fill(jour(0));
  await page.locator('input[name="dateEcheance"]').fill(jour(364));
  // Les cases d'abord : elles font apparaître les champs de montant des garanties.
  for (const s of ["vol.contenu", "vol.caisse", "dde", "de", "bdg", "tri"]) await page.locator(`input[name="souscrit"][value="${s}"]`).check();
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

const texteTable = (page) => page.locator("table", { hasText: "Prime nette" }).innerText();
const normaliser = (t) => t.replace(/[  ]/g, " ");

async function calculer(page) {
  await page.getByRole("button", { name: "Calculer", exact: true }).click();
  // Le résultat (tableau) ou le refus (bandeau non vide : l'annonceur de routes de Next est aussi un role="alert", mais vide).
  await page.locator('[aria-live="polite"] table, [role="alert"]:not(:empty)').first().waitFor({ timeout: 20000 });
}

async function cliquerEnregistrer(page) {
  await page.getByRole("button", { name: /Créer le brouillon|Enregistrer le brouillon/ }).click();
}

for (const taille of TAILLES) {
  console.log(`\n=== ${taille.nom} ===`);
  const contexte = await navigateur.newContext({ viewport: { width: taille.width, height: taille.height } });
  const page = await contexte.newPage();
  await connecter(page);
  await page.goto(`${base}/cotations/nouvelle?produit=${produit}`);
  await champ(page, "type_commerce").waitFor({ timeout: 20000 });
  const libelle = (t) => `${taille.nom} : ${t}`;

  // 1. Tout remplir puis Calculer : aucune valeur ne change, le TTC est 139 420.
  await remplir(page);
  const avantCalcul = await instantane(page);
  await calculer(page);
  const tableau = normaliser(await texteTable(page));
  verifier(libelle("Calculer : le TTC total est 139 420"), /Total[\s\S]*139 420/.test(tableau), tableau.replace(/\s+/g, " ").slice(-60));
  const apresCalcul = await instantane(page);
  verifier(libelle(`Calculer : les ${Object.keys(avantCalcul).length} champs gardent leur valeur`), differences(avantCalcul, apresCalcul).length === 0, differences(avantCalcul, apresCalcul).join(" ; "));
  verifier(libelle("Calculer : l'adresse de la page ne change pas"), new URL(page.url()).pathname === "/cotations/nouvelle", page.url());

  // 2. Changer un champ : le résultat est effacé, la saisie reste.
  await champ(page, "stocks").fill("6000000");
  await page.getByText("La saisie a changé : calculez de nouveau.").waitFor({ timeout: 10000 }).catch(() => {});
  verifier(libelle("changement d'un champ : résultat effacé et invitation à recalculer"), (await page.locator("table", { hasText: "Prime nette" }).count()) === 0 && (await page.getByText("La saisie a changé : calculez de nouveau.").count()) === 1);
  const apresChangement = await instantane(page);
  const attendu = { ...avantCalcul, "bareme_stocks#0": "6000000" };
  verifier(libelle("changement d'un champ : seul ce champ a changé"), differences(attendu, apresChangement).length === 0, differences(attendu, apresChangement).join(" ; "));
  await champ(page, "stocks").fill("6866500");
  await calculer(page);
  verifier(libelle("recalcul après retour à la valeur : TTC 139 420"), /139 420/.test(normaliser(await texteTable(page))));

  // 3. Refus E4 au calcul (en marché, capitaux au-dessus de la limite) : message de la Technique, champs conservés.
  await champ(page, "situation").selectOption("MARCHE");
  const avantE4 = await instantane(page);
  await calculer(page);
  verifier(libelle("refus E4 au calcul : message du barème affiché"), (await page.locator('[role="alert"]', { hasText: MESSAGE_E4 }).count()) >= 1);
  verifier(libelle("refus E4 au calcul : champs conservés"), differences(avantE4, await instantane(page)).length === 0, differences(avantE4, await instantane(page)).join(" ; "));

  // 4. Refus E4 à l'enregistrement : message, page inchangée, champs conservés.
  const avantEnregistrement = await instantane(page);
  await cliquerEnregistrer(page);
  await page.locator('form [role="alert"]', { hasText: MESSAGE_E4 }).first().waitFor({ timeout: 20000 }).catch(() => {});
  verifier(libelle("refus E4 à l'enregistrement : message affiché sous le bouton"), (await page.locator('form [role="alert"]', { hasText: MESSAGE_E4 }).count()) >= 1);
  verifier(libelle("refus E4 à l'enregistrement : on reste sur la page"), new URL(page.url()).pathname === "/cotations/nouvelle", page.url());
  const apresRefus = await instantane(page);
  verifier(libelle("refus E4 à l'enregistrement : champs conservés"), differences(avantEnregistrement, apresRefus).length === 0, differences(avantEnregistrement, apresRefus).join(" ; "));

  // 5. Champ obligatoire du barème manquant : refus, champs conservés.
  await champ(page, "situation").selectOption("BOUTIQUE");
  await champ(page, "type_commerce").selectOption("");
  const avantManquant = await instantane(page);
  await cliquerEnregistrer(page);
  await page.locator("form [role=alert]").first().waitFor({ timeout: 20000 }).catch(() => {});
  verifier(libelle("champ manquant : refus affiché"), (await page.locator("form [role=alert]").count()) >= 1);
  verifier(libelle("champ manquant : on reste sur la page"), new URL(page.url()).pathname === "/cotations/nouvelle", page.url());
  verifier(libelle("champ manquant : champs conservés"), differences(avantManquant, await instantane(page)).length === 0, differences(avantManquant, await instantane(page)).join(" ; "));

  // 6. Saisie complète : l'enregistrement réussi ouvre la fiche, au TTC 139 420.
  await champ(page, "type_commerce").selectOption("ELECTRONIQUE");
  await cliquerEnregistrer(page);
  await page.waitForURL((u) => /^\/cotations\/\d+/.test(u.pathname), { timeout: 30000 }).catch(() => {});
  verifier(libelle("enregistrement réussi : la fiche de la cotation s'ouvre"), /^\/cotations\/\d+/.test(new URL(page.url()).pathname), page.url());
  verifier(libelle("fiche : TTC 139 420"), /139 420/.test(normaliser(await page.locator("main").innerText())));
  const largeur = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  // Constat à part (hors du défaut de saisie) : il ne compte pas dans les échecs.
  console.log(`NOTE    ${taille.nom} : fiche de la cotation : ${largeur ? "défilement horizontal de la page" : "pas de défilement horizontal"}`);
  await contexte.close();
}

await navigateur.close();
console.log(echecs === 0 ? "\nOK : tous les contrôles passent." : `\n${echecs} contrôle(s) en échec.`);
process.exit(echecs === 0 ? 0 : 1);
