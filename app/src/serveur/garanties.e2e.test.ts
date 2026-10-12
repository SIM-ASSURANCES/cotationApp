// Session 6.2b, bout en bout (npm run test:e2e) : vraie base de test, VRAI générateur, VRAI stockage.
// Produit tarifé par garanties : cotation créée par le Commercial, prime composée par la Technique, émise, acceptée, CP, facture :
// les montants sont identiques partout (cotation, police, CP, facture) et les PDF portent UNE LIGNE PAR GARANTIE avec son taux de taxe.
// Modèles Word de test : generateur/tests/fixtures/ (données inventées). Chiffres inventés des instructions de la phase 6.2.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assurerBranche } from "./branches-test";
import { obtenirConfig } from "./config";
import { accepter, composerLaPrime, creerBrouillon, lireCotation, soumettre } from "./cotations";
import { emettreCotation, emettreCp } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { creerFactureAffaireNouvelle, emettreAvoir, emettreFacture } from "./factures";
import { remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature, assurerSocieteDeTest, PNG_REEL_1PX } from "./societe-test";
import { remplacerStockage, stockage } from "./stockage";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const fixture = (nom: string) => new Uint8Array(readFileSync(join(FIXTURES, nom)));
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
const VISA_CG = "VISA-INVENTE-6B";

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let produit: string;
let incendie: string;
let iard: string;
let compteur = 0;
const numeroPolice = () => `E2E-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(++compteur).padStart(5, "0")}`;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

function texteDuPdf(pdf: Uint8Array): string | null {
  const r = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(pdf), maxBuffer: 20_000_000 });
  // Les cellules étroites d'un tableau passent à la ligne dans le texte extrait : on compare sur un texte aux espaces et retours à la ligne unifiés.
  return r.status === 0 ? r.stdout.toString("utf8").replace(/[  ]/g, " ").replace(/\s+/g, " ") : null;
}
const AVEC_PDFTOTEXT = spawnSync("pdftotext", ["-v"]).error === undefined;

async function publier(type: "CG" | "CP" | "COTATION" | "FACTURE" | "AVOIR", produitCode: string | null, nom: string, surcharge: Record<string, unknown> = {}): Promise<string> {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: type === "CG" ? "SECURPRO – Conditions générales (test)" : `${type} (bout en bout)`, produitCode, ...sans }, null);
  await deposerVersion(technique, id, { fichier: fixture(nom), nomFichier: nom, commentaire: "Test de bout en bout 6.2b", dateEffet: aujourdhui(), visa: null, dateDocument: null, ...surcharge }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

async function pdfDe(numero: string, version: number): Promise<Uint8Array> {
  const d = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { numero_version: { numero, version } } });
  return stockage().lire(d.chemin);
}

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

  // Branches et taux propres à ce test (incendie 12,5 %, autres dommages aux biens 7,25 %).
  incendie = await assurerBranche(`INC_${CODE("B")}`.slice(0, 20));
  iard = await assurerBranche(`IARD_${CODE("B")}`.slice(0, 20));
  for (const [branche, taux] of [[incendie, "12.5"], [iard, "7.25"]] as const) {
    await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: taux, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  }
  const cg = await publier("CG", null, "cg_test.docx", { visa: VISA_CG, dateDocument: "2025-06-19" });
  produit = CODE("SECURPRO");
  await creerProduit(technique, { code: produit, libelle: "SECURPRO (produit de test par garanties)", gamme: "SECUR", branche: iard }, null);
  await creerVersion(
    technique,
    produit,
    {
      dateEffet: "2020-01-01",
      modeTarification: "GARANTIES",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
      prorata: { actif: false, primeMinimale: null },
      fractionnement: { tranchesMax: 2, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: null,
      formules: [],
      garanties: [{ libelle: "Incendie", branche: incendie }, { libelle: "Vol", branche: iard }, { libelle: "Dégât des eaux", branche: iard }],
      references: { cgModeleCode: cg, cgVisa: VISA_CG, csModeleCode: null, csVisa: null },
    },
    null,
  );
  await publier("COTATION", produit, "cotation_garanties_test.docx");
  await publier("CP", produit, "cp_garanties_test.docx");
  await publier("FACTURE", produit, "facture_garanties_test.docx");
  await publier("AVOIR", produit, "avoir_test.docx");
}, 120_000);

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("produit par garanties : composition → cotation → police → CP → facture → avoir, vrais PDF", () => {
  it("36 424 F partout ; une ligne par garantie, avec son taux ; taux global vide ; avoir en négatif", async () => {
    const id = await creerBrouillon(commercial, {
      codeProduit: produit,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE SA", telephone: "", email: "", adresse: "Plateau, rue inventée" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      nombreTranches: 2,
      lignes: [],
      motifForcage: null,
      assures: [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
    }, null);
    await composerLaPrime(
      technique,
      id,
      [
        { libelle: "Incendie", branche: incendie, primeNette: "10000", accessoires: "2500" },
        { libelle: "Vol", branche: iard, primeNette: "9850", accessoires: "2500" },
        { libelle: "Dégât des eaux", branche: iard, primeNette: "6000", accessoires: "2500" },
      ],
      "Simulateur de la Technique (chiffres inventés)",
      null,
    );
    expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
    expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed()).toBe("36424");
    const cotation = await emettreCotation(technique, id, null);

    const { numeroPolice: numero } = await accepter(commercial, id, [], numeroPolice(), null);
    const cp = await emettreCp(technique, id, null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
    expect(police.ttcTotal.toFixed()).toBe("36424");

    const fid = await creerFactureAffaireNouvelle(technique, police.id, null, null);
    const f = await emettreFacture(technique, fid, null);
    if (f.statut !== "EMISE") throw new Error("attendu : émise");
    expect(f.productions[0].ok).toBe(true);

    for (const pdf of [await pdfDe(cotation.numero, 1), await pdfDe(cp.numero, 1), await pdfDe(f.numero, 1)]) expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    if (!AVEC_PDFTOTEXT) return;

    // Cotation, CP et facture : une ligne par garantie, son libellé, son taux (12,5 % pour l'incendie, 7,25 % pour les autres), sa taxe et son TTC.
    for (const texte of [texteDuPdf(await pdfDe(cotation.numero, 1))!, texteDuPdf(await pdfDe(cp.numero, 1))!, texteDuPdf(await pdfDe(f.numero, 1))!]) {
      expect(texte).toContain("Incendie");
      expect(texte).toContain("Vol");
      expect(texte).toContain("Dégât");
      expect(texte).toMatch(/12[,.]5 ?%/);
      expect(texte).toMatch(/7[,.]25 ?%/);
      expect(texte.match(/7[,.]25 ?%/g)!.length).toBeGreaterThanOrEqual(2); // Vol et Dégât des eaux
      expect(texte).toContain("1 563"); // taxe incendie
      expect(texte).toContain("14 063"); // TTC incendie
      expect(texte).toContain("13 245");
      expect(texte).toContain("9 116");
      expect(texte).toContain("36 424");
    }
    const t = texteDuPdf(await pdfDe(f.numero, 1))!;
    expect(t).toContain("Total HT : 25 850");
    expect(t).toContain("taxe : 3 074");
    expect(t).toContain("Total TTC : 36 424 F CFA, soit trente-six mille quatre cent vingt-quatre francs CFA");
    // Plusieurs taux : le taux unique est vide (champ facultatif, aucune erreur de génération).
    expect(t).toMatch(/Taux de taxe unique : Total TTC/);
    // Fractionnement inchangé : 2 échéances de 18 212.
    expect(t.match(/18 212 F CFA/g)).toHaveLength(2);

    // L'avoir reprend la facture en négatif.
    const avoir = await emettreAvoir(technique, fid, "Erreur de facturation (avoir de test)", null);
    expect(avoir.productions[0].ok).toBe(true);
    const ta = texteDuPdf(await pdfDe(avoir.numero, 1))!;
    expect(ta).toContain("-36 424");
  });
});
