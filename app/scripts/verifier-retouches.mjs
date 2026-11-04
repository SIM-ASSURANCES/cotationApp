// Recette navigateur des retouches de mise en service (D63), à 1440 px puis 390 px, avec captures.
// Comme verifier-formulaire-ergonomie.mjs : pas un test unitaire, Playwright installé à part. Préparation (base « …_test », application lancée
// sur cette base) : preparer-recette-bareme.mts, preparer-recette-saisie.mts, puis preparer-recette-retouches.mts ; puis :
//   node scripts/verifier-retouches.mjs <url-de-base> <mot-de-passe-des-comptes-de-recette>
// Variables facultatives : PLAYWRIGHT_MODULE, NAVIGATEUR (canal « chrome », « msedge »), NAVIGATEUR_EXE (chemin d'un Chromium), CAPTURES
// (dossier des captures, défaut ./captures-retouches).
//
// Vérifie : (1) champs de montant : séparateur de milliers pendant la frappe, valeur envoyée sans séparateur, curseur stable, collage depuis
// Excel, jusqu'à l'enregistrement (produit, paiement) ; (2) durée couverte et prorata au barème ; (3) aucun défilement horizontal à 390 px
// (fiche produit, taxes, éditeur de barème, fiche d'un modèle, portefeuille) ; (5) section « Garanties » selon le mode, aides ; (6) branche
// puis produit ; (7) calcul automatique par formules = T1 au franc (15 888 000 F), une requête pour une frappe rapide, « Complétez » ;
// (8) modèles par produit, vue « À valider / À publier ».
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const exiger = createRequire(import.meta.url);
const { chromium } = exiger(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const [base, motDePasse] = process.argv.slice(2);
if (!base || !motDePasse) {
  console.error("Usage : node scripts/verifier-retouches.mjs <url-de-base> <mot-de-passe>");
  process.exit(2);
}
const CAPTURES = process.env.CAPTURES ?? "./captures-retouches";
mkdirSync(CAPTURES, { recursive: true });

const TAILLES = [
  // `decalage` : jours entre aujourd'hui et la date d'effet de la version créée (une date d'effet ne sert qu'une fois : tirage à chaque lancement).
  { nom: "1440", width: 1440, height: 900, decalage: 30 + Math.floor(Math.random() * 150) },
  { nom: "390", width: 390, height: 844, decalage: 200 + Math.floor(Math.random() * 150) },
];

let echecs = 0;
function verifier(nom, condition, detail = "") {
  if (!condition) echecs++;
  console.log(`${condition ? "OK     " : "ÉCHEC  "} ${nom}${detail ? `  [${detail}]` : ""}`);
}

const navigateur = await chromium.launch({
  headless: true,
  ...(process.env.NAVIGATEUR ? { channel: process.env.NAVIGATEUR } : {}),
  ...(process.env.NAVIGATEUR_EXE ? { executablePath: process.env.NAVIGATEUR_EXE } : {}),
});

async function connecter(contexte, identifiant) {
  const page = await contexte.newPage();
  await page.goto(`${base}/connexion`);
  await page.locator('input[name="identifiant"]').fill(identifiant);
  await page.locator('input[name="motDePasse"]').fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 20000 });
  return page;
}

const jour = (decalage) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const normaliser = (t) => t.replace(/[  ]/g, " ");
async function attendre(condition, delai = 20000) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
/** Valeur affichée (espaces insécables ramenés à des espaces) et valeur ENVOYÉE (FormData du formulaire du champ). */
const affiche = async (champ) => normaliser(await champ.inputValue());
const envoye = (champ) => champ.evaluate((el) => new FormData(el.form).get(el.name));
const sansHorizontal = (page) => page.evaluate(() => ({ L: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));

for (const taille of TAILLES) {
  console.log(`\n=== ${taille.nom} px ===`);
  const libelle = (t) => `${taille.nom} px : ${t}`;
  const contexte = (identifiant) => navigateur.newContext({ viewport: { width: taille.width, height: taille.height } }).then(async (c) => {
    await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base }).catch(() => {});
    return { c, page: await connecter(c, identifiant) };
  });

  // ------------------------------------------------------------------ 1. Montants : produit (Technique)
  {
    const { c, page } = await contexte("recette-technique");
    await page.goto(`${base}/parametrage/produits/RECETTE_BENI`);
    const prime = page.locator('input[name="primeMinimale"]');
    await prime.waitFor({ timeout: 20000 });
    await prime.scrollIntoViewIfNeeded();

    await prime.fill("");
    await prime.pressSequentially("1234567", { delay: 25 });
    verifier(libelle("frappe de 1234567 : « 1 234 567 » à l'écran"), (await affiche(prime)) === "1 234 567", await affiche(prime));
    verifier(libelle("la valeur ENVOYÉE n'a pas de séparateur"), (await envoye(prime)) === "1234567", String(await envoye(prime)));

    // Curseur stable : on tape un 9 après « 12 », au milieu du nombre.
    await prime.fill("");
    await prime.pressSequentially("123456", { delay: 25 });
    await prime.press("Home");
    await prime.press("ArrowRight");
    await prime.press("ArrowRight");
    await prime.pressSequentially("9", { delay: 25 });
    const curseur = await prime.evaluate((el) => el.selectionStart);
    verifier(libelle("saisie au milieu : « 1 293 456 »"), (await affiche(prime)) === "1 293 456", await affiche(prime));
    verifier(libelle("saisie au milieu : le curseur reste juste après le 9 (pas rejeté à la fin)"), curseur === 4, `selectionStart=${curseur}`);
    await prime.pressSequentially("7", { delay: 25 });
    verifier(libelle("on continue à taper au milieu : « 1 297 3456 » → regroupé « 12 973 456 »"), (await affiche(prime)) === "12 973 456", await affiche(prime));
    verifier(libelle("... et le curseur est toujours après le 7"), (await prime.evaluate((el) => el.selectionStart)) === 5, String(await prime.evaluate((el) => el.selectionStart)));

    // Suppression au milieu.
    await prime.press("Backspace");
    verifier(libelle("Retour arrière au milieu : le 7 disparaît, regroupement refait"), (await affiche(prime)) === "1 293 456", await affiche(prime));

    // Collage depuis Excel (presse-papiers) : avec séparateurs, sans, et décimales avec virgule.
    let collage = true;
    for (const [colle, attendu, brut] of [
      ["1 000 000", "1 000 000", "1000000"],
      [" 1 000 000 ", "1 000 000", "1000000"],
      ["1000000", "1 000 000", "1000000"],
      ["1 000 000,50", "1 000 000,50", "1000000.50"],
    ]) {
      try {
        await page.evaluate((t) => navigator.clipboard.writeText(t), colle);
        await prime.click();
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Control+V");
      } catch {
        collage = false;
        await prime.fill(colle);
      }
      verifier(libelle(`collage de « ${colle.trim()} » : affiché « ${attendu} »`), (await affiche(prime)) === attendu, await affiche(prime));
      verifier(libelle(`collage de « ${colle.trim()} » : envoyé « ${brut} »`), (await envoye(prime)) === brut, String(await envoye(prime)));
    }
    if (!collage) console.log("INFO    presse-papiers indisponible : le collage est simulé par fill() (même événement « input », texte entier)");

    // Jusqu'à l'enregistrement : une nouvelle version avec « 1 000 000 » de prime minimale.
    await prime.fill("");
    await prime.pressSequentially("1 000 000", { delay: 25 });
    verifier(libelle("tapé avec espaces : « 1 000 000 », envoyé « 1000000 »"), (await affiche(prime)) === "1 000 000" && (await envoye(prime)) === "1000000");
    await page.locator('input[name="dateEffet"]').fill(jour(taille.decalage));
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-1-montant-produit.png`, fullPage: false });
    await page.getByRole("button", { name: "Enregistrer la version" }).click();
    verifier(libelle("version enregistrée (message de succès)"), await attendre(async () => (await page.locator("form [role=status]:not(:empty)").count()) > 0, 20000));
    await page.reload();
    verifier(libelle("la version enregistrée porte une prime minimale de 1000000 (sans séparateur parasite)"), /prime minimale 1000000\b/.test(normaliser(await page.locator("main").innerText())));
    await c.close();
  }

  // ------------------------------------------------------------------ 1 bis. Montants : paiement (Gestionnaire)
  {
    const { c, page } = await contexte("recette-gestionnaire");
    await page.goto(`${base}/factures/1`);
    const formulaire = page.locator("form", { has: page.getByRole("button", { name: "Enregistrer le paiement" }) });
    const montant = formulaire.locator('input[name="montant"]');
    await montant.waitFor({ timeout: 20000 });
    await montant.scrollIntoViewIfNeeded();
    await montant.fill("");
    await montant.pressSequentially("12345", { delay: 25 });
    verifier(libelle("paiement : 12345 tapé → « 12 345 » affiché, « 12345 » envoyé"), (await affiche(montant)) === "12 345" && (await envoye(montant)) === "12345", `${await affiche(montant)} / ${await envoye(montant)}`);
    await formulaire.locator('select[name="canal"]').selectOption("ESPECES");
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-2-montant-paiement.png`, fullPage: false });
    await formulaire.getByRole("button", { name: "Enregistrer le paiement" }).click();
    // Un montant modeste : la facture de recette reste payable d'un lancement à l'autre.
    verifier(libelle("paiement enregistré avec « 12 345 » (le serveur a lu 12345) : le formulaire est remis à zéro, aucune erreur"), await attendre(async () => (await montant.inputValue().catch(() => "x")) === "", 20000) && (await formulaire.locator("[role=alert]:not(:empty)").count()) === 0 && /12[\s  ]?345/.test(await page.locator("main").innerText().catch(() => "")));
    await c.close();
  }

  // ------------------------------------------------------------------ 7. Cotation par formules : calcul automatique (T1)
  {
    const { c, page } = await contexte("recette-commercial");
    let requetes = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"] && new URL(r.url()).pathname === "/cotations/nouvelle") requetes++;
    });
    await page.goto(`${base}/cotations/nouvelle?produit=RECETTE_BENI`);
    await page.locator('input[name="eff_SOLO"]').waitFor({ timeout: 20000 });
    const resultat = page.locator("table", { hasText: "Prime nette" });
    const completez = page.getByText(/^Complétez :/);

    await page.locator('input[name="souscripteur_nom"]').fill("Kouadio");
    await page.locator('input[name="souscripteur_prenoms"]').fill("Marc Inventé");
    await page.locator('input[name="souscripteur_telephone"]').fill("0700000000");
    await page.locator('select[name="typeContrat"]').selectOption("GROUPE");
    // La date d'effet est préremplie (aujourd'hui) : il manque l'échéance et un effectif.
    verifier(libelle("saisie incomplète : « Complétez : Date d'échéance, Effectif… »"), (await attendre(async () => (await completez.count()) > 0, 5000)) && /Date d'échéance/.test(await completez.innerText()) && /Effectif/.test(await completez.innerText()), await completez.innerText().catch(() => ""));
    await page.waitForTimeout(1500);
    verifier(libelle("saisie incomplète : aucune requête de calcul"), requetes === 0, String(requetes));
    verifier(libelle("saisie incomplète : aucune erreur rouge"), (await page.locator("form [role=alert]:not(:empty)").count()) === 0);

    await page.locator('input[name="dateEffet"]').fill(jour(0));
    await page.locator('input[name="dateEcheance"]').fill(jour(364));
    await page.locator('input[name="nombreTranches"]').fill("4");
    await page.locator('input[name="eff_SOLO"]').fill("3");
    await page.waitForTimeout(1500);
    requetes = 0;
    await page.locator('input[name="eff_FAMILLE"]').pressSequentially("60", { delay: 60 });
    verifier(libelle("T1 : le total apparaît SANS cliquer sur « Calculer » : 15 888 000"), await attendre(async () => /Total[\s\S]*15 888 000/.test(normaliser(await resultat.innerText().catch(() => "")))));
    verifier(libelle("frappe rapide de 2 chiffres : une seule requête de calcul"), requetes === 1, `${requetes} requêtes`);
    const texte = normaliser(await resultat.innerText());
    verifier(libelle("T1 : lignes Solo 288 000 et Famille 15 600 000 au franc"), /Solo[\s\S]*288 000/.test(texte) && /Famille[\s\S]*15 600 000/.test(texte));
    verifier(libelle("durée couverte et prorata affichés : 365 jour(s), coefficient 1"), /365 jour\(s\) couverts, coefficient de prorata 1\b/.test(normaliser(await page.locator("main").innerText())));
    verifier(libelle("« Complétez » a disparu"), (await completez.count()) === 0);
    await resultat.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-3-formules-calcul-auto.png`, fullPage: false });

    // Modifier un effectif : le total se met à jour seul.
    const avant = texte;
    await page.locator('input[name="eff_SOLO"]').fill("4");
    verifier(libelle("effectif modifié : le total change sans clic (la ligne Solo n'est plus à 288 000)"), await attendre(async () => { const t = normaliser(await resultat.innerText().catch(() => "")); return t !== "" && t !== avant && !/Solo[^\n]*288 000/.test(t); }));
    await page.locator('input[name="eff_SOLO"]').fill("3");
    verifier(libelle("effectif remis : retour à 15 888 000"), await attendre(async () => /Total[\s\S]*15 888 000/.test(normaliser(await resultat.innerText().catch(() => "")))));

    // Entrée lance « Calculer » et jamais l'enregistrement.
    await page.locator('input[name="eff_SOLO"]').press("Enter");
    await page.waitForTimeout(1200);
    verifier(libelle("touche Entrée : on reste sur le formulaire (pas d'enregistrement)"), new URL(page.url()).pathname === "/cotations/nouvelle");

    // Bouton « Calculer » conservé.
    requetes = 0;
    await page.getByRole("button", { name: "Calculer" }).click();
    verifier(libelle("bouton « Calculer » conservé : il relance le calcul"), await attendre(async () => requetes >= 1, 5000));

    // Vider un effectif : « Complétez » revient, plus de total périmé.
    await page.locator('input[name="eff_SOLO"]').fill("");
    await page.locator('input[name="eff_FAMILLE"]').fill("");
    verifier(libelle("effectifs vidés : « Complétez : Effectif… » et plus de total périmé"), await attendre(async () => (await completez.count()) > 0 && (await resultat.count()) === 0, 5000));
    await page.locator('input[name="eff_SOLO"]').fill("3");
    await page.locator('input[name="eff_FAMILLE"]').fill("60");
    verifier(libelle("effectifs remis : le total revient seul"), await attendre(async () => /Total[\s\S]*15 888 000/.test(normaliser(await resultat.innerText().catch(() => "")))));

    // Jusqu'à l'enregistrement : le brouillon porte les mêmes montants.
    await page.getByRole("button", { name: "Créer le brouillon" }).click();
    verifier(libelle("enregistrement : le brouillon affiche 15 888 000 (mêmes montants que le calcul automatique)"), (await attendre(async () => /\/cotations\/\d+$/.test(new URL(page.url()).pathname), 30000)) && /15[\s  ]888[\s  ]000/.test(await page.locator("main").innerText()), page.url());
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-4-formules-brouillon.png`, fullPage: false });

    // ---------------------------------------------------------------- 6. Branche puis produit
    await page.goto(`${base}/cotations/nouvelle`);
    const branche = page.getByLabel("Branche principale");
    const produit = page.locator('select[name="produit"]');
    await branche.waitFor({ timeout: 20000 });
    verifier(libelle("produit : liste inactive tant que la branche n'est pas choisie"), await produit.isDisabled());
    verifier(libelle("« Continuer » inactif sans produit"), await page.getByRole("button", { name: "Continuer" }).isDisabled());
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-5-nouvelle-cotation-branche.png`, fullPage: false });
    await branche.selectOption({ label: (await branche.locator("option").allInnerTexts()).find((t) => /^Maladie/.test(t)) });
    const optionsMaladie = (await produit.locator("option").allInnerTexts()).filter((t) => t.includes("—"));
    verifier(libelle("branche Maladie : seuls ses produits sont proposés"), optionsMaladie.length >= 2 && optionsMaladie.every((t) => /RECETTE_(BENI|SANTE)/.test(t)), optionsMaladie.join(" | "));
    await produit.selectOption("RECETTE_BENI");
    verifier(libelle("produit choisi : « Continuer » actif"), await page.getByRole("button", { name: "Continuer" }).isEnabled());
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-6-nouvelle-cotation-produit.png`, fullPage: false });
    await branche.selectOption({ label: (await branche.locator("option").allInnerTexts()).find((t) => /^Incendie/.test(t)) });
    verifier(libelle("changer de branche vide le produit choisi"), (await produit.inputValue()) === "");
    const optionsIncendie = (await produit.locator("option").allInnerTexts()).filter((t) => t.includes("—"));
    verifier(libelle("branche Incendie : uniquement RECETTE_SECURPRO"), optionsIncendie.length === 1 && /RECETTE_SECURPRO/.test(optionsIncendie[0]), optionsIncendie.join(" | "));
    await produit.selectOption("RECETTE_SECURPRO");
    await page.getByRole("button", { name: "Continuer" }).click();
    verifier(libelle("« Continuer » ouvre la cotation du produit choisi"), await attendre(async () => new URL(page.url()).searchParams.get("produit") === "RECETTE_SECURPRO", 15000), page.url());

    // ---------------------------------------------------------------- 2. Barème : durée couverte et prorata
    await page.locator('select[name="typeContrat"]').waitFor({ timeout: 20000 });
    await page.locator('input[name="souscripteur_nom"]').fill("Kouassi");
    await page.locator('input[name="souscripteur_prenoms"]').fill("Aya Inventée");
    await page.locator('input[name="souscripteur_telephone"]').fill("0700000000");
    await page.locator('select[name="typeContrat"]').selectOption("INDIVIDUEL");
    await page.locator('select[name="regimeTaxe"]').selectOption("INDIVIDUEL");
    await page.locator('input[name="dateEffet"]').fill(jour(0));
    await page.locator('input[name="dateEcheance"]').fill(jour(302)); // 303 jours inclus
    const champ = (nom) => page.locator(`[name="bareme_${nom}"]`);
    for (const s of ["vol.contenu", "vol.caisse", "dde", "de", "bdg", "tri"]) await page.locator(`input[name="souscrit"][value="${s}"]`).check();
    await champ("type_commerce").selectOption("ELECTRONIQUE");
    await champ("occupation").selectOption("LOCATAIRE");
    await champ("situation").selectOption("BOUTIQUE");
    await champ("gardien").selectOption("OUI");
    await champ("extincteurs").selectOption("NON");
    await champ("camera").selectOption("OUI");
    await champ("volet").selectOption("NON");
    const montants = { loyer_mensuel: "150 000", stocks: "6 866 500", materiel: "1 000 000", mobilier: "500 000", amenagement: "500 000", informatique: "0", vol_caisse_montant: "200000", dde_montant: "2000000", de_montant: "1000000", bdg_montant: "500000", tri_montant: "10000000" };
    for (const [nom, valeur] of Object.entries(montants)) {
      const cible = champ(nom);
      if ((await cible.evaluate((el) => el.tagName)) === "SELECT") await cible.selectOption(valeur.replace(/ /g, ""));
      else await cible.fill(valeur);
    }
    verifier(libelle("barème : un champ de montant saisi « 6 866 500 » est envoyé « 6866500 »"), (await envoye(champ("stocks"))) === "6866500", String(await envoye(champ("stocks"))));
    const tableau = page.locator("table", { hasText: "Prime nette" });
    verifier(libelle("barème : le résultat apparaît seul"), await attendre(async () => (await tableau.count()) > 0));
    verifier(libelle("barème : la durée couverte et le prorata sont affichés (303 jour(s))"), await attendre(async () => /303 jour\(s\) couverts, coefficient de prorata/.test(normaliser(await page.locator("main").innerText()))));
    await tableau.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-7-bareme-prorata.png`, fullPage: false });
    await c.close();
  }

  // ------------------------------------------------------------------ 5. Formulaire produit : section Garanties selon le mode, aides
  {
    const { c, page } = await contexte("recette-technique");
    await page.goto(`${base}/parametrage/produits/RECETTE_BENI`);
    const mode = page.locator('select[name="modeTarification"]');
    await mode.waitFor({ timeout: 20000 });
    const section = page.locator('[data-section-mode="GARANTIES"]');
    verifier(libelle("version « Par formule » : la section Garanties n'est pas affichée"), (await mode.inputValue()) === "FORMULE" && (await section.isHidden()));
    await mode.selectOption("GARANTIES");
    verifier(libelle("mode « Par garanties » : la section Garanties s'affiche"), await section.isVisible());
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-8-produit-garanties.png`, fullPage: false });
    await mode.selectOption("FORMULE");
    verifier(libelle("retour à « Par formule » : la section se cache de nouveau"), await section.isHidden());
    const principal = normaliser(await page.locator("main").innerText());
    verifier(libelle("aide « Formules comparées au plus »"), principal.includes("Nombre maximal de formules que l'on peut comparer dans une même cotation"));
    verifier(libelle("aide de l'arrondi : précision 1 = au franc"), principal.includes("1 = au franc"));
    verifier(libelle("valeurs d'arrondi inchangées (1, 10, 100, 1 000)"), JSON.stringify(await page.locator('select[name="precision"] option').allInnerTexts()) === JSON.stringify(["1", "10", "100", "1000"]), JSON.stringify(await page.locator('select[name="precision"] option').allInnerTexts()));
    await page.locator('select[name="precision"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/${taille.nom}-9-produit-aides.png`, fullPage: false });
    await page.goto(`${base}/parametrage/produits`);
    verifier(libelle("aide « Gamme » : famille commerciale, balise produit.gamme"), normaliser(await page.locator("main").innerText()).includes("Famille commerciale du produit (ex. RELAX), utilisée par les modèles de documents : balise produit.gamme."));
    await c.close();
  }

  // ------------------------------------------------------------------ 8. Modèles : par produit ; « À valider / À publier »
  {
    const technique = await contexte("recette-technique");
    await technique.page.goto(`${base}/modeles`);
    await technique.page.getByRole("link", { name: /Tous les modèles/ }).waitFor({ timeout: 20000 });
    const texteTech = normaliser(await technique.page.locator("main").innerText());
    verifier(libelle("modèles : une carte par produit (RECETTE_BENI) avec ses modèles déposés et ceux qui manquent"), /RECETTE_BENI — /.test(texteTech) && /modèles? manquants?/.test(texteTech) && /Manquant/.test(texteTech));
    verifier(libelle("modèles : un produit sans aucun modèle apparaît (trois manquants)"), /RECETTE_DECES —/.test(texteTech) && /3 modèles manquants/.test(texteTech));
    verifier(libelle("Technique : pas d'onglet « À valider / À publier » (droit de publication)"), (await technique.page.getByRole("link", { name: /À valider \/ À publier/ }).count()) === 0);
    await technique.page.screenshot({ path: `${CAPTURES}/${taille.nom}-10-modeles-par-produit.png`, fullPage: true });
    await technique.page.goto(`${base}/modeles?vue=a-publier`);
    verifier(libelle("Technique : /modeles?vue=a-publier n'affiche pas la vue (retour à la liste)"), (await technique.page.getByText("Aucune version n'attend votre publication.").count()) === 0 && (await technique.page.getByText("Versions à publier").count()) === 0);
    // Pour la fiche d'un modèle (contrôle de largeur plus bas).
    await technique.page.goto(`${base}/modeles`);
    const hrefModele = await technique.page.locator('a[href^="/modeles/"]').evaluateAll((liens) => liens.map((l) => l.getAttribute("href")).find((h) => /^\/modeles\/\d+$/.test(h ?? "")));
    await technique.c.close();

    const dg = await contexte("recette-dg");
    await dg.page.goto(`${base}/modeles`);
    const onglet = dg.page.getByRole("link", { name: /À valider \/ À publier \(\d+\)/ });
    await onglet.waitFor({ timeout: 20000 });
    verifier(libelle("DG : l'onglet « À valider / À publier (n) » porte un compteur"), /\(1\)/.test(await onglet.innerText()), await onglet.innerText());
    await onglet.click();
    await dg.page.getByText("Versions à publier").first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
    const texteDg = normaliser(await dg.page.locator("main").innerText());
    verifier(libelle("DG : la vue liste la version soumise (RECETTE_CP_BENI, v1)"), /RECETTE_CP_BENI/.test(texteDg) && /Examiner et publier/.test(texteDg));
    await dg.page.screenshot({ path: `${CAPTURES}/${taille.nom}-11-modeles-a-publier.png`, fullPage: false });
    await dg.c.close();

    // ---------------------------------------------------------------- 3. Largeur à 390 px : aucune page ne défile horizontalement
    if (taille.width <= 480) {
      const { c, page } = await contexte("recette-technique");
      const versionBareme = await (async () => {
        await page.goto(`${base}/parametrage/produits/RECETTE_SECURPRO`);
        return page.locator('a[href^="/parametrage/produits/RECETTE_SECURPRO/bareme/"]').first().getAttribute("href");
      })();
      const pages = [
        "/parametrage/produits/RECETTE_SECURPRO",
        "/parametrage/taxes",
        versionBareme ?? "/parametrage/produits/RECETTE_SECURPRO/bareme/1",
        hrefModele ?? "/modeles",
        "/portefeuille/ACCIDENTS_CORPORELS",
        "/parametrage/produits/RECETTE_BENI",
        "/parametrage/produits",
        "/modeles",
        "/cotations/nouvelle",
      ];
      for (const chemin of pages) {
        await page.goto(`${base}${chemin}`, { waitUntil: "networkidle" });
        const m = await sansHorizontal(page);
        verifier(libelle(`aucun défilement horizontal : ${chemin}`), m.sw <= m.L, `largeur de la page ${m.sw} / fenêtre ${m.L}`);
        if (chemin === "/parametrage/produits/RECETTE_SECURPRO") await page.screenshot({ path: `${CAPTURES}/${taille.nom}-12-largeur-fiche-produit.png`, fullPage: false });
        if (chemin.includes("/bareme/")) await page.screenshot({ path: `${CAPTURES}/${taille.nom}-13-largeur-editeur-bareme.png`, fullPage: false });
        if (chemin === "/parametrage/taxes") await page.screenshot({ path: `${CAPTURES}/${taille.nom}-14-largeur-taxes.png`, fullPage: false });
      }
      await c.close();
    }
  }
}

await navigateur.close();
console.log(echecs === 0 ? "\nTOUT EST VERT" : `\n${echecs} ÉCHEC(S)`);
process.exit(echecs === 0 ? 0 : 1);
