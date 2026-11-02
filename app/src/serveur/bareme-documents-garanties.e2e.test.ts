// Session bareme-documents-garanties (D61), bout en bout (npm run test:e2e) : vraie base de test, VRAI générateur, VRAI stockage.
// Cotation SECURPRO inventé au barème (sept garanties souscrites) → police → CP émise : la CP générale insère, pour chaque garantie, le sous-modèle publié de
// cette garantie (bloc « garanties », clé = code), dans l'ordre ; le PDF est lisible et porte les composantes du Vol. Modèles Word inventés :
// generateur/tests/fixtures/ (cp_garanties_par_garantie_test.docx, garantie_sous_modele_test.docx).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lireBareme, type Bareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { assurerBranche, rattacherCgDeTest } from "./branches-test";
import { basculerVersionAuBareme, lireBaremePublie, publierBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { importerBaremeXlsx } from "./bareme-excel";
import { obtenirConfig } from "./config";
import { accepter, creerBrouillon, soumettre } from "./cotations";
import { debutTest } from "./dates-test";
import { emettreCotation, emettreCp, reediter } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature, assurerSocieteDeTest, PNG_REEL_1PX } from "./societe-test";
import { remplacerStockage, stockage } from "./stockage";
import { ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const fixture = (nom: string) => new Uint8Array(readFileSync(join(FIXTURES, nom)));
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
const VISA_CG = "VISA-INVENTE-GARANTIES";
const GARANTIES = ["incendie", "vol", "dde", "de", "bdg", "tempete", "tri"];
const NOMS = ["Incendie", "Vol", "Dégâts des eaux", "Dommages électriques", "Bris de glaces", "Tempête", "Tous risques informatique"];

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let INCENDIE: string;
let IARD: string;
let produit: string;
let versionId: number;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

function texteDuPdf(pdf: Uint8Array): string | null {
  const r = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(pdf), maxBuffer: 20_000_000 });
  return r.status === 0 ? r.stdout.toString("utf8").replace(/[  ]/g, " ").replace(/\s+/g, " ") : null;
}
const AVEC_PDFTOTEXT = spawnSync("pdftotext", ["-v"]).error === undefined;

async function publierFichier(type: "CG" | "CP" | "COTATION" | "SOUS_MODELE", produitCode: string | null, nom: string, surcharge: Record<string, unknown> = {}, bloc: { blocNom: string; blocCle: string } | null = null) {
  const id = await creerModele(
    technique,
    { type, code: CODE(type), libelle: type === "CG" ? "SECURPRO – Conditions générales (test)" : `${type} (bout en bout)`, produitCode, ...sans, ...(bloc ?? {}) },
    null,
  );
  await deposerVersion(technique, id, { fichier: fixture(nom), nomFichier: nom, commentaire: "Test de bout en bout, garanties", dateEffet: aujourdhui(), visa: null, dateDocument: null, ...surcharge }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

function baremeAuxBranches(): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return lireBareme(d);
}

async function contournerLesDeclencheurs(sql: string): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe(sql);
  });
}

let compteur = 0;
const numeroPolice = () => `GE-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(++compteur).padStart(5, "0")}`;

beforeAll(async () => {
  remplacerGenerateur(null);
  remplacerStockage(null);
  const sante = await fetch(new URL("/sante", obtenirConfig().GENERATEUR_URL)).catch(() => null);
  if (!sante?.ok) throw new Error(`Générateur injoignable sur ${obtenirConfig().GENERATEUR_URL} : lancez-le avant npm run test:e2e.`);
  await initialiserProfilsEtDroits();
  const admin = unique("admin");
  await creerAdministrateurInitial({ identifiant: admin, nom: "Admin", motDePasse: MDP });
  const a = await compte(admin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(a, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, dg, commercial] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL")];
  await assurerSocieteDeTest(technique);
  await assurerSignature(technique, PNG_REEL_1PX);

  INCENDIE = await assurerBranche(`INC_${CODE("B")}`.slice(0, 20));
  IARD = await assurerBranche(`IARD_${CODE("B")}`.slice(0, 20));
  for (const [branche, taux] of [[INCENDIE, "12.5"], [IARD, "7.25"]] as const) {
    await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: taux, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  }
  const cg = await publierFichier("CG", null, "cg_test.docx", { visa: VISA_CG, dateDocument: "2025-06-19" });
  await rattacherCgDeTest("INCENDIE_DOMMAGES", cg);

  produit = CODE("SECURPRO");
  await creerProduit(technique, { code: produit, libelle: "SECURPRO au barème (CP par garantie, test)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(
    technique,
    produit,
    {
      dateEffet: debutTest(),
      modeTarification: "GARANTIES",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
      prorata: { actif: false, primeMinimale: null },
      fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: null,
      formules: [],
      garantiesSaisieLibre: true,
      garanties: [],
      references: { csModeleCode: null, csVisa: null },
    } satisfies VersionSaisie,
    null,
  );
  versionId = (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code: produit } } })).id;
  await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await construireClasseur(baremeAuxBranches(), { titre: "SECURPRO inventé (e2e documents par garantie)" }), null);
  await publierBareme(technique, versionId, "Barème SECURPRO inventé (e2e documents par garantie)", null);
  await basculerVersionAuBareme(technique, versionId, null);
  await contournerLesDeclencheurs(`UPDATE produit_versions SET date_effet = DATE '2020-01-01' WHERE id = ${versionId}`);

  await publierFichier("COTATION", produit, "cotation_garanties_test.docx");
  await publierFichier("CP", produit, "cp_garanties_par_garantie_test.docx");
}, 180_000);

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

async function nouvelleCotation() {
  const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0].entrees;
  const champs = { ...essai.champs, tempete_montant: "2000000" } as Record<string, string | boolean | string[]>;
  const effet = aujourdhui();
  const id = await creerBrouillon(
    commercial,
    {
      codeProduit: produit,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ATELIERS DU LAGON SARL (inventée)", telephone: "", email: "", adresse: "Yopougon, rue inventée" },
      dateEffet: effet,
      dateEcheance: ajouterJours(effet, 364),
      nombreTranches: 1,
      lignes: [],
      motifForcage: null,
      assures: [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
      baremeBrut: {
        champs: Object.fromEntries(Object.entries(champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
        souscrit: [...essai.souscrit, "tempete"],
      },
    },
    null,
  );
  await soumettre(commercial, id, null);
  await emettreCotation(technique, id, null);
  await accepter(commercial, id, [], numeroPolice(), null);
  return id;
}

describe("CP par garantie : cotation au barème → CP émise avec un bloc par garantie, vrai PDF", () => {
  it("sans sous-modèle publié, l'émission est refusée en nommant les garanties et la clé attendue ; rien n'est émis", async () => {
    const id = await nouvelleCotation();
    const erreur = (await emettreCp(technique, id, null).catch((x) => x)) as ErreurMetier;
    expect(erreur).toBeInstanceOf(ErreurMetier);
    for (const [i, code] of GARANTIES.entries()) expect(erreur.message).toContain(`« ${NOMS[i]} » (sous-modèle « garanties », clé « ${code} »)`);
    const police = await obtenirPrisma().police.findFirstOrThrow({ where: { cotationId: id } });
    expect(await obtenirPrisma().documentEmis.count({ where: { policeId: police.id, type: "CP" } })).toBe(0);
  }, 120_000);

  it("avec les sept sous-modèles inventés, la CP est émise : un bloc par garantie dans l'ordre, composantes du Vol comprises ; réédition identique", async () => {
    for (const code of GARANTIES) await publierFichier("SOUS_MODELE", produit, "garantie_sous_modele_test.docx", {}, { blocNom: "garanties", blocCle: code });
    const id = await nouvelleCotation();
    const cp = await emettreCp(technique, id, null);
    const ligne = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: cp.id } });
    const pdf = await stockage().lire(ligne.chemin);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    // Les sept sous-modèles sont conservés avec le document (T10).
    const versions = (ligne.versionsAssociees as { sousModeles: { garanties: Record<string, number> } }).sousModeles.garanties;
    expect(Object.keys(versions).sort()).toEqual([...GARANTIES].sort());

    if (!AVEC_PDFTOTEXT) return;
    const texte = texteDuPdf(pdf)!;
    expect(texte).toContain("CONDITIONS PARTICULIÈRES");
    // Un bloc par garantie, dans l'ordre des garanties, chacun avec SA ligne et les données du document.
    const positions = NOMS.map((nom, i) => texte.indexOf(`GARANTIE ${nom} (code ${GARANTIES[i]})`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(texte.match(/ATELIERS DU LAGON SARL \(inventée\)/g)!.length).toBeGreaterThanOrEqual(8); // en-tête + sept blocs
    // Le Vol détaille ses deux composantes sous sa ligne (contenu, caisse), et la caisse porte 200 000 F d'assiette.
    const bloc = texte.slice(positions[1], positions[2]);
    expect(bloc).toContain("Montant garanti : 1 529 975 F CFA");
    expect(bloc.indexOf("Composante Contenu")).toBeGreaterThan(-1);
    expect(bloc.indexOf("Composante Caisse")).toBeGreaterThan(bloc.indexOf("Composante Contenu"));
    expect(bloc).toContain("Composante Caisse : garanti 200 000 F CFA");
    // Une garantie à une seule composante : sa composante (Base) porte la ligne entière.
    expect(texte.slice(positions[0], positions[1])).toContain("Composante Base");

    // Réédition (T10) : même contenu, version 2, mêmes versions de sous-modèles.
    const v2 = await reediter(technique, cp.id, null);
    expect(v2.version).toBe(2);
    const ligne2 = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: v2.id } });
    expect((ligne2.versionsAssociees as { sousModeles: { garanties: Record<string, number> } }).sousModeles.garanties).toEqual(versions);
    const texte2 = texteDuPdf(await stockage().lire(ligne2.chemin))!;
    expect(texte2.replace(/v\d+/g, "v").replace(/\S*verif\S*/g, "")).toContain("GARANTIE Vol (code vol)");
    expect(texte2.indexOf("GARANTIE Tempête (code tempete)")).toBeGreaterThan(texte2.indexOf("GARANTIE Bris de glaces (code bdg)"));
  }, 240_000);
});
