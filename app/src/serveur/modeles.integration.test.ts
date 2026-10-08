// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration), générateur SIMULÉ.
// Le vrai générateur est utilisé par modeles.e2e.test.ts (npm run test:e2e).
import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Analyse } from "@/domaine/documents/analyse";

import { assurerBranche } from "./branches-test";
import { lireJournal } from "./audit";
import { initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
import {
  apercuVersion,
  creerModele,
  deposerVersion,
  enregistrerSeuilListe,
  ErreurDepot,
  fichierVersion,
  lireModele,
  lireSeuilListe,
  pdfPublie,
  publierVersion,
  renvoyerVersion,
  soumettreVersion,
  type DepotVersion,
} from "./modeles";
import { aujourdhui, creerProduit } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const DEMAIN = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const DANS_UN_MOIS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let technique2: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let produit: string;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

// ---------------------------------------------------------------- Générateur simulé

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
function analyse(chemins: string[], surcharge: Partial<Analyse> = {}): Analyse {
  return {
    docx_valide: true,
    erreur: null,
    nombre_balises: chemins.length,
    references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
    problemes: [],
    champs_word: [],
    blocs: [],
    filtres: [],
    polices: ["Tahoma"],
    polices_absentes: [],
    textes: [],
    ...surcharge,
  };
}

/** Contenu obligatoire d'un modèle de CP (CDC §10.1, session 4a). */
const SOCLE_CP = [
  "police.numero",
  "souscripteur.nom",
  "police.date_effet",
  "police.date_echeance",
  "prime.ttc",
  "police.duree_libelle",
  "prime.nette",
  "prime.accessoires",
  "prime.taxe",
  "produit.cg_libelle",
  "produit.cg_visa",
  "societe.email_reclamation",
  "doc.lieu_emission",
  "doc.date_emission",
  "signature_sim",
];
let prochaineAnalyse: Analyse = analyse(SOCLE_CP);
const demandesPdf: DemandePdf[] = [];

beforeEach(() => {
  prochaineAnalyse = analyse(SOCLE_CP);
  demandesPdf.length = 0;
});

const fichier = (texte: string) => new TextEncoder().encode(`docx de test inventé : ${texte}`);
const depot = (texte = unique("v"), surcharge: Partial<DepotVersion> = {}): DepotVersion => ({
  fichier: fichier(texte),
  nomFichier: "modele.docx",
  commentaire: "Version de test",
  dateEffet: aujourdhui(),
  visa: null,
  dateDocument: null,
  ...surcharge,
});

async function cp(): Promise<number> {
  return creerModele(technique, { type: "CP", code: CODE("CP"), libelle: "CP de test", produitCode: produit, niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null }, null);
}
async function versionId(modeleId: number, numero: number): Promise<number> {
  return (await obtenirPrisma().modeleVersion.findUniqueOrThrow({ where: { modeleId_numero: { modeleId, numero } } })).id;
}

beforeAll(async () => {
  remplacerGenerateur({
    analyser: async () => prochaineAnalyse,
    genererPdf: async (demande) => {
      demandesPdf.push(demande);
      return new TextEncoder().encode("%PDF-1.7 simulé");
    },
  });
  await initialiserProfilsEtDroits();
  const id = unique("admin");
  await creerAdministrateurInitial({ identifiant: id, nom: "Admin", motDePasse: MDP });
  admin = await compte(id);
  [technique, technique2, dg, commercial] = [await nouveauCompte("TECHNIQUE"), await nouveauCompte("TECHNIQUE"), await nouveauCompte("DIRECTION_GENERALE"), await nouveauCompte("COMMERCIAL")];
  produit = CODE("PRD");
  await assurerBranche("SANTE");
  await creerProduit(technique, { code: produit, libelle: "Produit de test", gamme: "RELAX", branche: "SANTE" }, null);
});

afterAll(async () => {
  remplacerGenerateur(null);
  await obtenirPrisma().$disconnect();
});

// ---------------------------------------------------------------- Droits et création

describe("bibliothèque de modèles : droits (CDC §4)", () => {
  it("la Technique crée ; le Commercial et la DG ne créent pas", async () => {
    expect(await cp()).toBeGreaterThan(0);
    const saisie = { type: "CP" as const, code: CODE("CP"), libelle: "CP", produitCode: produit, niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
    await expect(creerModele(commercial, saisie, null)).rejects.toThrow(ErreurAcces);
    await expect(creerModele(dg, saisie, null)).rejects.toThrow(ErreurAcces);
    await expect(lireModele(commercial, 1)).rejects.toThrow(ErreurAcces);
  });

  it("un seul modèle d'annexe par liste et par produit", async () => {
    const annexe = { type: "ANNEXE" as const, libelle: "Annexe assurés", produitCode: produit, niveauRelance: null, listeAnnexe: "assures" as const, blocNom: null, blocCle: null };
    await creerModele(technique, { ...annexe, code: CODE("ANX") }, null);
    await expect(creerModele(technique, { ...annexe, code: CODE("ANX") }, null)).rejects.toThrow(/joue déjà ce rôle/);
  });
});

// ---------------------------------------------------------------- Dépôt (CDC §6.7)

describe("dépôt d'une version", () => {
  it("T9 : balise inconnue → refus détaillé, rien d'enregistré, refus journalisé", async () => {
    const id = await cp();
    prochaineAnalyse = analyse([...SOCLE_CP, "client.nom"], { references: [...analyse(SOCLE_CP).references, { chemin: "client.nom", balise: "{{ client.nom }}", emplacement: { ...ici, tableau: 1, ligne: 2, colonne: 1, extrait: "{{ client.nom }}" } }] });
    const refus = await deposerVersion(technique, id, depot(), null).catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(ErreurDepot);
    expect((refus as ErreurDepot).details).toEqual([
      "Balise inconnue « client.nom » dans {{ client.nom }} : ce nom n'est pas dans le dictionnaire des champs. — corps, tableau 1, ligne 2, colonne 1 : « {{ client.nom }} »",
    ]);
    expect(await obtenirPrisma().modeleVersion.count({ where: { modeleId: id } })).toBe(0);
    const journal = await lireJournal({ action: "MODELE_DEPOT_REFUSE" });
    expect(journal.lignes[0].objet).toBe(`modele ${id}`);
  });

  it("dépôt accepté : brouillon n° 1, empreinte SHA-256, avertissements conservés", async () => {
    const id = await cp();
    prochaineAnalyse = analyse(SOCLE_CP, { polices_absentes: ["Bodoni MT"] });
    const d = depot("contenu-1");
    const r = await deposerVersion(technique, id, d, null);
    expect(r.numero).toBe(1);
    expect(r.avertissements[0].message).toContain("Bodoni MT");
    const modele = (await lireModele(technique, id))!;
    expect(modele.versions[0]).toMatchObject({ numero: 1, statut: "BROUILLON", empreinte: createHash("sha256").update(d.fichier).digest("hex"), champsUtilises: [...SOCLE_CP].sort() });
    expect((await fichierVersion(dg, modele.versions[0].id, null)).contenu).toEqual(d.fichier);
    await deposerVersion(technique, id, depot("contenu-2"), null);
    expect((await lireModele(technique, id))!.versions.map((v) => v.numero)).toEqual([2, 1]);
  });

  it("CG : visa obligatoire", async () => {
    const id = await creerModele(technique, { type: "CG", code: CODE("CG"), libelle: "SECUR DOMMAGE (test)", produitCode: null, niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null }, null);
    prochaineAnalyse = analyse([]);
    await expect(deposerVersion(technique, id, depot(), null)).rejects.toThrow(/visa obligatoire/);
  });
});

// ---------------------------------------------------------------- Cycle de vie (CDC §6.6)

describe("soumission et publication", () => {
  it("seul l'auteur soumet ; la DG publie ; l'auteur ne publie pas", async () => {
    const id = await cp();
    await deposerVersion(technique, id, depot(), null);
    const v = await versionId(id, 1);
    await expect(soumettreVersion(technique2, v, null)).rejects.toThrow(/Seul l'auteur/);
    await soumettreVersion(technique, v, null);
    await expect(publierVersion(technique, v, aujourdhui(), null)).rejects.toThrow(ErreurAcces); // la Technique n'a pas « Publier »
    await expect(publierVersion(dg, v, "2020-01-01", null)).rejects.toThrow(/jamais rétroactive/);
    await publierVersion(dg, v, aujourdhui(), null);
    const lu = (await lireModele(technique, id))!;
    expect(lu.versions[0]).toMatchObject({ statut: "EN_VIGUEUR", valideur: dg.identifiant });
    expect(lu.enVigueur?.numero).toBe(1);
  });

  it("renvoi en brouillon par le valideur, avec motif", async () => {
    const id = await cp();
    await deposerVersion(technique, id, depot(), null);
    const v = await versionId(id, 1);
    await soumettreVersion(technique, v, null);
    await expect(renvoyerVersion(dg, v, "", null)).rejects.toThrow(/Motif/);
    await renvoyerVersion(dg, v, "Corriger l'adresse du siège", null);
    expect((await lireModele(technique, id))!.versions[0]).toMatchObject({ statut: "BROUILLON", motifRenvoi: "Corriger l'adresse du siège" });
  });

  it("nouvelle version publiée à une date future : l'ancienne reste en vigueur jusque-là", async () => {
    const id = await cp();
    await deposerVersion(technique, id, depot(), null);
    await soumettreVersion(technique, await versionId(id, 1), null);
    await publierVersion(dg, await versionId(id, 1), aujourdhui(), null);
    await deposerVersion(technique, id, depot(), null);
    await soumettreVersion(technique, await versionId(id, 2), null);
    await publierVersion(dg, await versionId(id, 2), DANS_UN_MOIS, null);
    const lu = (await lireModele(technique, id))!;
    expect(lu.versions.map((v) => v.statut)).toEqual(["PROGRAMMEE", "EN_VIGUEUR"]);
  });

  it("CG : PDF produit UNE fois à la publication, avec le visa, puis jamais reconverti", async () => {
    const id = await creerModele(technique, { type: "CG", code: CODE("CG"), libelle: "SECUR DOMMAGE (test)", produitCode: null, niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null }, null);
    prochaineAnalyse = analyse(["produit.cg_visa"]);
    await deposerVersion(technique, id, depot("cg", { visa: "MFB/DGTCP/DA/N° 01498", dateDocument: "2025-06-19" }), null);
    const v = await versionId(id, 1);
    await soumettreVersion(technique, v, null);
    await publierVersion(dg, v, DEMAIN, null);
    expect(demandesPdf).toHaveLength(1);
    expect(demandesPdf[0].donnees).toEqual({ produit: { cg_libelle: "SECUR DOMMAGE (test)", cg_visa: "MFB/DGTCP/DA/N° 01498", cg_date: "2025-06-19" } });
    const pdf = await pdfPublie(technique, v, null);
    expect(new TextDecoder().decode(pdf.contenu)).toBe("%PDF-1.7 simulé");
    await apercuVersion(technique, v, { nombreAssures: 0 }, null);
    expect(demandesPdf).toHaveLength(1); // l'aperçu reprend le PDF publié
  });
});

// ---------------------------------------------------------------- Base : versions figées

describe("déclencheurs : une version n'est jamais écrasée", () => {
  it("version publiée : ni modification, ni suppression ; publication par l'auteur refusée par la base", async () => {
    const prisma = obtenirPrisma();
    const id = await cp();
    await deposerVersion(technique, id, depot(), null);
    const v = await versionId(id, 1);
    await expect(prisma.$executeRawUnsafe(`UPDATE modele_versions SET fichier = '\\x00' WHERE id = ${v}`)).rejects.toThrow(/ne se modifient pas/);
    await expect(prisma.$executeRawUnsafe(`UPDATE modele_versions SET statut = 'PUBLIE' WHERE id = ${v}`)).rejects.toThrow(/passage de BROUILLON à PUBLIE interdit/);
    await soumettreVersion(technique, v, null);
    await expect(prisma.$executeRawUnsafe(`UPDATE modele_versions SET statut = 'PUBLIE', valideur_id = auteur_id, publie_le = now() WHERE id = ${v}`)).rejects.toThrow(/autre utilisateur que son auteur/);
    await publierVersion(dg, v, aujourdhui(), null);
    await expect(prisma.$executeRawUnsafe(`UPDATE modele_versions SET commentaire = 'x' WHERE id = ${v}`)).rejects.toThrow(/aucune modification possible/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM modele_versions WHERE id = ${v}`)).rejects.toThrow(/suppression interdite/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM modeles WHERE id = ${id}`)).rejects.toThrow(/suppression interdite/);
  });
});

// ---------------------------------------------------------------- Aperçu et listes longues

describe("aperçu et listes longues (CDC §6.5, §6.6)", () => {
  it("aperçu : données fictives, nombre d'assurés choisi, annexe et sous-modèles en vigueur, seuil", async () => {
    const id = await cp();
    await deposerVersion(technique, id, depot(), null);
    const anx = await creerModele(technique, { type: "ANNEXE", code: CODE("ANX"), libelle: "Annexe bénéficiaires", produitCode: null, niveauRelance: null, listeAnnexe: "beneficiaires", blocNom: null, blocCle: null }, null);
    await deposerVersion(technique, anx, depot("annexe"), null);
    const sm = await creerModele(technique, { type: "SOUS_MODELE", code: CODE("GAR"), libelle: "Garanties Solo", produitCode: produit, niveauRelance: null, listeAnnexe: null, blocNom: "garanties", blocCle: "SOLO" }, null);
    prochaineAnalyse = analyse([], { nombre_balises: 0 });
    await deposerVersion(technique, sm, depot("garanties"), null);

    const pdf = await apercuVersion(technique, await versionId(id, 1), { nombreAssures: 25 }, null);
    expect(pdf.nom).toMatch(/^apercu_CP_.*_v1\.pdf$/);
    const demande = demandesPdf[0];
    expect((demande.donnees.assures as unknown[]).length).toBe(25);
    expect(demande.donnees.produit).toMatchObject({ code: produit });
    expect(demande.seuilListe).toBe(await lireSeuilListe());
    expect(new TextDecoder().decode(demande.annexes?.beneficiaires)).toContain("annexe");
    expect(new TextDecoder().decode(demande.sousModeles?.garanties?.SOLO)).toContain("garanties");
    expect(Object.keys(demande.images ?? {}).sort()).toEqual(["cachet_sim", "qr_code", "signature_sim"]);
  });

  it("seuil des listes longues : 10 par défaut, historisé, jamais rétroactif", async () => {
    expect(await lireSeuilListe("2000-01-01")).toBe(10);
    await expect(enregistrerSeuilListe(commercial, 15, DEMAIN, null)).rejects.toThrow(ErreurAcces);
    await expect(enregistrerSeuilListe(technique, 15, "2020-01-01", null)).rejects.toThrow(/passée/);
    await expect(enregistrerSeuilListe(technique, 0, DEMAIN, null)).rejects.toThrow(ErreurMetier);
    await enregistrerSeuilListe(technique, 15, DEMAIN, null);
    expect(await lireSeuilListe(DEMAIN)).toBe(15);
    expect(await lireSeuilListe(aujourdhui())).not.toBe(15);
  });
});
