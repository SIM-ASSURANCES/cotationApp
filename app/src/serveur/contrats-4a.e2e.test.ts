// Session 4a, bout en bout (npm run test:e2e) : vraie base de test, VRAI générateur, VRAI stockage.
//  - T5 : SECURVIE (branche DECES, taxe 0 %), 3 bénéficiaires, garanties issues du sous-modèle, visa du CP = visa des CG.
//  - T6 : VOL (branche IARD), cases à cocher, date d'émission dynamique. Test du DOCUMENT SEUL, avec des montants
//    de fixture : l'application ne calcule pas une cotation IARD (produit par garanties : la prime se compose, 6.2b ; un produit à la formule sur une branche à taux mixte reste refusé).
// Modèles Word de test : generateur/tests/fixtures/ (données inventées).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import { donneesDocument, type SourceDocument } from "@/domaine/documents/donnees";

import { assurerBranche } from "./branches-test";
import { obtenirConfig } from "./config";
import { accepter, composerLaPrime, creerBrouillon, lireCotation, soumettre, type SaisieCotation } from "./cotations";
import { emettreCp } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { generateur, remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion, initialiserBranches, initialiserTaxes, type TaxeDemarrage } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { lireImageSociete, lireParametresSociete } from "./societe";
import { assurerSignature, assurerSocieteDeTest, PNG_REEL_1PX } from "./societe-test";
import { remplacerStockage, stockage } from "./stockage";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const DONNEES = join(process.cwd(), "prisma", "donnees");
const fixture = (nom: string) => new Uint8Array(readFileSync(join(FIXTURES, nom)));
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
const VISA_CG = "MFB/DGTCP/DA/N° 01497";

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

/** Texte d'un PDF par pdftotext, ou null si l'outil n'est pas installé (les contrôles de texte sont alors ignorés). */
function texteDuPdf(pdf: Uint8Array): string | null {
  const r = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(pdf), maxBuffer: 20_000_000 });
  return r.status === 0 ? r.stdout.toString("utf8").replace(/[  ]/g, " ") : null;
}
const AVEC_PDFTOTEXT = spawnSync("pdftotext", ["-v"]).error === undefined;
const pages = (pdf: Uint8Array) => (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

async function publier(modeleId: number, nom: string, surcharge: Record<string, unknown> = {}): Promise<number> {
  await deposerVersion(technique, modeleId, { fichier: fixture(nom), nomFichier: nom, commentaire: "Test de bout en bout 4a", dateEffet: aujourdhui(), visa: null, dateDocument: null, ...surcharge }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return v.id;
}

const version = (references?: { cgModeleCode: string; cgVisa: string }): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: true, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: "20000000",
  formules: [{ code: "STANDARD", libelle: "Standard", tauxCouverture: null, primeUnitaire: "100000", accessoireMode: "FIXE", accessoireValeur: "5000" }],
  ...(references ? { references: { ...references, csModeleCode: null, csVisa: null } } : {}),
});

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

  // Les VRAIES données de démarrage : branches et taux de la loi (DECES à 0 %, INCENDIE à 12,5 %, IARD à 7,25 %).
  const branches = JSON.parse(readFileSync(join(DONNEES, "branches.json"), "utf8")) as { lignes: { code: string; libelle: string }[] };
  const taux = JSON.parse(readFileSync(join(DONNEES, "taxes-loi.json"), "utf8")) as { lignes: TaxeDemarrage[] };
  await initialiserBranches(branches.lignes);
  await initialiserTaxes(taux.lignes);
  await assurerBranche("DECES");

  // Paramètres de la Société (inventés) : clause de réclamation et RCCM du CP ; vraie image PNG pour la signature de SIM.
  await assurerSocieteDeTest(technique);
  await assurerSignature(technique, PNG_REEL_1PX);
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("T5 : SECURVIE, trois bénéficiaires, branche DECES (taxe 0 %)", () => {
  it("la police se crée sans ressaisie ; le CP est généré avec le tableau des bénéficiaires, les garanties du sous-modèle et le visa des CG", async () => {
    const prisma = obtenirPrisma();
    const cgId = await creerModele(technique, { type: "CG", code: CODE("CG"), libelle: "SECURVIE – Conditions générales", produitCode: null, ...sans }, null);
    const cgCode = (await prisma.modele.findUniqueOrThrow({ where: { id: cgId } })).code;
    await publier(cgId, "cg_test.docx", { visa: VISA_CG, dateDocument: "2025-06-19" });

    const code = CODE("SECURVIE");
    await creerProduit(technique, { code, libelle: "Sécur'Vie (bout en bout)", gamme: "RELAX", branchePrincipale: "DECES", branche: "DECES" }, null);
    await creerVersion(technique, code, version({ cgModeleCode: cgCode, cgVisa: VISA_CG }), null);
    // Le CP est déposé SANS ACCROC : l'analyse réelle vérifie le contenu obligatoire du §10.1 (durée, primes, CG, réclamation, date, signature…).
    const cp = await creerModele(technique, { type: "CP", code: CODE("CP"), libelle: "CP SECURVIE", produitCode: code, ...sans }, null);
    await publier(cp, "cp_securvie_test.docx");
    const gar = await creerModele(technique, { type: "SOUS_MODELE", code: CODE("GAR"), libelle: "Garanties Standard", produitCode: code, ...sans, blocNom: "garanties", blocCle: "STANDARD" }, null);
    await publier(gar, "garanties_securvie_standard.docx");

    const saisie: SaisieCotation = {
      codeProduit: code,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur: { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa Inventée", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      nombreTranches: 1,
      lignes: [{ codeFormule: "STANDARD", effectif: 1 }],
      motifForcage: null,
      assures: [],
      beneficiaires: [
        { ordre: 1, nom_prenoms: "KOUADIO Paul", lien: "Conjoint", contact: "0700000001", quote_part: "50" },
        { ordre: 2, nom_prenoms: "KOUADIO Marie", lien: "Enfant", contact: "0700000002", quote_part: "30" },
        { ordre: 3, nom_prenoms: "KOUADIO Jean", lien: "Enfant", contact: "0700000003", quote_part: "20" },
      ],
      contactsUrgence: [{ nom_prenoms: "YAO Eric", contact: "0700000009" }],
      risque: {},
    };
    const cotationId = await creerBrouillon(commercial, saisie, null);
    expect((await soumettre(commercial, cotationId, null)).statut).toBe("EMISE");
    const { numeroPolice } = await accepter(commercial, cotationId, ["STANDARD"], "SIM-2026-000001-I00001", null);
    const document = await emettreCp(technique, cotationId, null);

    // Données envoyées au générateur : taxe de la branche DECES à 0 %, montants du moteur (aucun calcul ici).
    const ligne = await prisma.documentEmis.findUniqueOrThrow({ where: { id: document.id } });
    const donnees = ligne.donnees as { prime: Record<string, string>; beneficiaires: { nom_prenoms: string; quote_part: string }[]; produit: Record<string, string> };
    expect(donnees.prime).toMatchObject({ nette: "100000", accessoires: "5000", taux_taxe: "0", taxe: "0", ttc: "105000" });
    expect(donnees.beneficiaires.map((b) => [b.nom_prenoms, b.quote_part])).toEqual([["KOUADIO Paul", "50"], ["KOUADIO Marie", "30"], ["KOUADIO Jean", "20"]]);
    expect(donnees.produit.cg_visa).toBe(VISA_CG);

    // PDF réellement stocké : CP puis CG jointes (CP → annexes → CS → CG), empreinte vérifiée.
    const pdf = await stockage().lire(ligne.chemin);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(ligne.empreinte);
    expect(pages(pdf)).toBeGreaterThanOrEqual(2);
    expect(ligne.numero).toBe(numeroPolice);

    if (!AVEC_PDFTOTEXT) return; // outil absent : contrôles de texte ignorés (le rendu est vérifié par pytest et à l'œil, docs/recette.md)
    const texte = texteDuPdf(pdf);
    expect(texte, "pdftotext est installé mais n'a pas lu le PDF").not.toBeNull();
    for (const attendu of ["KOUADIO Paul", "KOUADIO Marie", "KOUADIO Jean", "50 %", "30 %", "20 %", "Personne à prévenir : YAO Eric", "Décès toutes causes", "Frais funéraires", "taxe (0 %) 0", "TOTAL TTC 105 000 F CFA", `visa ${VISA_CG}`, "reclamations@exemple.ci"]) {
      expect(texte as string, attendu).toContain(attendu);
    }
    expect(texte as string).toContain(`Visa : ${VISA_CG} du 19/06/2025`); // CG jointes : même visa que celui cité par le CP
  }, 240_000);
});

describe("T6 : VOL (IARD), cases à cocher et date d'émission dynamique — document seul", () => {
  it("l'IARD n'est plus à taux mixte (INCENDIE 12,5 % et IARD 7,25 %, D32) : un produit par garanties se compose, un produit à la formule sur une branche à taux mixte reste refusé", async () => {
    const saisie = (codeProduit: string): SaisieCotation => ({
      codeProduit,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur: { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa", raison_sociale: "", telephone: "", email: "", adresse: "" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      nombreTranches: 1,
      lignes: [],
      motifForcage: null,
      assures: [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
    });
    // Configuration prévue pour un produit IARD : mode GARANTIES, avec les VRAIES données de démarrage (IARD à 7,25 %, INCENDIE à 12,5 %).
    const garanties = CODE("VOLG");
    await creerProduit(technique, { code: garanties, libelle: "Vol, par garanties (bout en bout)", gamme: "RELAX", branchePrincipale: "INCENDIE_DOMMAGES", branche: "IARD" }, null);
    await creerVersion(technique, garanties, { ...version(), modeTarification: "GARANTIES", formules: [] }, null);
    const brouillon = await creerBrouillon(commercial, saisie(garanties), null);
    await expect(soumettre(commercial, brouillon, null)).rejects.toThrow(/pas encore composée/);
    await composerLaPrime(technique, brouillon, [{ libelle: "Incendie", branche: "INCENDIE", primeNette: "10000", accessoires: "2500" }, { libelle: "Vol", branche: "IARD", primeNette: "9850", accessoires: "2500" }], "Simulateur (inventé)", null);
    expect((await soumettre(commercial, brouillon, null)).statut).toBe("EMISE");
    // Incendie : 12 500 × 12,5 % = 1 562,5 → 1 563 ; Vol : 12 350 × 7,25 % = 895,375 → 895 ; TTC 12 500 + 1 563 + 12 350 + 895 = 27 308.
    expect((await lireCotation(commercial, brouillon))!.resultat.totaux.arrondi.ttc.toFixed()).toBe("27308");

    // Un produit à la formule rattaché à une branche à taux MIXTE reste refusé : le filet existe toujours (la branche mixte est propre à ce test).
    const mixte = (await assurerBranche(`MIX_${CODE("B")}`.slice(0, 20)));
    await creerTaxe(technique, { branche: mixte, typeContrat: null, tauxMixte: true, commentaire: "12,5 % / 7,25 % (inventé)", tauxPourcent: null, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    const formule = CODE("VOL");
    await creerProduit(technique, { code: formule, libelle: "Vol (bout en bout)", gamme: "RELAX", branchePrincipale: "INCENDIE_DOMMAGES", branche: mixte }, null);
    await creerVersion(technique, formule, version(), null);
    await expect(creerBrouillon(commercial, { ...saisie(formule), lignes: [{ codeFormule: "STANDARD", effectif: 1 }] }, null).then((id) => soumettre(commercial, id, null))).rejects.toThrow(/taux mixte non pris en charge/);
  });

  it("CP VOL déposé (contenu du §10.1 vérifié), puis rendu avec des montants de fixture : les bonnes cases sont cochées, la date d'émission suit", async () => {
    const code = CODE("VOL");
    await creerProduit(technique, { code, libelle: "Vol", gamme: "RELAX", branchePrincipale: "INCENDIE_DOMMAGES", branche: "IARD" }, null);
    const cp = await creerModele(technique, { type: "CP", code: CODE("CP"), libelle: "CP VOL", produitCode: code, ...sans }, null);
    await publier(cp, "cp_vol_test.docx"); // refusé si le contenu obligatoire du §10.1 manque
    const modele = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: cp }, select: { fichier: true } });

    const societe = await lireParametresSociete();
    const source = (dateEmission: string): SourceDocument => ({
      type: "CP",
      numero: "SIM-2026-000002-I00001",
      version: 1,
      dateEmission,
      dateValidite: null,
      policeNumero: "SIM-2026-000002-I00001",
      produit: { code, libelle: "Vol", gamme: "RELAX", branche: "IARD" },
      cg: { libelle: "VOL – Conditions générales", visa: "MFB/DGTCP/DA/N° 01234", date: "2025-06-19" },
      cs: null,
      souscripteur: { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa", raison_sociale: "", telephone: "", email: "", adresse: "" },
      assures: [],
      ordresSansPrime: [],
      beneficiaires: [],
      contactsUrgence: [],
      policeMere: null,
      risque: { capital_vol_caisse: "100000", gardiennage: "NUIT", statut: "LOCATAIRE" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      joursCouverts: 365,
      // Montants de FIXTURE (taux de 10 % inventé, sans valeur fiscale) : le moteur ne calcule pas l'IARD.
      formules: [{ code: "STANDARD", libelle: "Standard", tauxCouverture: null, effectif: 1, primeUnitaire: "80000", primeParAssure: "80000", nette: "80000", accessoires: "5000", taxe: "8500", ttc: "93500" }],
      totaux: { nette: "80000", accessoires: "5000", taxe: "8500", ttc: "93500" },
      taxe: { tauxPourcent: "10", assiette: "NETTE_ACCESSOIRES" },
      echeances: [],
      forcee: false,
      motifForcage: null,
      societe: societe.societe,
      mentions: societe.document,
      urlVerification: "https://documents.exemple.ci/verif/" + "v".repeat(43),
      typeContrat: "INDIVIDUEL",
      auteurNom: "Test",
    });
    const signature = await lireImageSociete("signature_sim");
    const rendre = (dateEmission: string) =>
      generateur().genererPdf({
        modele: modele.fichier,
        donnees: donneesDocument(source(dateEmission)),
        seuilListe: 10,
        images: { signature_sim: { png: signature!, largeurMm: 40 } },
        qr: { url: "https://documents.exemple.ci/verif/" + "v".repeat(43) },
      });

    const premier = await rendre("2026-10-08");
    const second = await rendre("2026-11-15");
    expect(Buffer.from(premier).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(premier)).toBe(1);

    if (!AVEC_PDFTOTEXT) return;
    const texte = texteDuPdf(premier);
    const autre = texteDuPdf(second);
    if (texte === null || autre === null) throw new Error("pdftotext est installé mais n'a pas lu le PDF");
    const ligne = (debut: string) => texte.split("\n").find((l) => l.startsWith(debut)) ?? "";
    // Une seule case cochée par ligne : capital vol caisse 100 000, gardiennage de nuit, locataire.
    expect(ligne("Vol caisse").match(/☒/g)).toHaveLength(1);
    expect(ligne("Vol caisse").match(/☐/g)).toHaveLength(2);
    expect(ligne("Gardiennage").match(/☒/g)).toHaveLength(1);
    expect(ligne("Statut").match(/☒/g)).toHaveLength(1);
    expect(texte).toMatch(/☒ 100 000 F/);
    expect(texte).toMatch(/☒ Nuit/);
    expect(texte).toMatch(/☒ Locataire/);
    expect(texte).toContain("taxe (10 %) 8 500");
    expect(texte).toContain("Fait à Abidjan, le 08/10/2026");
    expect(autre).toContain("Fait à Abidjan, le 15/11/2026");
  }, 240_000);
});
