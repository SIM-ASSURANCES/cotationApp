// Test de BOUT EN BOUT (npm run test:e2e) : vraie base de test ET vrai générateur (GENERATEUR_URL,
// lancé à part : uvicorn en développement). Modèles Word de test : generateur/tests/fixtures/.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { donneesExemple } from "@/domaine/documents/dictionnaire";

import { assurerBranche } from "./branches-test";
import { obtenirConfig } from "./config";
import { initialiserProfilsEtDroits } from "./droits";
import { generateur, remplacerGenerateur } from "./generateur";
import { apercuVersion, creerModele, deposerVersion, ErreurDepot, pdfPublie, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const fixture = (nom: string) => new Uint8Array(readFileSync(join(FIXTURES, nom)));
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const pages = (pdf: Uint8Array) => (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let produit: string;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
const depot = (nom: string, surcharge = {}) => ({ fichier: fixture(nom), nomFichier: nom, commentaire: "Test de bout en bout", dateEffet: aujourdhui(), visa: null, dateDocument: null, ...surcharge });
async function publier(modeleId: number, nom: string, surcharge = {}): Promise<number> {
  await deposerVersion(technique, modeleId, depot(nom, surcharge), null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return v.id;
}

beforeAll(async () => {
  remplacerGenerateur(null);
  const sante = await fetch(new URL("/sante", obtenirConfig().GENERATEUR_URL)).catch(() => null);
  if (!sante?.ok) {
    throw new Error(`Générateur injoignable sur ${obtenirConfig().GENERATEUR_URL} : lancez-le avant npm run test:e2e (voir docs/installation.md §5).`);
  }
  await initialiserProfilsEtDroits();
  const id = unique("admin");
  await creerAdministrateurInitial({ identifiant: id, nom: "Admin", motDePasse: MDP });
  const admin = await compte(id);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, dg] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE")];
  produit = CODE("PRD");
  await assurerBranche("SANTE");
  await creerProduit(technique, { code: produit, libelle: "Produit de bout en bout", gamme: "RELAX", branche: "SANTE" }, null);
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("bout en bout avec le vrai générateur", () => {
  it("T9 : {{ client.nom }} refusé au dépôt, avec son emplacement exact", async () => {
    const id = await creerModele(technique, { type: "CP", code: CODE("CP"), libelle: "CP T9", produitCode: produit, ...sans }, null);
    const refus = await deposerVersion(technique, id, depot("t9_balise_inconnue.docx"), null).catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(ErreurDepot);
    expect((refus as ErreurDepot).details).toEqual([
      "Balise inconnue « client.nom » dans {{ client.nom }} : ce nom n'est pas dans le dictionnaire des champs. — corps, tableau 1, ligne 2, colonne 1 : « {{ client.nom }} »",
    ]);
    expect(await obtenirPrisma().modeleVersion.count({ where: { modeleId: id } })).toBe(0);
  });

  it("champ Word qui imite une balise : refusé", async () => {
    const id = await creerModele(technique, { type: "CP", code: CODE("CP"), libelle: "CP champ Word", produitCode: produit, ...sans }, null);
    const refus = (await deposerVersion(technique, id, depot("champ_word.docx"), null).catch((e: unknown) => e)) as ErreurDepot;
    expect(refus.details.join("\n")).toContain("Balise saisie comme champ Word (« souscripteur.nom ») : retapez-la au clavier");
  });

  it("CP déposé, annexe et sous-modèle : aperçu PDF ; T7 : 25 assurés ajoutent l'annexe en fin de PDF", async () => {
    const anx = await creerModele(technique, { type: "ANNEXE", code: CODE("ANX"), libelle: "Annexe assurés", produitCode: produit, ...sans, listeAnnexe: "assures" }, null);
    await publier(anx, "annexe_assures.docx");
    const gar = await creerModele(technique, { type: "SOUS_MODELE", code: CODE("GAR"), libelle: "Garanties Solo", produitCode: produit, ...sans, blocNom: "garanties", blocCle: "SOLO" }, null);
    await publier(gar, "garanties_solo.docx");
    const cp = await creerModele(technique, { type: "CP", code: CODE("CP"), libelle: "CP de test", produitCode: produit, ...sans }, null);
    const r = await deposerVersion(technique, cp, depot("cp_test.docx"), null);
    expect(r.numero).toBe(1);
    const version = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: cp } });

    const court = await apercuVersion(technique, version.id, { nombreAssures: 2 }, null);
    const long = await apercuVersion(technique, version.id, { nombreAssures: 25 }, null);
    expect(Buffer.from(court.contenu).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(long.contenu)).toBeGreaterThan(pages(court.contenu));
  }, 120_000);

  it("champs obligatoires vides dans un filtre : tous nommés en un seul refus, les facultatifs vides passent", async () => {
    const donnees = donneesExemple() as Record<string, Record<string, unknown>> & { formules: Record<string, unknown>[]; assures: Record<string, unknown>[] };
    donnees.souscripteur.date_naissance = null; // | date
    donnees.formules[0].taux_couverture = null; // | pct
    donnees.assures[1].date_naissance = ""; // | date
    donnees.police.nantissement = null; // facultatif (D19) : jamais nommé
    const refus = await generateur()
      .genererPdf({ modele: fixture("cp_test.docx"), donnees, seuilListe: 10, sousModeles: { garanties: Object.fromEntries(donnees.formules.map((f) => [String(f.code), fixture("garanties_solo.docx")])) } })
      .catch((e: unknown) => e);
    const message = refus instanceof Error ? refus.message : String(refus);
    expect(message).toMatch(/^Génération impossible : \d+ points à corriger : /);
    expect(message).toContain("champ obligatoire vide : « souscripteur.date_naissance » (filtre date)");
    expect(message).toContain("champ obligatoire vide : « formules[0].taux_couverture » (filtre pct)");
    expect(message).toContain("champ obligatoire vide : « assures[1].date_naissance » (filtre date)");
    expect(message).not.toContain("police.nantissement");
  });

  it("CG : PDF produit à la publication, avec le visa", async () => {
    const cg = await creerModele(technique, { type: "CG", code: CODE("CG"), libelle: "SECUR DOMMAGE (test)", produitCode: null, ...sans }, null);
    const v = await publier(cg, "cg_test.docx", { visa: "MFB/DGTCP/DA/N° 01498", dateDocument: "2025-06-19" });
    const pdf = await pdfPublie(technique, v, null);
    expect(Buffer.from(pdf.contenu).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(pdf.contenu)).toBe(1);
  }, 120_000);
});
