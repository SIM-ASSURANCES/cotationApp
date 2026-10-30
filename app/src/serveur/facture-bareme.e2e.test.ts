// Session fix-facture-bareme (D60), bout en bout (npm run test:e2e) : vraie base de test, VRAI générateur, VRAI stockage.
// Cotation au barème (SECURPRO inventé) → acceptation → CP → facture d'affaire nouvelle : le bouton « Émettre » est proposé (drapeau d'écran),
// aucune composition n'est demandée, la facture s'émet et son TTC est celui de la cotation, du jeu d'essai du barème et du PDF.
// Modèles Word de test : generateur/tests/fixtures/ (données inventées).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lireBareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import { ajouterJours } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { basculerVersionAuBareme, lireBaremePublie, publierBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { importerBaremeXlsx } from "./bareme-excel";
import { assurerBranche, rattacherCgDeTest } from "./branches-test";
import { obtenirConfig } from "./config";
import { accepter, creerBrouillon, lireCotation, soumettre, type SaisieCotation } from "./cotations";
import { debutTest } from "./dates-test";
import { emettreCotation, emettreCp } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { composerFacture, creerFactureAffaireNouvelle, emettreFacture, lireFacture, MESSAGE_FACTURE_AU_BAREME } from "./factures";
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
const VISA_CG = "VISA-INVENTE-D60";

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let gestionnaire: UtilisateurCourant;
let produit: string;
let incendie: string;
let iard: string;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

function texteDuPdf(pdf: Uint8Array): string | null {
  const r = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(pdf), maxBuffer: 20_000_000 });
  return r.status === 0 ? r.stdout.toString("utf8").replace(/[  ]/g, " ").replace(/\s+/g, " ") : null;
}
const AVEC_PDFTOTEXT = spawnSync("pdftotext", ["-v"]).error === undefined;

async function publier(type: "CG" | "CP" | "COTATION" | "FACTURE", produitCode: string | null, nom: string, surcharge: Record<string, unknown> = {}): Promise<string> {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: type === "CG" ? "SECURPRO – Conditions générales (test)" : `${type} (bout en bout)`, produitCode, ...sans }, null);
  await deposerVersion(technique, id, { fichier: fixture(nom), nomFichier: nom, commentaire: "Test de bout en bout D60", dateEffet: aujourdhui(), visa: null, dateDocument: null, ...surcharge }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

async function pdfDe(numero: string, version: number): Promise<Uint8Array> {
  const d = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { numero_version: { numero, version } } });
  return stockage().lire(d.chemin);
}

/** Change la version en contournant les déclencheurs : base de test seulement (on ne peut pas attendre une date d'effet). */
async function changerLaVersionPourTest(id: number, affectation: string): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe(`UPDATE produit_versions SET ${affectation} WHERE id = ${id}`);
  });
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
  [technique, dg, commercial, gestionnaire] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL"), await nouveau("GESTIONNAIRE_PRODUCTION")];
  await assurerSocieteDeTest(technique);
  await assurerSignature(technique, PNG_REEL_1PX);

  incendie = await assurerBranche(`INC_${CODE("B")}`.slice(0, 20));
  iard = await assurerBranche(`IARD_${CODE("B")}`.slice(0, 20));
  for (const [branche, taux] of [[incendie, "12.5"], [iard, "7.25"]] as const) {
    await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: taux, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  }
  const cg = await publier("CG", null, "cg_test.docx", { visa: VISA_CG, dateDocument: "2025-06-19" });
  await rattacherCgDeTest("INCENDIE_DOMMAGES", cg);

  produit = CODE("SECURPRO");
  await creerProduit(technique, { code: produit, libelle: "SECURPRO (produit de test au barème)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: iard }, null);
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
  const { id: versionId } = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code: produit } } });
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD: iard, INCENDIE: incendie };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await construireClasseur(lireBareme(d), { titre: "SECURPRO inventé (test D60)" }), null);
  await publierBareme(technique, versionId, "Barème SECURPRO inventé (test D60)", null);
  await basculerVersionAuBareme(technique, versionId, null);
  await changerLaVersionPourTest(versionId, "date_effet = DATE '2020-01-01'");

  await publier("COTATION", produit, "cotation_garanties_test.docx");
  await publier("CP", produit, "cp_garanties_test.docx");
  await publier("FACTURE", produit, "facture_garanties_test.docx");
}, 120_000);

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("police au barème : cotation → acceptation → facture, « Émettre » proposé, vraie émission", () => {
  it("aucune composition demandée ; la facture s'émet ; TTC = cotation = jeu d'essai = PDF", async () => {
    const { bareme } = await lireBaremePublie(obtenirPrisma(), (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code: produit } } })).id);
    const essai = bareme.jeuxEssai[0];
    const effet = aujourdhui();
    const brut = {
      champs: Object.fromEntries(Object.entries(essai.entrees.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
      souscrit: essai.entrees.souscrit,
      ...(essai.entrees.effectif !== undefined ? { effectif: String(essai.entrees.effectif) } : {}),
    };
    const saisie: SaisieCotation = {
      codeProduit: produit,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ATELIERS DU LAGON SARL (inventée)", telephone: "0700000000", email: "contact@ateliers-lagon.exemple.ci", adresse: "Zone industrielle de Yopougon, rue inventée, Abidjan" },
      dateEffet: effet,
      dateEcheance: ajouterJours(effet, 364),
      nombreTranches: 1,
      lignes: [],
      motifForcage: null,
      assures: [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
      baremeBrut: brut,
    };
    const id = await creerBrouillon(commercial, saisie, null);
    expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
    const ttcCotation = (await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed();
    expect(ttcCotation).toBe(essai.attendu.ttc);
    await emettreCotation(commercial, id, null);
    const { numeroPolice } = await accepter(commercial, id, [], `E2E-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I00001`, null);
    await emettreCp(technique, id, null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: numeroPolice } });

    const fid = await creerFactureAffaireNouvelle(gestionnaire, police.id, null, null);
    // Ce que l'écran affiche : « Émettre » oui, « Composer une prime » non (pour la Technique non plus), aucun libellé « À composer ».
    const ecran = (await lireFacture(gestionnaire, fid))!;
    expect(ecran.actions.emettre).toBe(true);
    expect(ecran.actions.composer).toBe(false);
    expect(ecran.libelleStatut).toBe("Brouillon");
    expect((await lireFacture(technique, fid))!.actions.composer).toBe(false);
    await expect(composerFacture(technique, fid, [{ libelle: "Incendie", branche: iard, primeNette: "1000", accessoires: "0" }], "Contournement du barème", null)).rejects.toThrow(MESSAGE_FACTURE_AU_BAREME);

    const f = await emettreFacture(gestionnaire, fid, null);
    if (f.statut !== "EMISE") throw new Error("attendu : émise");
    expect(f.productions[0].ok).toBe(true);
    const emise = (await lireFacture(gestionnaire, fid))!;
    expect(emise.statut).toBe("EMISE");
    expect(emise.ttc).toBe(ttcCotation);
    expect(emise.actions.emettre).toBe(false);

    const pdf = await pdfDe(f.numero, 1);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    if (!AVEC_PDFTOTEXT) return;
    const montant = Number(ttcCotation).toLocaleString("fr-FR").replace(/[  ]/g, " ");
    expect(texteDuPdf(pdf)!).toContain(montant);
  });
});
