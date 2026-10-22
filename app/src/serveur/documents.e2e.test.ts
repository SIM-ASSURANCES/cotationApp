// Bout en bout (npm run test:e2e) : vraie base de test, VRAI générateur et VRAI stockage (volume du
// générateur). Cotation T1 complète : modèle publié, émission, PDF stocké, vérification, réédition.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assurerBranche } from "./branches-test";
import { obtenirConfig } from "./config";
import { creerBrouillon, soumettre } from "./cotations";
import { emettreCotation, reediter, telechargerDocument, verifierJeton } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { remplacerStockage, stockage } from "./stockage";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";
import { debutTest, finTest } from "./dates-test";
import { fixerSeuilGlobalDeTest, retablirSeuilGlobalDeTest } from "./parametres-test";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const pages = (pdf: Uint8Array) => (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;

async function compte(identifiant: string) {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

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
  [technique, dg, commercial] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL")];
});

afterAll(async () => {
  await retablirSeuilGlobalDeTest();
  await obtenirPrisma().$disconnect();
});

describe("cotation T1 de bout en bout", () => {
  it("émission : PDF stocké (empreinte vérifiée), page de vérification, réédition en v2", async () => {
    const produit = CODE("BENI");
    const branche = `SANTE_${produit}`;
    await assurerBranche(branche);
    await creerTaxe(technique, { branche, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerProduit(technique, { code: produit, libelle: "Santé BENI (bout en bout)", gamme: "RELAX", branchePrincipale: "MALADIE", branche }, null);
    await creerVersion(
      technique,
      produit,
      {
        dateEffet: "2020-01-01",
        arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
        prorata: { actif: true, primeMinimale: null },
        fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
        cotation: { validiteMois: 3, formulesMax: 3 },
        seuilValidationTtc: "20000000",
        formules: [
          { code: "SOLO", libelle: "Solo", tauxCouverture: "80", primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" },
          { code: "FAMILLE", libelle: "Famille", tauxCouverture: "80", primeUnitaire: "252657.63", accessoireMode: "FIXE", accessoireValeur: "210000" },
        ],
      },
      null,
    );
    const modele = await creerModele(technique, { type: "COTATION", code: CODE("COT"), libelle: "Cotation santé", produitCode: produit, niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null }, null);
    await deposerVersion(technique, modele, { fichier: new Uint8Array(readFileSync(join(FIXTURES, "cotation_test.docx"))), nomFichier: "cotation_test.docx", commentaire: "Modèle de test", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null);
    const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: modele } });
    await soumettreVersion(technique, v.id, null);
    await publierVersion(dg, v.id, aujourdhui(), null);

    const id = await creerBrouillon(
      commercial,
      {
        codeProduit: produit,
        clientId: null,
        typeContrat: "GROUPE",
        souscripteur: { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa Inventée", raison_sociale: "", telephone: "", email: "", adresse: "" },
        dateEffet: debutTest(),
        dateEcheance: finTest(debutTest()),
        nombreTranches: 1,
        lignes: [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }],
        motifForcage: null,
        assures: [],
        beneficiaires: null,
        contactsUrgence: null,
        risque: {},
      },
      null,
    );
    await soumettre(commercial, id, null);
    const doc = await emettreCotation(commercial, id, null);

    const ligne = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    const stocke = await stockage().lire(ligne.chemin);
    expect(Buffer.from(stocke).subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(stocke).digest("hex")).toBe(ligne.empreinte);
    expect(pages(stocke)).toBe(1);
    expect((await telechargerDocument(commercial, doc.id, null)).contenu).toEqual(stocke);

    const vue = await verifierJeton(ligne.jeton);
    expect(vue).toMatchObject({ numero: doc.numero, statut: { code: "VALIDE" }, souscripteur: "K****** A.", empreinte: ligne.empreinte });

    const v2 = await reediter(commercial, doc.id, null);
    expect(v2.version).toBe(2);
    const ligne2 = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: v2.id } });
    expect(ligne2.chemin).not.toBe(ligne.chemin);
    expect(ligne2.jeton).not.toBe(ligne.jeton);
    // Le premier fichier est toujours là, inchangé (ajout seul).
    expect(createHash("sha256").update(await stockage().lire(ligne.chemin)).digest("hex")).toBe(ligne.empreinte);
  }, 180_000);
});
