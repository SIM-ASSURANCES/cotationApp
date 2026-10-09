// Session 5a : import en masse des adhérents (CDC §13) et écriture différée quand le stockage est en panne (T14).
// Générateur SIMULÉ, stockage EN MÉMOIRE (qu'on peut mettre « en panne »), vraie base, vrai Redis et vrai travailleur
// BullMQ dans le processus du test. Données inventées.
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Analyse } from "@/domaine/documents/analyse";
import type { Assure } from "@/domaine/cotation/saisie";

import { lireAdherents } from "./adherents";
import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { accepter, creerBrouillon, soumettre, type SaisieCotation } from "./cotations";
import { emettreCertificat, telechargerDocument, zipDocuments } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { ErreurDejaStocke, remplacerGenerateur } from "./generateur";
import { abandonnerImport, confirmerImport, controlerImport, lireLot, modeleImport, rapportErreurs, lireFichierImport, traiterLot, zipDuLot } from "./imports";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature } from "./societe-test";
import { remplacerStockage } from "./stockage";
import { alerteStockage, relancerEcritures } from "./surveillance";
import { fermerFiles, FILE_IMPORTS, FILE_STOCKAGE, reglerReprise, viderFile } from "./taches";
import { demarrerTravailleur, type Travailleur } from "./travailleur";
import { ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sha256 = (o: Uint8Array) => createHash("sha256").update(o).digest("hex");
const texte = (t: string) => new TextEncoder().encode(t);
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend qu'une condition soit vraie (le travailleur tourne en tâche de fond). */
async function jusqua(condition: () => Promise<boolean>, delaiMs = 20_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error("condition non atteinte dans le délai");
    await attendre(100);
  }
}

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let produitCode: string;
let travailleur: Travailleur;

// Numéros : préfixe propre à ce lancement, pour ne jamais heurter un numéro d'un lancement précédent.
const SERIE = String(Date.now() % 1_000_000).padStart(6, "0");
let compteur = 0;
const numero = (lettre: "G" | "I" = "G") => `TST-2026-${SERIE}-${lettre}${String(++compteur).padStart(5, "0")}`;

// Stockage en mémoire, qu'un test peut mettre en panne (T14).
const fichiers = new Map<string, Uint8Array>();
let panne = false;
let generes = 0;

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
let prochaineAnalyse: Analyse;
const analyse = (chemins: string[]): Analyse => ({
  docx_valide: true,
  erreur: null,
  nombre_balises: chemins.length,
  references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
  problemes: [],
  champs_word: [],
  blocs: [],
  filtres: [],
  polices: [],
  polices_absentes: [],
  textes: [],
});
const CONTENU_CERTIFICAT = ["police.numero", "police.police_mere", "souscripteur.nom", "police.date_effet", "doc.date_emission"];
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };

async function publier(type: "CG" | "CERTIFICAT", code: string | null, chemins: string[], visa?: string) {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: `Modèle ${type}`, produitCode: code, ...sans }, null);
  prochaineAnalyse = analyse(chemins);
  await deposerVersion(technique, id, { fichier: texte(`docx ${type}`), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: visa ?? null, dateDocument: visa ? "2025-06-19" : null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

const existants: Assure[] = [1, 2].map((i) => ({ ordre: i, nom_prenoms: `Existant ${i} Inventé`, date_naissance: "1980-01-0" + i, sexe: "M", lien: "Salarié", formule: "SOLO" }) as Assure);

/** Police mère de groupe à deux adhérents, formules SOLO (18 à 65 ans) retenue, SENIOR non retenue. */
async function policeDeGroupe(): Promise<{ policeId: number; numero: string }> {
  const saisie: SaisieCotation = {
    codeProduit: produitCode,
    clientId: null,
    typeContrat: "GROUPE",
    souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE", telephone: "", email: "", adresse: "" },
    dateEffet: "2026-01-01",
    dateEcheance: "2026-12-31",
    nombreTranches: 1,
    lignes: [{ codeFormule: "SOLO", effectif: 2 }],
    motifForcage: null,
    assures: existants,
    beneficiaires: [],
    contactsUrgence: [],
    risque: {},
  };
  const cotationId = await creerBrouillon(commercial, saisie, null);
  await soumettre(commercial, cotationId, null);
  const { numeroPolice } = await accepter(commercial, cotationId, ["SOLO"], numero(), null);
  const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: numeroPolice } });
  return { policeId: police.id, numero: numeroPolice };
}

/** Classeur .xlsx avec les en-têtes du modèle. */
async function xlsx(lignes: (string | Date | null)[][]): Promise<Uint8Array> {
  const c = new ExcelJS.Workbook();
  const f = c.addWorksheet("Adhérents");
  f.addRow(["numero_certificat", "nom_prenoms", "date_naissance", "sexe", "lien", "formule"]);
  for (const l of lignes) f.addRow(l);
  return new Uint8Array(await c.xlsx.writeBuffer());
}

async function lireXlsx(contenu: Uint8Array): Promise<ExcelJS.Workbook> {
  const c = new ExcelJS.Workbook();
  await c.xlsx.load(Buffer.from(contenu) as unknown as ArrayBuffer);
  return c;
}

/** Lignes du journal d'audit pour une action et un objet (« lot_import 12 », « document 345 »). */
const journal = async (action: string, objetType: "lot_import" | "document", objetId: number) =>
  (await lireJournal({ action })).lignes.filter((l) => l.objet === `${objetType} ${objetId}`);
const certificats = (policeId: number) => obtenirPrisma().documentEmis.count({ where: { policeId, type: "CERTIFICAT" } });

beforeAll(async () => {
  remplacerGenerateur({
    analyser: async () => prochaineAnalyse,
    genererPdf: async () => texte(`%PDF-1.7 simulé ${++generes}`),
  });
  remplacerStockage({
    async ecrire(chemin, contenu) {
      if (panne) throw new Error("Générateur injoignable (stockage simulé en panne)");
      if (fichiers.has(chemin)) throw new ErreurDejaStocke("Stockage : déjà stocké.");
      fichiers.set(chemin, contenu);
      return { empreinte: sha256(contenu) };
    },
    async lire(chemin) {
      if (panne) throw new Error("Générateur injoignable (stockage simulé en panne)");
      const f = fichiers.get(chemin);
      if (!f) throw new ErreurMetier("Stockage : introuvable.");
      return f;
    },
    async zip(liste) {
      for (const f of liste) if (!fichiers.has(f.chemin)) throw new ErreurMetier(`Stockage : ${f.chemin} introuvable.`);
      return texte(`PK ${liste.map((f) => f.nom).join(",")}`);
    },
  });
  await initialiserProfilsEtDroits();
  const identifiantAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: identifiantAdmin, nom: "Admin", motDePasse: MDP });
  admin = await compte(identifiantAdmin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, dg, commercial] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL")];
  await assurerSignature(technique);

  const cg = await publier("CG", null, ["produit.cg_visa"], "MFB/DGTCP/DA/N° 01498");
  const code = CODE("IMP");
  const branche = `SANTE_${code}`;
  await assurerBranche(branche);
  await creerTaxe(technique, { branche, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code, libelle: "Santé groupe import (test)", gamme: "RELAX", branche }, null);
  const formule = (c: string, ageMin: number | null, ageMax: number | null) => ({ code: c, libelle: c, tauxCouverture: "80", primeUnitaire: "93581.33", accessoireMode: "FIXE" as const, accessoireValeur: "3000", ageMin, ageMax });
  const version: VersionSaisie = {
    dateEffet: "2020-01-01",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: true, primeMinimale: null },
    fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    seuilValidationTtc: "20000000",
    formules: [formule("SOLO", 18, 65), formule("SENIOR", 60, null)],
    references: { cgModeleCode: cg, cgVisa: "MFB/DGTCP/DA/N° 01498", csModeleCode: null, csVisa: null },
  };
  await creerVersion(technique, code, version, null);
  await publier("CERTIFICAT", code, CONTENU_CERTIFICAT);
  produitCode = code;

  reglerReprise({ delaiMs: 150 });
  await viderFile(FILE_IMPORTS);
  await viderFile(FILE_STOCKAGE);
  // Le travailleur reprend au démarrage les écritures différées laissées par d'autres tests : on part d'une table vide.
  await obtenirPrisma().ecritureDifferee.deleteMany();
  travailleur = await demarrerTravailleur({ journal: () => undefined });
});

afterAll(async () => {
  await travailleur?.fermer();
  await fermerFiles();
  remplacerGenerateur(null);
  remplacerStockage(null);
  await obtenirPrisma().$disconnect();
});

describe("fichier modèle et lecture du fichier", () => {
  it("le modèle .xlsx du produit est relu par l'analyseur d'import : colonnes reconnues, ligne d'exemple, feuille d'aide avec les âges", async () => {
    const m = await modeleImport(technique, produitCode);
    expect(m.nom).toBe(`modele_import_${produitCode}.xlsx`);
    const lignes = await lireFichierImport(m.nom, m.contenu);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ numero: 2, cellules: { nom_prenoms: "KOFFI Ama Inventée", formule: "SENIOR" } });
    const aide = (await lireXlsx(m.contenu)).getWorksheet("Aide")!;
    const textes: string[] = [];
    aide.eachRow((r) => textes.push(r.values!.toString()));
    expect(textes.join("\n")).toMatch(/SOLO,18 à 65 ans/);
  });

  it("CSV (point-virgule, BOM) lu comme un .xlsx ; colonnes manquantes refusées", async () => {
    const csv = texte("﻿numero_certificat;nom_prenoms;date_naissance;sexe;lien;formule\nTST-2026-000001-G00001;Awa Inventée;14/03/1988;F;Salarié;SOLO\n\n");
    expect(await lireFichierImport("a.csv", csv)).toEqual([
      { numero: 2, cellules: { numero_certificat: "TST-2026-000001-G00001", nom_prenoms: "Awa Inventée", date_naissance: "14/03/1988", sexe: "F", lien: "Salarié", formule: "SOLO" } },
    ]);
    await expect(lireFichierImport("a.csv", texte("nom_prenoms;formule\nA;SOLO"))).rejects.toThrow(/Colonnes absentes .*numero_certificat, date_naissance, sexe, lien/);
    await expect(lireFichierImport("a.ods", texte("x"))).rejects.toThrow(/Format non pris en charge/);
  });
});

describe("import en masse : contrôle, rapport, confirmation, traitement", () => {
  it("contrôle sans rien créer ; rapport .xlsx ; confirmation en UNE version de la liste ; un certificat par ligne valide ; ZIP et récapitulatif", async () => {
    const { policeId } = await policeDeGroupe();
    const n = [numero(), numero(), numero(), numero()];
    const contenu = await xlsx([
      [n[0], "Adhérent Un Inventé", "14/03/1988", "F", "Salarié", "SOLO"],
      [n[1], "Adhérent Deux Inventé", new Date(Date.UTC(1990, 0, 2)), "M", "Conjoint", "solo"],
      [n[2], "Adhérent Trois Inventé", "31/02/1990", "M", "Salarié", "SOLO"], // date impossible
      [n[3], "Existant 1 Inventé", "1980-01-01", "M", "Salarié", "SOLO"], // déjà adhérent
      [numero(), "Adhérent Cinq Inventé", "1990-05-05", "F", "", "SENIOR"], // formule non retenue
    ]);
    const versionsAvant = (await lireAdherents(technique, policeId))!.versions.length;
    const lotId = await controlerImport(technique, policeId, "2026-07-01", { nom: "adherents.xlsx", contenu }, null);

    // Rien n'est créé au contrôle.
    expect((await lireAdherents(technique, policeId))!.versions).toHaveLength(versionsAvant);
    expect(await certificats(policeId)).toBe(0);
    const controle = (await lireLot(technique, lotId))!;
    expect(controle).toMatchObject({ statut: "CONTROLE", total: 5, valides: 2, erreurs: 3 });
    expect(controle.lignesEnErreur.map((l) => l.numero)).toEqual([4, 5, 6]);
    expect(await journal("IMPORT_CONTROLE", "lot_import", lotId)).toHaveLength(1);

    // Rapport : ligne, colonne, valeur, message en français.
    const rapport = (await lireXlsx((await rapportErreurs(technique, lotId)).contenu)).getWorksheet("Erreurs")!;
    const lignes: unknown[][] = [];
    rapport.eachRow((r) => lignes.push((r.values as unknown[]).slice(1)));
    expect(lignes[0]).toEqual(["Ligne", "Colonne", "Valeur", "Message"]);
    expect(lignes.slice(1).map((l) => [l[0], l[1]])).toEqual([[4, "date_naissance"], [5, "nom_prenoms"], [6, "formule"]]);
    expect(String(lignes[1][3])).toMatch(/Date invalide/);

    // Confirmation : une seule nouvelle version, deux adhérents ajoutés (ordres 3 et 4).
    expect(await confirmerImport(technique, lotId, null)).toEqual({ enFile: true });
    const vue = (await lireAdherents(technique, policeId))!;
    expect(vue.versions).toHaveLength(versionsAvant + 1);
    expect(vue.versions.at(-1)).toMatchObject({ dateEffet: "2026-07-01", concernes: [3, 4] });
    expect(vue.courants.map((a) => a.nom_prenoms)).toEqual(["Existant 1 Inventé", "Existant 2 Inventé", "Adhérent Un Inventé", "Adhérent Deux Inventé"]);
    await expect(confirmerImport(technique, lotId, null)).rejects.toThrow(/déjà été confirmé/);

    // Le travailleur produit les certificats.
    await jusqua(async () => (await lireLot(technique, lotId))!.statut === "TERMINE");
    const fin = (await lireLot(technique, lotId))!;
    expect(fin).toMatchObject({ produits: 2, echecs: 0, restants: 0, versionAdherents: vue.versions.at(-1)!.numero, enAttenteEcriture: 0 });
    expect(fin.dureeSecondes).not.toBeNull();
    const docs = await obtenirPrisma().documentEmis.findMany({ where: { policeId, type: "CERTIFICAT" }, orderBy: { adherentOrdre: "asc" } });
    expect(docs.map((d) => [d.adherentOrdre, d.numero])).toEqual([[3, n[0]], [4, n[1]]]);
    const zip = await zipDuLot(technique, lotId, null);
    expect(new TextDecoder().decode(zip.contenu)).toBe(`PK ${n[0]}_CERTIFICAT_v1.pdf,${n[1]}_CERTIFICAT_v1.pdf`);
    const [termine] = await journal("IMPORT_TERMINE", "lot_import", lotId);
    expect(termine.apres).toMatchObject({ total: 5, produits: 2, enErreur: 3, enEchec: 0 });
  });

  it("le traitement est rejouable : relancé, ou interrompu après une émission, il ne crée aucun certificat en double", async () => {
    const { policeId } = await policeDeGroupe();
    const contenu = await xlsx([1, 2, 3].map((i) => [numero(), `Rejoué ${i} Inventé`, "1991-01-01", "F", "Salarié", "SOLO"]));
    const lotId = await controlerImport(technique, policeId, "2026-07-01", { nom: "r.xlsx", contenu }, null);
    await confirmerImport(technique, lotId, null);
    await jusqua(async () => (await lireLot(technique, lotId))!.statut === "TERMINE");
    expect(await certificats(policeId)).toBe(3);

    // Interruption simulée : une ligne a perdu son lien vers le certificat déjà émis ; la tâche est rejouée.
    const ligne = await obtenirPrisma().ligneImport.findFirstOrThrow({ where: { lotId }, orderBy: { numeroLigne: "asc" } });
    await obtenirPrisma().ligneImport.update({ where: { id: ligne.id }, data: { statut: "VALIDE", documentId: null } });
    await obtenirPrisma().lotImport.update({ where: { id: lotId }, data: { statut: "EN_COURS" } });
    await traiterLot(lotId);
    await traiterLot(lotId); // une deuxième fois : lot terminé, rien à faire
    expect(await certificats(policeId)).toBe(3);
    const lot = (await lireLot(technique, lotId))!;
    expect(lot).toMatchObject({ statut: "TERMINE", produits: 3 });
    expect(await obtenirPrisma().ligneImport.findUniqueOrThrow({ where: { id: ligne.id } })).toMatchObject({ statut: "PRODUIT", documentId: expect.any(Number) });
  });

  it("confirmation refusée si la liste a changé depuis le contrôle ; abandon possible, puis plus de confirmation", async () => {
    const { policeId } = await policeDeGroupe();
    const nom = "Concurrent Inventé";
    const deux = async () => xlsx([[numero(), nom, "1992-02-02", "M", "Salarié", "SOLO"]]);
    const premier = await controlerImport(technique, policeId, "2026-07-01", { nom: "a.xlsx", contenu: await deux() }, null);
    const second = await controlerImport(technique, policeId, "2026-07-01", { nom: "b.xlsx", contenu: await deux() }, null);
    await confirmerImport(technique, premier, null);
    await expect(confirmerImport(technique, second, null)).rejects.toThrow(/La police a changé depuis le contrôle/);
    expect((await lireLot(technique, second))!.statut).toBe("CONTROLE");
    await abandonnerImport(technique, second, null);
    expect((await lireLot(technique, second))!.statut).toBe("ABANDONNE");
    await expect(confirmerImport(technique, second, null)).rejects.toThrow(/déjà été confirmé ou abandonné/);
    await expect(abandonnerImport(technique, second, null)).rejects.toThrow(/Seul un import en attente/);
    await jusqua(async () => (await lireLot(technique, premier))!.statut === "TERMINE");
  });

  it("date d'effet hors de la période de la police, ou fichier sans aucune ligne : refusés avant tout contrôle", async () => {
    const { policeId } = await policeDeGroupe();
    await expect(controlerImport(technique, policeId, "2027-02-01", { nom: "a.xlsx", contenu: await xlsx([]) }, null)).rejects.toThrow(/période de la police/);
    await expect(controlerImport(technique, policeId, "2026-07-01", { nom: "a.xlsx", contenu: await xlsx([]) }, null)).rejects.toThrow(/aucune ligne/);
  });
});

describe("T14 : stockage indisponible, le document reste émis et l'écriture est reprise", () => {
  it("panne : certificat émis « en attente d'écriture », alerte admin, téléchargement depuis la base ; retour du stockage : écriture reprise par la file", async () => {
    const { policeId } = await policeDeGroupe();
    panne = true;
    const doc = await emettreCertificat(technique, policeId, 1, numero(), null);
    try {
      // Le document est émis et inscrit ; son PDF attend en base.
      const emis = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
      expect(fichiers.has(emis.chemin)).toBe(false);
      const attente = await obtenirPrisma().ecritureDifferee.findUniqueOrThrow({ where: { documentId: doc.id } });
      expect(attente.empreinte).toBe(emis.empreinte);
      expect(attente.derniereErreur).toMatch(/injoignable/);
      expect(await journal("ECRITURE_PARTAGE_ECHEC", "document", doc.id)).toHaveLength(1);

      // Alerte : pour l'administrateur seulement.
      expect(await alerteStockage(admin)).toMatchObject({ enAttente: 1 });
      expect(await alerteStockage(technique)).toBeNull();

      // Toujours téléchargeable (depuis la base), empreinte vérifiée ; pas dans une archive ZIP.
      const t = await telechargerDocument(technique, doc.id, null);
      expect(sha256(t.contenu)).toBe(emis.empreinte);
      await expect(zipDocuments(technique, [doc.id], null)).rejects.toThrow(/attente/);

      // La file retente avec des délais croissants : les essais échouent tant que la panne dure.
      await jusqua(async () => (await obtenirPrisma().ecritureDifferee.findUniqueOrThrow({ where: { documentId: doc.id } })).tentatives >= 2);
    } finally {
      panne = false;
    }

    // Retour du stockage : la reprise suivante écrit le fichier, la ligne disparaît, l'alerte aussi.
    await relancerEcritures(admin, null);
    await jusqua(async () => (await obtenirPrisma().ecritureDifferee.count({ where: { documentId: doc.id } })) === 0);
    const emis = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    expect(sha256(fichiers.get(emis.chemin)!)).toBe(emis.empreinte);
    const [reprise] = await journal("ECRITURE_REPRISE", "document", doc.id);
    expect(reprise.apres).toMatchObject({ issue: "ECRITE", chemin: emis.chemin });
    expect((await lireJournal({ action: "ECRITURE_RELANCEE" })).lignes.filter((l) => l.utilisateur === admin.identifiant)).toHaveLength(1);
    expect(await alerteStockage(admin)).toBeNull();
    expect((await zipDocuments(technique, [doc.id], null)).contenu.byteLength).toBeGreaterThan(0);
  });

  it("import pendant la panne : les certificats sont émis, hors de l'archive, puis écrits au retour du stockage", async () => {
    const { policeId } = await policeDeGroupe();
    const n = [numero(), numero()];
    const lotId = await controlerImport(technique, policeId, "2026-07-01", { nom: "p.xlsx", contenu: await xlsx(n.map((x, i) => [x, `Panne ${i} Inventé`, "1985-06-06", "M", "Salarié", "SOLO"])) }, null);
    panne = true;
    try {
      await confirmerImport(technique, lotId, null);
      await jusqua(async () => (await lireLot(technique, lotId))!.statut === "TERMINE");
      expect((await lireLot(technique, lotId))!).toMatchObject({ produits: 2, echecs: 0, enAttenteEcriture: 2, zip: null });
    } finally {
      panne = false;
    }
    await jusqua(async () => (await lireLot(technique, lotId))!.enAttenteEcriture === 0);
    expect(await certificats(policeId)).toBe(2);
  });

  it("une reprise qui trouve déjà le fichier (réponse perdue) l'accepte si l'empreinte est la même", async () => {
    const { policeId } = await policeDeGroupe();
    panne = true;
    const doc = await emettreCertificat(technique, policeId, 2, numero(), null);
    const attente = await obtenirPrisma().ecritureDifferee.findUniqueOrThrow({ where: { documentId: doc.id } });
    fichiers.set(attente.chemin, new Uint8Array(attente.contenu)); // écrit en réalité, mais la réponse s'est perdue
    panne = false;
    await jusqua(async () => (await obtenirPrisma().ecritureDifferee.count({ where: { documentId: doc.id } })) === 0);
    const [reprise] = await journal("ECRITURE_REPRISE", "document", doc.id);
    expect(reprise.apres).toMatchObject({ issue: "DEJA_ECRITE" });
  });
});
