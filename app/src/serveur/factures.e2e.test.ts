// Session 4b, bout en bout (npm run test:e2e) : vraie base de test, VRAI générateur, VRAI stockage.
//  - T2 : facture de groupe CGE-SN, 4 échéances, TTC en lettres, liste des adhérents en annexe.
//  - T3 : facture individuelle YAO (163 jours), paiement de 41 000 F : reçu REC et facture v2 avec le restant dû.
//  - T4 : avoir AV, page de vérification « Annulée – avoir AV-… ».
// Modèles Word de test : generateur/tests/fixtures/ (données inventées).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Assure } from "@/domaine/cotation/saisie";

import { assurerBranche, rattacherCgDeTest } from "./branches-test";
import { obtenirConfig } from "./config";
import { accepter, creerBrouillon, soumettre, type SaisieCotation } from "./cotations";
import { emettreCp, verifierJeton } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { creerFactureAffaireNouvelle, emettreAvoir, emettreFacture, enregistrerPaiement } from "./factures";
import { remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature, assurerSocieteDeTest, PNG_REEL_1PX } from "./societe-test";
import { remplacerStockage, stockage } from "./stockage";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";
import { debutTest, finTest } from "./dates-test";
import { fixerSeuilGlobalDeTest, retablirSeuilGlobalDeTest } from "./parametres-test";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const fixture = (nom: string) => new Uint8Array(readFileSync(join(FIXTURES, nom)));
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
const VISA_CG = "VISA-INVENTE-4B";

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let comptable: UtilisateurCourant;
let produitGroupe: string;
let produitIndividuel: string;
let compteur = 0;
const numeroPolice = (lettre: "G" | "I") => `E2E-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-${lettre}${String(++compteur).padStart(5, "0")}`;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

function texteDuPdf(pdf: Uint8Array): string | null {
  const r = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(pdf), maxBuffer: 20_000_000 });
  return r.status === 0 ? r.stdout.toString("utf8").replace(/[  ]/g, " ") : null;
}
const AVEC_PDFTOTEXT = spawnSync("pdftotext", ["-v"]).error === undefined;

async function publier(type: "CG" | "CP" | "FACTURE" | "AVOIR" | "RECU" | "ANNEXE", produitCode: string | null, nom: string, surcharge: Record<string, unknown> = {}): Promise<string> {
  const id = await creerModele(
    technique,
    { type, code: CODE(type), libelle: type === "CG" ? "Santé – Conditions générales (test)" : `${type} (bout en bout)`, produitCode, ...sans, listeAnnexe: type === "ANNEXE" ? "assures" : null },
    null,
  );
  await deposerVersion(technique, id, { fichier: fixture(nom), nomFichier: nom, commentaire: "Test de bout en bout 4b", dateEffet: aujourdhui(), visa: null, dateDocument: null, ...surcharge }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

async function produit(typeContrat: "GROUPE" | "INDIVIDUEL", cgCode: string, formules: VersionSaisie["formules"], tranchesMax: number): Promise<string> {
  const code = CODE(typeContrat === "GROUPE" ? "RLX" : "IND");
  const branche = await assurerBranche(`SANTE_${code}`);
  await creerTaxe(technique, { branche, typeContrat, tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code, libelle: typeContrat === "GROUPE" ? "RELAXSANTE 80 % (bout en bout)" : "Santé individuelle (bout en bout)", gamme: "RELAX", branchePrincipale: "MALADIE", branche }, null);
  await creerVersion(
    technique,
    code,
    {
      dateEffet: "2020-01-01",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
      prorata: { actif: true, primeMinimale: null },
      fractionnement: { tranchesMax, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: "20000000",
      formules,
      references: { csModeleCode: null, csVisa: null },
    },
    null,
  );
  await publier("CP", code, "cp_groupe_test.docx");
  // Contrat de groupe : la liste des adhérents est toujours renvoyée en annexe (CP et facture).
  if (typeContrat === "GROUPE") await publier("ANNEXE", code, "annexe_assures.docx");
  // Modèles du PRODUIT : ils passent avant un modèle commun éventuel.
  await publier("FACTURE", code, "facture_test.docx");
  await publier("AVOIR", code, "avoir_test.docx");
  await publier("RECU", code, "recu_test.docx");
  return code;
}

async function police(saisie: Omit<SaisieCotation, "clientId" | "motifForcage" | "beneficiaires" | "contactsUrgence" | "risque">, codes: string[], lettre: "G" | "I"): Promise<number> {
  const cotationId = await creerBrouillon(commercial, { ...saisie, clientId: null, motifForcage: null, beneficiaires: [], contactsUrgence: [], risque: {} }, null);
  expect((await soumettre(commercial, cotationId, null)).statut).toBe("EMISE");
  const { numeroPolice: numero } = await accepter(commercial, cotationId, codes, numeroPolice(lettre), null);
  await emettreCp(technique, cotationId, null);
  return (await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } })).id;
}

async function pdfDe(numero: string, version: number): Promise<{ pdf: Uint8Array; jeton: string }> {
  const d = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { numero_version: { numero, version } } });
  return { pdf: await stockage().lire(d.chemin), jeton: d.jeton };
}

const assure = (i: number, formule: string): Assure => ({ ordre: i, nom_prenoms: `Assuré ${i} Inventé`, date_naissance: "1990-01-01", sexe: i % 2 ? "F" : "M", lien: "Salarié", formule });

beforeAll(async () => {
  await fixerSeuilGlobalDeTest("20000000"); // T1 / T2 dépassent le seuil unique de 10 M (étape 3) : le test valide la production du PDF, pas la validation
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
  [technique, dg, commercial, comptable] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL"), await nouveau("COMPTABILITE")];
  await assurerSocieteDeTest(technique);
  await assurerSignature(technique, PNG_REEL_1PX);

  const cg = await publier("CG", null, "cg_test.docx", { visa: VISA_CG, dateDocument: "2025-06-19" });
  await rattacherCgDeTest("MALADIE", cg);
  produitGroupe = await produit(
    "GROUPE",
    cg,
    [
      { code: "SOLO", libelle: "Solo", tauxCouverture: "80", primeUnitaire: "236453.25", accessoireMode: "AUCUN", accessoireValeur: "0" },
      { code: "FAMILLE", libelle: "Famille", tauxCouverture: "80", primeUnitaire: "307389.16", accessoireMode: "AUCUN", accessoireValeur: "0" },
    ],
    4,
  );
  produitIndividuel = await produit("INDIVIDUEL", cg, [{ code: "F", libelle: "Formule unique", tauxCouverture: "80", primeUnitaire: "270129.11", accessoireMode: "AUCUN", accessoireValeur: "0" }], 1);
}, 120_000);

// Le seuil relevé dans beforeAll est rétabli même si la préparation ou un test échoue (afterAll s'exécute dans tous les cas),
// et la connexion se ferme même si ce rétablissement échoue.
afterAll(async () => {
  try {
    await retablirSeuilGlobalDeTest();
  } finally {
    await obtenirPrisma().$disconnect();
  }
});

describe("T2 : facture de groupe CGE-SN, vrai PDF", () => {
  it("TTC 11 592 000 en chiffres et en lettres, 4 échéances, police, CIMA, liste des adhérents en annexe", async () => {
    const policeId = await police(
      {
        codeProduit: produitGroupe,
        typeContrat: "GROUPE",
        souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "CGE-SN (société inventée)", telephone: "", email: "", adresse: "Plateau, rue inventée" },
        dateEffet: debutTest(),
        dateEcheance: finTest(debutTest()),
        nombreTranches: 4,
        lignes: [
          { codeFormule: "SOLO", effectif: 8 },
          { codeFormule: "FAMILLE", effectif: 31 },
        ],
        assures: [...Array.from({ length: 8 }, (_, i) => assure(i + 1, "SOLO")), ...Array.from({ length: 31 }, (_, i) => assure(i + 9, "FAMILLE"))],
      },
      ["SOLO", "FAMILLE"],
      "G",
    );
    const id = await creerFactureAffaireNouvelle(technique, policeId, null, null);
    const r = await emettreFacture(technique, id, null);
    if (r.statut !== "EMISE") throw new Error("attendu : émise");
    expect(r.productions[0].ok).toBe(true);
    const { pdf } = await pdfDe(r.numero, 1);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    if (!AVEC_PDFTOTEXT) return;
    const t = texteDuPdf(pdf)!;
    expect(t).toContain(`FACTURE n° ${r.numero} (v1)`);
    expect(t).toContain("Total HT : 11 420 690");
    expect(t).toContain("171 310");
    expect(t).toContain("Total TTC : 11 592 000 F CFA, soit onze millions cinq cent quatre-vingt-douze mille francs CFA");
    expect(t.match(/2 898 000 F CFA – Non payé/g)).toHaveLength(4);
    expect(t).toContain("Article 13 du Code CIMA");
    expect(t).not.toContain("Envoyé à");
    expect(t).not.toContain("Restant dû");
    // Facture de groupe : la liste par adhérent est en annexe (39 assurés).
    expect(t).toContain("Assuré 39 Inventé");
  });
});

describe("T3 et T4 : paiement, reçu, facture v2, puis avoir", () => {
  it("163 jours ; 41 000 F payés : reçu REC et facture v2 (restant dû 81 442) ; une autre facture annulée par avoir", async () => {
    const saisie = {
      codeProduit: produitIndividuel,
      typeContrat: "INDIVIDUEL" as const,
      souscripteur: { type: "PHYSIQUE" as const, nom: "YAO", prenoms: "Koffi (inventé)", raison_sociale: "", telephone: "0700000000", email: "", adresse: "Cocody, rue inventée" },
      dateEffet: debutTest(),
      dateEcheance: finTest(debutTest(), 163),
      nombreTranches: 1,
      lignes: [{ codeFormule: "F", effectif: 1 }],
      assures: [],
    };
    const id = await creerFactureAffaireNouvelle(technique, await police(saisie, ["F"], "I"), null, null);
    const f = await emettreFacture(technique, id, null);
    if (f.statut !== "EMISE") throw new Error("attendu : émise");
    const pay = await enregistrerPaiement(comptable, id, { date: aujourdhui(), montant: "41000", canal: "ESPECES", reference: "", payeur: "" }, null);
    expect(pay.productions.every((p) => p.ok)).toBe(true);
    const recu = await pdfDe(pay.numeroRecu, 1);
    const v2 = await pdfDe(f.numero, 2);
    if (AVEC_PDFTOTEXT) {
      const tr = texteDuPdf(recu.pdf)!;
      expect(tr).toContain(`REÇU n° ${pay.numeroRecu} – facture ${f.numero}`);
      expect(tr).toContain("41 000 F CFA, soit quarante et un mille francs CFA");
      expect(tr).toContain("restant dû : 81 442 F CFA");
      const tf = texteDuPdf(v2.pdf)!;
      expect(tf).toContain(`FACTURE n° ${f.numero} (v2)`);
      expect(tf).toContain("Taxe");
      expect(tf).toContain("Restant dû : 81 442 F CFA");
      expect(tf).toContain("Total TTC : 122 442 F CFA");
    }

    const autre = await creerFactureAffaireNouvelle(technique, await police(saisie, ["F"], "I"), null, null);
    const a = await emettreFacture(technique, autre, null);
    if (a.statut !== "EMISE") throw new Error("attendu : émise");
    const av = await emettreAvoir(comptable, autre, "Erreur de période (bout en bout)", null);
    expect(av.productions[0].ok).toBe(true);
    const { jeton } = await pdfDe(a.numero, 1);
    expect((await verifierJeton(jeton))!.statut.libelle).toBe(`Annulée – avoir ${av.numero}`);
    if (AVEC_PDFTOTEXT) {
      const ta = texteDuPdf((await pdfDe(av.numero, 1)).pdf)!;
      expect(ta).toContain(`AVOIR n° ${av.numero} – annule la facture ${a.numero}`);
      expect(ta).toContain("TTC -122 442 F CFA");
    }
  });
});
