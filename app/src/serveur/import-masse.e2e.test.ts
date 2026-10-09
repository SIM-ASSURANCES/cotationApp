// Session 5a, bout en bout (npm run test:e2e) : T8, import en masse de 500 adhérents.
// Vraie base de test, VRAI générateur (LibreOffice, QR code, stockage en ajout seul), vrai Redis, vrai travailleur BullMQ
// démarré dans le processus du test. Le fichier de 500 lignes est GÉNÉRÉ ici, avec des noms inventés ; 12 lignes ont
// chacune une erreur d'un type différent. Attendu : 488 certificats, un rapport de 12 lignes, moins de 15 minutes.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Assure } from "@/domaine/cotation/saisie";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { obtenirConfig } from "./config";
import { accepter, creerBrouillon, soumettre } from "./cotations";
import { initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur } from "./generateur";
import { confirmerImport, controlerImport, lireLot, rapportErreurs, zipDuLot } from "./imports";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature, assurerSocieteDeTest, PNG_REEL_1PX } from "./societe-test";
import { remplacerStockage, stockage } from "./stockage";
import { fermerFiles, FILE_IMPORTS, viderFile } from "./taches";
import { demarrerTravailleur, type Travailleur } from "./travailleur";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const fixture = (nom: string) => new Uint8Array(readFileSync(join(FIXTURES, nom)));
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
const VISA_CG = "VISA-INVENTE-5A";
const QUINZE_MINUTES = 15 * 60 * 1000;

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let produitCode: string;
let travailleur: Travailleur;

const SERIE = String(Date.now() % 1_000_000).padStart(6, "0");
let compteur = 0;
const numero = () => `E2E-2026-${SERIE}-G${String(++compteur).padStart(5, "0")}`;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

function texteDuPdf(pdf: Uint8Array): string | null {
  const r = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(pdf), maxBuffer: 20_000_000 });
  return r.status === 0 ? r.stdout.toString("utf8").replace(/[  ]/g, " ") : null;
}

async function publier(type: "CG" | "CERTIFICAT", code: string | null, nom: string, surcharge: Record<string, unknown> = {}): Promise<string> {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: `${type} (T8)`, produitCode: code, ...sans }, null);
  await deposerVersion(technique, id, { fichier: fixture(nom), nomFichier: nom, commentaire: "Test T8 (session 5a)", dateEffet: aujourdhui(), visa: null, dateDocument: null, ...surcharge }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

// Prénoms et noms INVENTÉS, combinés pour donner 500 personnes distinctes.
const PRENOMS = ["Awa", "Koffi", "Aya", "Yao", "Adjoua", "Kouassi", "Affoué", "Konan", "Amenan", "N'Guessan", "Akissi", "Kouamé", "Ahou", "Brou", "Assata", "Tano", "Mariam", "Seydou", "Fanta", "Issa"];
const NOMS = ["KOUADIO", "TRAORÉ", "KONÉ", "BAMBA", "OUATTARA", "DIABATÉ", "YAPI", "N'DRI", "AKA", "GNAGNE", "TOURÉ", "SORO", "COULIBALY", "ZADI", "DJÉ", "BLÉ", "GOHI", "AMANI", "KACOU", "SEKA", "LOBA", "YAO", "ESSIS", "BOKA", "DAGO"];
const personne = (i: number) => `${NOMS[i % NOMS.length]} ${PRENOMS[Math.floor(i / NOMS.length) % PRENOMS.length]} ${Math.floor(i / 500) + 1}`;
const naissance = (i: number) => `${String((i % 28) + 1).padStart(2, "0")}/${String((i % 12) + 1).padStart(2, "0")}/${1965 + (i % 35)}`;

type Ligne = [string, string, string, string, string, string];
const existants: Assure[] = [
  { ordre: 1, nom_prenoms: "EXISTANT Premier Inventé", date_naissance: "1980-01-01", sexe: "M", lien: "Salarié", formule: "SOLO" },
  { ordre: 2, nom_prenoms: "EXISTANT Second Inventé", date_naissance: "1982-02-02", sexe: "F", lien: "Salarié", formule: "FAMILLE" },
];

/** 488 lignes valides et 12 lignes en erreur, une par type d'erreur, réparties dans le fichier. */
function fichierT8(): { lignes: Ligne[]; erreurs: Map<number, string> } {
  const valides: Ligne[] = Array.from({ length: 488 }, (_, i) => [numero(), personne(i), naissance(i), i % 2 ? "F" : "M", i % 3 ? "Salarié" : "Conjoint", i % 4 ? "SOLO" : "FAMILLE"]);
  const v = (i: number) => valides[i];
  // Chaque ligne en erreur part d'une ligne valide inédite (personne 1000 + k) et n'a QU'UNE erreur.
  const base = (k: number): Ligne => [numero(), personne(1000 + k), "15/06/1985", "F", "Salarié", "SOLO"];
  const fautives: [string, Ligne][] = [
    ["nom_prenoms", ((l) => ((l[1] = ""), l))(base(0))], // champ obligatoire vide
    ["date_naissance", ((l) => ((l[2] = "31/02/1985"), l))(base(1))], // date impossible
    ["date_naissance", ((l) => ((l[2] = "01/01/2031"), l))(base(2))], // date dans le futur
    ["sexe", ((l) => ((l[3] = "H"), l))(base(3))], // sexe invalide
    ["formule", ((l) => ((l[5] = "PLATINE"), l))(base(4))], // formule inconnue du produit
    ["formule", ((l) => ((l[5] = "SENIOR"), (l[2] = "15/06/1955"), l))(base(5))], // formule non retenue dans la police
    ["date_naissance", ((l) => ((l[2] = "15/06/2010"), l))(base(6))], // âge inférieur au minimum de SOLO (18)
    ["date_naissance", ((l) => ((l[2] = "15/06/1950"), l))(base(7))], // âge supérieur au maximum de SOLO (65)
    ["nom_prenoms", [numero(), v(10)[1].toLowerCase(), v(10)[2], "", "", "FAMILLE"]], // même personne qu'une ligne plus haut
    ["nom_prenoms", [numero(), "Existant Premier Inventé", "01/01/1980", "M", "Salarié", "SOLO"]], // déjà adhérent de la police
    ["numero_certificat", ((l) => ((l[0] = "CERT-0001"), l))(base(8))], // numéro hors format
    ["numero_certificat", ((l) => ((l[0] = v(20)[0]), l))(base(9))], // numéro déjà donné plus haut dans le fichier
  ];
  const lignes = [...valides];
  // Insertion à des positions réparties (après la ligne valide qu'elles dupliquent) ; numéro de ligne Excel = index + 2.
  fautives.forEach(([, l], k) => lignes.splice(30 + k * 38, 0, l));
  const numerosDeLigne = new Map<number, string>();
  lignes.forEach((l, i) => {
    const colonne = fautives.find(([, f]) => f === l)?.[0];
    if (colonne) numerosDeLigne.set(i + 2, colonne);
  });
  return { lignes, erreurs: numerosDeLigne };
}

async function xlsx(lignes: Ligne[]): Promise<Uint8Array> {
  const c = new ExcelJS.Workbook();
  const f = c.addWorksheet("Adhérents");
  f.addRow(["numero_certificat", "nom_prenoms", "date_naissance", "sexe", "lien", "formule"]);
  for (const l of lignes) f.addRow(l);
  return new Uint8Array(await c.xlsx.writeBuffer());
}

/** Nombre d'entrées d'une archive ZIP (signatures de l'annuaire central). */
const entreesZip = (zip: Uint8Array) => Buffer.from(zip).toString("latin1").split("PK\u0001\u0002").length - 1;

beforeAll(async () => {
  remplacerGenerateur(null);
  remplacerStockage(null);
  const sante = await fetch(new URL("/sante", obtenirConfig().GENERATEUR_URL)).catch(() => null);
  if (!sante?.ok) throw new Error(`Générateur injoignable sur ${obtenirConfig().GENERATEUR_URL} : lancez-le avant npm run test:e2e.`);
  if (!obtenirConfig().REDIS_URL) throw new Error("REDIS_URL absente : lancez Redis avant npm run test:e2e (file de tâches, D24).");
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

  const cg = await publier("CG", null, "cg_test.docx", { visa: VISA_CG, dateDocument: "2025-06-19" });
  const code = CODE("T8");
  const branche = await assurerBranche(`SANTE_${code}`);
  await creerTaxe(technique, { branche, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code, libelle: "RELAXSANTE import (T8)", gamme: "RELAX", branche }, null);
  const formule = (c: string, prime: string, ageMin: number | null, ageMax: number | null) => ({ code: c, libelle: c, tauxCouverture: "80", primeUnitaire: prime, accessoireMode: "AUCUN" as const, accessoireValeur: "0", ageMin, ageMax });
  await creerVersion(
    technique,
    code,
    {
      dateEffet: "2020-01-01",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
      prorata: { actif: true, primeMinimale: null },
      fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: "20000000",
      formules: [formule("SOLO", "236453.25", 18, 65), formule("FAMILLE", "307389.16", null, null), formule("SENIOR", "400000", 60, 80)],
      references: { cgModeleCode: cg, cgVisa: VISA_CG, csModeleCode: null, csVisa: null },
    },
    null,
  );
  await publier("CERTIFICAT", code, "certificat_test.docx");
  produitCode = code;

  await viderFile(FILE_IMPORTS);
  travailleur = await demarrerTravailleur({ journal: () => undefined });
}, 120_000);

afterAll(async () => {
  await travailleur?.fermer();
  await fermerFiles();
  await obtenirPrisma().$disconnect();
});

describe("T8 : import de 500 adhérents, 12 erreurs de types différents", () => {
  it(
    "488 certificats (QR, empreinte, stockage en ajout seul), rapport de 12 lignes, ZIP de 488 PDF, une version de la liste, moins de 15 minutes",
    async () => {
      const cotationId = await creerBrouillon(
        commercial,
        {
          codeProduit: produitCode,
          clientId: null,
          typeContrat: "GROUPE",
          souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE T8", telephone: "", email: "", adresse: "Plateau, rue inventée" },
          dateEffet: "2026-01-01",
          dateEcheance: "2026-12-31",
          nombreTranches: 1,
          lignes: [{ codeFormule: "SOLO", effectif: 1 }, { codeFormule: "FAMILLE", effectif: 1 }],
          motifForcage: null,
          assures: existants,
          beneficiaires: [],
          contactsUrgence: [],
          risque: {},
        },
        null,
      );
      await soumettre(commercial, cotationId, null);
      const { numeroPolice } = await accepter(commercial, cotationId, ["SOLO", "FAMILLE"], numero(), null);
      const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: numeroPolice } });
      const versionsAvant = await obtenirPrisma().adherentsVersion.count({ where: { policeId: police.id } });

      const { lignes, erreurs } = fichierT8();
      expect(lignes).toHaveLength(500);
      const lotId = await controlerImport(technique, police.id, "2026-07-01", { nom: "adherents_500.xlsx", contenu: await xlsx(lignes) }, null);
      const controle = (await lireLot(technique, lotId))!;
      expect(controle).toMatchObject({ statut: "CONTROLE", total: 500, valides: 488, erreurs: 12 });

      // Rapport : exactement 12 lignes, chacune avec UNE erreur, dans la colonne attendue.
      const classeur = new ExcelJS.Workbook();
      await classeur.xlsx.load(Buffer.from((await rapportErreurs(technique, lotId)).contenu) as unknown as ArrayBuffer);
      const rapport: [number, string, string][] = [];
      classeur.getWorksheet("Erreurs")!.eachRow((r, n) => {
        if (n > 1) rapport.push([Number(r.getCell(1).value), String(r.getCell(2).value), String(r.getCell(4).value)]);
      });
      expect(rapport).toHaveLength(12);
      expect(new Map(rapport.map(([l, c]) => [l, c]))).toEqual(erreurs);
      const type = (m: string) => m.replace(/\d+|«[^»]*»|\([^)]*\)/g, "");
      expect(new Set(rapport.map(([, , m]) => type(m))).size).toBe(12); // 12 messages de types différents

      // Confirmation, puis traitement par le travailleur ; durée mesurée de la confirmation à la fin du lot.
      const debut = Date.now();
      expect(await confirmerImport(technique, lotId, null)).toEqual({ enFile: true });
      let lot = (await lireLot(technique, lotId))!;
      while (lot.statut !== "TERMINE") {
        if (Date.now() - debut > QUINZE_MINUTES) throw new Error(`T8 : plus de 15 minutes (${lot.produits} certificats produits)`);
        await new Promise((r) => setTimeout(r, 1000));
        lot = (await lireLot(technique, lotId))!;
      }
      const duree = Date.now() - debut;
      console.log(
        `[T8] 488 certificats en ${(duree / 1000).toFixed(1)} s (traitement du lot : ${lot.dureeSecondes} s) ; ` +
          `${cpus().length} processeurs ; CONVERSIONS_SIMULTANEES=${obtenirConfig().CONVERSIONS_SIMULTANEES}`,
      );
      expect(duree).toBeLessThan(QUINZE_MINUTES);
      expect(lot).toMatchObject({ produits: 488, echecs: 0, restants: 0, enAttenteEcriture: 0 });

      // Une seule nouvelle version de la liste : 2 existants + 488.
      expect(await obtenirPrisma().adherentsVersion.count({ where: { policeId: police.id } })).toBe(versionsAvant + 1);
      expect((await obtenirPrisma().police.findUniqueOrThrow({ where: { id: police.id } })).assures).toHaveLength(490);

      // 488 certificats distincts, chacun avec son numéro, son jeton (QR) et son empreinte.
      const docs = await obtenirPrisma().documentEmis.findMany({ where: { policeId: police.id, type: "CERTIFICAT" } });
      expect(docs).toHaveLength(488);
      expect(new Set(docs.map((d) => d.numero)).size).toBe(488);
      expect(new Set(docs.map((d) => d.jeton)).size).toBe(488);
      expect(new Set(docs.map((d) => d.empreinte)).size).toBe(488);
      const exemple = docs.find((d) => d.adherentOrdre === 3)!;
      const texte = texteDuPdf(await stockage().lire(exemple.chemin));
      if (texte !== null) {
        expect(texte).toContain(`CERTIFICAT D'ADHÉSION n° ${exemple.numero}`);
        expect(texte).toContain(`Police mère n° ${numeroPolice}`);
        expect(texte).toContain(`Adhérent n° 3 : ${personne(0)}`);
        expect(texte).toMatch(/Vérification :\s+https:\/\/documents\.exemple\.ci\/verif\//);
      }

      // Archive ZIP : 488 PDF ; récapitulatif au journal.
      const zip = await zipDuLot(technique, lotId, null);
      expect(entreesZip(zip.contenu)).toBe(488);
      const [termine] = (await lireJournal({ action: "IMPORT_TERMINE" })).lignes.filter((l) => l.objet === `lot_import ${lotId}`);
      expect(termine.apres).toMatchObject({ total: 500, produits: 488, enErreur: 12, enEchec: 0 });
    },
    20 * 60 * 1000,
  );
});
