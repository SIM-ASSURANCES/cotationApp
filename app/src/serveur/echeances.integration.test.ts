// Session 5b : avis d'échéance et relances (CDC §12), liste du jour, lots, tableaux de bord. Mise en place reprise de
// factures.integration.test.ts (polices T2 et T3, modèles). Générateur SIMULÉ, stockage EN MÉMOIRE, vraie base et vrai
// Redis (lots par la file de tâches, traités ici directement). Toutes les données sont inventées.
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Analyse } from "@/domaine/documents/analyse";
import type { Assure } from "@/domaine/cotation/saisie";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { accepter, creerBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { emettreCp } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import {
  consulterParametresRelance,
  creerLotEcheances,
  enregistrerParametresRelance,
  etablirListeDuJour,
  genererAppel,
  lireLotEcheances,
  listeDuJour,
  traiterLotEcheances,
  type ElementListe,
} from "./echeances";
import { creerFactureAffaireNouvelle, creerFactureRenouvellement, emettreAvoir, emettreFacture, enregistrerPaiement, imputerAvance, lireFacture } from "./factures";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { ajouterJours, fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import { montant } from "@/domaine/calcul/montant";
import { obtenirPrisma } from "./prisma";
import { assurerSignature } from "./societe-test";
import { remplacerStockage } from "./stockage";
import { tableauCommercial } from "./tableau-commercial";
import { tableauCommercialMemorise, tableauDeBordMemorise, viderMemoireTableaux } from "./tableaux-memorises";
import { tableauDeBord } from "./tableaux-de-bord";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sha256 = (o: Uint8Array) => createHash("sha256").update(o).digest("hex");
const texte = (t: string) => new TextEncoder().encode(t);

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let comptable: UtilisateurCourant;
let admin: UtilisateurCourant;
let produitGroupe: string;
let produitIndividuel: string;
let compteurPolice = 0;
const numeroPolice = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(++compteurPolice).padStart(5, "0")}`;

const demandes: DemandePdf[] = [];
const fichiers = new Map<string, Uint8Array>();
let prochaineAnalyse: Analyse;

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const analyse = (chemins: string[], options: { filtres?: string[]; textes?: string[] } = {}): Analyse => ({
  docx_valide: true,
  erreur: null,
  nombre_balises: chemins.length,
  references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
  problemes: [],
  champs_word: [],
  blocs: [],
  filtres: options.filtres ?? [],
  polices: [],
  polices_absentes: [],
  textes: (options.textes ?? []).map((t) => ({ texte: t, emplacement: ici })),
});
const CONTENU_CP = [
  "police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "police.duree_libelle", "prime.nette", "prime.accessoires", "prime.taxe",
  "produit.cg_libelle", "produit.cg_visa", "societe.email_reclamation", "doc.lieu_emission", "doc.date_emission", "signature_sim",
];
const CONTENU_FACTURE = [
  "doc.numero", "doc.date_emission", "police.numero", "police.date_effet", "police.date_echeance", "souscripteur.raison_sociale", "souscripteur.adresse",
  "prime.taux_taxe", "prime.taxe", "prime.ttc", "societe.rccm", "societe.ncc", "societe.rib[].numero", "societe.mobile_money[].numero_marchand", "signature_sim", "qr_code",
  "echeances[].statut", "solde.restant_du", "envoye_a.nom",
];
const CONTENU_AVOIR = ["doc.numero", "doc.date_emission", "doc.facture_origine", "police.numero", "souscripteur.nom", "prime.ttc", "qr_code"];
const CONTENU_RECU = ["police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "paiements[].montant", "doc.facture_origine"];

const CONTENU_AVIS = ["doc.numero", "police.numero", "souscripteur.nom", "doc.facture_origine", "echeance_appelee.numero", "echeance_appelee.date", "echeance_appelee.restant_du", "qr_code"];
const CONTENU_RELANCE = [...CONTENU_AVIS, "relance.niveau", "relance.libelle", "relance.jours_retard"];

const sans = { listeAnnexe: null, blocNom: null, blocCle: null };
async function publier(type: "CP" | "CG" | "FACTURE" | "AVOIR" | "RECU" | "AVIS_ECHEANCE" | "RELANCE", code: string | null, a: Analyse, options: { visa?: string; niveau?: number } = {}) {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: type === "CG" ? "CG santé (test)" : `Modèle ${type}`, produitCode: code, ...sans, niveauRelance: options.niveau ?? null }, null);
  prochaineAnalyse = a;
  await deposerVersion(technique, id, { fichier: texte(`docx ${type}`), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: options.visa ?? null, dateDocument: options.visa ? "2025-06-19" : null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  // Les dates du test sont celles du contrat T2 (2026, donc passées) : l'avis et la relance prennent le modèle en
  // vigueur à la date simulée. La publication ne s'antidate pas (règle du produit) et une version publiée est figée par
  // un déclencheur : la base de TEST recule la date d'effet, déclencheurs suspendus pour cette seule transaction.
  if (type === "AVIS_ECHEANCE" || type === "RELANCE") await antidater(v.id, "2026-01-01");
  return { code: (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code, versionId: v.id };
}

async function antidater(versionId: number, dateEffet: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("UPDATE modele_versions SET date_effet = $1 WHERE id = $2", [dateEffet, versionId]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

const assure = (i: number, formule: string): Assure => ({ ordre: i, nom_prenoms: `Assuré ${i} Inventé`, date_naissance: "1990-01-01", sexe: i % 2 ? "F" : "M", lien: "Salarié", formule });

/** Police acceptée et CP émises : la facture d'affaire nouvelle peut suivre. */
async function police(saisie: Omit<SaisieCotation, "clientId" | "motifForcage" | "beneficiaires" | "contactsUrgence" | "risque">, codes: string[]): Promise<{ cotationId: number; policeId: number; numero: string }> {
  const cotationId = await creerBrouillon(commercial, { ...saisie, clientId: null, motifForcage: null, beneficiaires: [], contactsUrgence: [], risque: {} }, null);
  // Au-dessus du seuil du produit, la cotation passe d'abord par la validation de la Technique (CDC §4.1).
  if ((await soumettre(commercial, cotationId, null)).statut === "A_VALIDER") await valider(technique, cotationId, null);
  const { numeroPolice: numero } = await accepter(commercial, cotationId, codes, numeroPolice(), null);
  await emettreCp(technique, cotationId, null);
  const p = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
  return { cotationId, policeId: p.id, numero };
}

/** T2 : CGE-SN (nom de société inventé dans le CDC), RELAXSANTE 80 %, Solo 8, Famille 31, 4 échéances. */
const policeT2 = () =>
  police(
    {
      codeProduit: produitGroupe,
      typeContrat: "GROUPE",
      souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "CGE-SN (société inventée)", telephone: "", email: "", adresse: "Plateau, rue inventée, Abidjan" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      nombreTranches: 4,
      lignes: [
        { codeFormule: "SOLO", effectif: 8 },
        { codeFormule: "FAMILLE", effectif: 31 },
      ],
      assures: [...Array.from({ length: 8 }, (_, i) => assure(i + 1, "SOLO")), ...Array.from({ length: 31 }, (_, i) => assure(i + 9, "FAMILLE"))],
    },
    ["SOLO", "FAMILLE"],
  );

/** T3 : facture individuelle YAO (nom inventé du CDC), effet 22/07/2026, échéance 31/12/2026. */
const policeT3 = (dateEffet = "2026-07-22") =>
  police(
    {
      codeProduit: produitIndividuel,
      typeContrat: "INDIVIDUEL",
      souscripteur: { type: "PHYSIQUE", nom: "YAO", prenoms: "Koffi (inventé)", raison_sociale: "", telephone: "0700000000", email: "", adresse: "Cocody, rue inventée" },
      dateEffet,
      dateEcheance: "2026-12-31",
      nombreTranches: 1,
      lignes: [{ codeFormule: "F", effectif: 1 }],
      assures: [],
    },
    ["F"],
  );

const derniere = (type: string) => [...demandes].reverse().find((d) => (d.donnees.doc as { type: string }).type === type)!;
const doc = (d: DemandePdf) => d.donnees.doc as Record<string, string>;
const paiement = (montant: string, canal = "VIREMENT") => ({ date: aujourdhui(), montant, canal, reference: canal === "ESPECES" ? "" : "VIR-INVENTE-001", payeur: "" });

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
  remplacerGenerateur({
    analyser: async () => prochaineAnalyse,
    genererPdf: async (demande) => {
      demandes.push(demande);
      return texte(`%PDF-1.7 simulé ${demandes.length}`);
    },
  });
  remplacerStockage({
    async ecrire(chemin, contenu) {
      if (fichiers.has(chemin)) throw new ErreurMetier("Stockage : déjà stocké.");
      fichiers.set(chemin, contenu);
      return { empreinte: sha256(contenu) };
    },
    async lire(chemin) {
      const f = fichiers.get(chemin);
      if (!f) throw new ErreurMetier("Stockage : introuvable.");
      return f;
    },
    async zip(liste) {
      return texte(`PK ${liste.map((f) => f.nom).join(",")}`);
    },
  });
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  admin = await compte(idAdmin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: `${profil} inventé`, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  technique = await nouveau("TECHNIQUE");
  dg = await nouveau("DIRECTION_GENERALE");
  commercial = await nouveau("COMMERCIAL");
  comptable = await nouveau("COMPTABILITE");
  await assurerSignature(technique);

  const cg = await publier("CG", null, analyse(["produit.cg_visa"]), { visa: "VISA-INVENTE-01" });
  const references = { cgModeleCode: cg.code, cgVisa: "VISA-INVENTE-01", csModeleCode: null, csVisa: null };
  const base = {
    dateEffet: "2020-01-01",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: true, primeMinimale: null },
    fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    references,
  } as const;

  // Produit de groupe (T2) : tarif reconstitué pour retrouver les montants du CDC (H58).
  produitGroupe = CODE("RLX");
  const brancheG = await assurerBranche(`SANTE_${produitGroupe}`);
  await creerTaxe(technique, { branche: brancheG, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code: produitGroupe, libelle: "RELAXSANTE 80 % (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheG }, null);
  const versionG: VersionSaisie = {
    ...base,
    arrondi: { ...base.arrondi },
    prorata: { ...base.prorata },
    fractionnement: { ...base.fractionnement },
    cotation: { ...base.cotation },
    seuilValidationTtc: "20000000",
    formules: [
      { code: "SOLO", libelle: "Solo", tauxCouverture: "80", primeUnitaire: "236453.25", accessoireMode: "AUCUN", accessoireValeur: "0" },
      { code: "FAMILLE", libelle: "Famille", tauxCouverture: "80", primeUnitaire: "307389.16", accessoireMode: "AUCUN", accessoireValeur: "0" },
    ],
  };
  await creerVersion(technique, produitGroupe, versionG, null);

  // Produit individuel (T3) : seuil de validation bas, pour éprouver « Oui (sous seuil) ».
  produitIndividuel = CODE("IND");
  const brancheI = await assurerBranche(`SANTE_${produitIndividuel}`);
  await creerTaxe(technique, { branche: brancheI, typeContrat: "INDIVIDUEL", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code: produitIndividuel, libelle: "Santé individuelle (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheI }, null);
  await creerVersion(
    technique,
    produitIndividuel,
    {
      ...base,
      arrondi: { ...base.arrondi },
      prorata: { ...base.prorata },
      fractionnement: { ...base.fractionnement },
      cotation: { ...base.cotation },
      seuilValidationTtc: "200000",
      formules: [{ code: "F", libelle: "Formule unique", tauxCouverture: "80", primeUnitaire: "270129.11", accessoireMode: "AUCUN", accessoireValeur: "0" }],
    },
    null,
  );

  for (const code of [produitGroupe, produitIndividuel]) await publier("CP", code, analyse(CONTENU_CP));
  // Facture, avoir, reçu : modèles COMMUNS (sans produit), choisis à défaut d'un modèle du produit.
  await publier("FACTURE", null, analyse(CONTENU_FACTURE, { filtres: ["lettres"], textes: ["Article 13 du Code CIMA : la prise d'effet est subordonnée au paiement de la prime."] }));
  await publier("AVOIR", null, analyse(CONTENU_AVOIR));
  await publier("RECU", null, analyse(CONTENU_RECU));
  // Session 5b : un modèle d'avis d'échéance commun, et un modèle de relance par niveau pour le produit de groupe (H16).
  await publier("AVIS_ECHEANCE", null, analyse(CONTENU_AVIS));
  for (const niveau of [1, 2, 3]) await publier("RELANCE", produitGroupe, analyse(CONTENU_RELANCE), { niveau });
  await publier("RELANCE", null, analyse(CONTENU_RELANCE), { niveau: 1 });
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  remplacerGenerateur(null);
  remplacerStockage(null);
  await obtenirPrisma().$disconnect();
});

// ---------------------------------------------------------------- Session 5b

/** Échéances figées d'une facture (contenu) et son numéro. */
async function factureEmise(policeId: number): Promise<{ id: number; numero: string; echeances: { numero: number; date: string; montant: string }[] }> {
  const id = await creerFactureAffaireNouvelle(technique, policeId, null, null);
  await emettreFacture(technique, id, null);
  const f = await obtenirPrisma().facture.findUniqueOrThrow({ where: { id } });
  const contenu = f.contenu as { echeances: { numero: number; date: string; montant: string }[]; dateEffet: string; totaux: { ttc: string } };
  return { id, numero: f.numero!, echeances: contenu.echeances.length > 0 ? contenu.echeances : [{ numero: 1, date: contenu.dateEffet, montant: contenu.totaux.ttc }] };
}

const de = (factureId: number) => (e: ElementListe) => e.factureId === factureId;
const appels = (factureId: number, type: "AVIS_ECHEANCE" | "RELANCE") => obtenirPrisma().documentAProduire.findMany({ where: { factureId, type }, orderBy: { id: "asc" } });

describe("avis d'échéance (CDC §12) : liste du jour, un seul avis par échéance", () => {
  it("J-10 de la 2e tranche : avis dans la liste ; généré une fois, même en concurrence, rejoué, ou par lot", async () => {
    const p = await policeT2();
    const f = await factureEmise(p.policeId);
    const e2 = f.echeances[1];
    const date = ajouterJours(e2.date, -10);

    const liste = await listeDuJour(comptable, date);
    expect(liste.avis.filter(de(f.id)).map((a) => [a.echeance.numero, a.echeance.restant, a.joursRetard])).toEqual([[2, "2898000", -10]]);

    // Trois générations simultanées : un seul avis (facture verrouillée, index unique), aucun numéro consommé en trop.
    const r = await Promise.all([1, 2, 3].map(() => genererAppel(comptable, { type: "AVIS_ECHEANCE", factureId: f.id, echeanceNumero: 2, niveau: null }, null, date)));
    expect(r.map((x) => x.statut).sort()).toEqual(["DEJA_PRODUIT", "DEJA_PRODUIT", "PRODUIT"]);
    const avis = await appels(f.id, "AVIS_ECHEANCE");
    expect(avis).toHaveLength(1);
    expect(avis[0]).toMatchObject({ echeanceNumero: 2, niveauRelance: null, statut: "PRODUIT" });
    expect(avis[0].numero).toMatch(/^AVE-\d{4}-\d{2}-\d{4}$/);
    const d = derniere("AVIS_ECHEANCE");
    expect(d.donnees.echeance_appelee).toEqual({ numero: 2, date: e2.date, montant: "2898000", restant_du: "2898000" });
    expect(doc(d).facture_origine).toBe(f.numero);

    // Plus dans la liste ; un lot qui le contient encore ne le refait pas.
    expect((await listeDuJour(comptable, date)).avis.filter(de(f.id))).toEqual([]);
    const { lotId } = await creerLotEcheances(comptable, [{ type: "AVIS_ECHEANCE", factureId: f.id, echeanceNumero: 2, niveau: null }], null, date);
    await traiterLotEcheances(lotId);
    await traiterLotEcheances(lotId); // rejoué : lot terminé, rien à faire
    expect((await lireLotEcheances(comptable, lotId))!).toMatchObject({ statut: "TERMINE", total: 1, faits: 1, parStatut: { DEJA_PRODUIT: 1 } });
    expect(await appels(f.id, "AVIS_ECHEANCE")).toHaveLength(1);
  });

  it("hors de la fenêtre J-15 … jour de l'échéance : rien à produire, aucun numéro consommé", async () => {
    const p = await policeT2();
    const f = await factureEmise(p.policeId);
    const e3 = f.echeances[2];
    const avant = await genererAppel(comptable, { type: "AVIS_ECHEANCE", factureId: f.id, echeanceNumero: 3, niveau: null }, null, ajouterJours(e3.date, -16));
    expect(avant).toMatchObject({ statut: "SANS_OBJET", message: expect.stringMatching(/J-15/) });
    const apres = await genererAppel(comptable, { type: "AVIS_ECHEANCE", factureId: f.id, echeanceNumero: 3, niveau: null }, null, ajouterJours(e3.date, 1));
    expect(apres).toMatchObject({ statut: "SANS_OBJET", message: expect.stringMatching(/relances/) });
    expect(await appels(f.id, "AVIS_ECHEANCE")).toEqual([]);
  });

  it("droits (H21) : la Comptabilité génère ; le Commercial ne lit pas la liste ni ne génère ; la DG la lit (fin écart D21)", async () => {
    await expect(listeDuJour(commercial)).rejects.toThrow(ErreurAcces);
    await expect(genererAppel(commercial, { type: "AVIS_ECHEANCE", factureId: 1, echeanceNumero: 1, niveau: null }, null)).rejects.toThrow(ErreurAcces);
    await expect(listeDuJour(dg)).resolves.toBeTruthy();
  });
});

describe("relances (CDC §12) : niveaux, un document par (échéance, niveau), arrêt dès paiement et après avoir", () => {
  it("J+8 : niveau 1 ; J+16 : niveau 2 avec le modèle de SON niveau ; niveau 3 refusé avant J+30 ; jamais deux fois", async () => {
    const p = await policeT2();
    const f = await factureEmise(p.policeId);
    const e1 = f.echeances[0];
    const j8 = ajouterJours(e1.date, 8);
    expect((await listeDuJour(comptable, j8)).relances.filter(de(f.id)).map((r) => [r.echeance.numero, r.niveau?.niveau, r.joursRetard])).toEqual([[1, 1, 8]]);
    expect(await genererAppel(comptable, { type: "RELANCE", factureId: f.id, echeanceNumero: 1, niveau: 1 }, null, j8)).toMatchObject({ statut: "PRODUIT" });
    expect(await genererAppel(comptable, { type: "RELANCE", factureId: f.id, echeanceNumero: 1, niveau: 1 }, null, j8)).toMatchObject({ statut: "DEJA_PRODUIT" });
    expect((await listeDuJour(comptable, j8)).relances.filter(de(f.id))).toEqual([]);

    const j16 = ajouterJours(e1.date, 16);
    expect((await listeDuJour(comptable, j16)).relances.filter(de(f.id)).map((r) => r.niveau?.niveau)).toEqual([2]);
    expect(await genererAppel(comptable, { type: "RELANCE", factureId: f.id, echeanceNumero: 1, niveau: 2 }, null, j16)).toMatchObject({ statut: "PRODUIT" });
    expect(derniere("RELANCE").donnees.relance).toEqual({ niveau: 2, libelle: "Deuxième relance", jours_retard: 16 });
    const modeles = await obtenirPrisma().documentAProduire.findMany({ where: { factureId: f.id, type: "RELANCE" }, include: { modeleVersion: { include: { modele: true } } }, orderBy: { niveauRelance: "asc" } });
    expect(modeles.map((m) => [m.niveauRelance, m.modeleVersion.modele.niveauRelance, m.modeleVersion.modele.produitId !== null])).toEqual([[1, 1, true], [2, 2, true]]);
    expect(await genererAppel(comptable, { type: "RELANCE", factureId: f.id, echeanceNumero: 1, niveau: 3 }, null, j16)).toMatchObject({ statut: "SANS_OBJET", message: expect.stringMatching(/J\+30/) });
    expect(modeles[0].numero).toMatch(/^REL-/);
  });

  it("arrêt dès paiement, vérifié au moment de la génération : un lot créé AVANT le paiement ne produit rien après", async () => {
    const p = await policeT2();
    const f = await factureEmise(p.policeId);
    const j8 = ajouterJours(f.echeances[0].date, 8);
    const [relance] = (await listeDuJour(comptable, j8)).relances.filter(de(f.id));
    const { lotId } = await creerLotEcheances(comptable, [{ type: "RELANCE", factureId: f.id, echeanceNumero: 1, niveau: relance.niveau!.niveau }], null, j8);

    await enregistrerPaiement(comptable, f.id, paiement("2898000"), null); // 1re tranche payée en entier
    await traiterLotEcheances(lotId);
    const lot = (await lireLotEcheances(comptable, lotId))!;
    expect(lot.elements).toEqual([expect.objectContaining({ statut: "SANS_OBJET", numero: null, message: expect.stringMatching(/payée/) })]);
    expect(await appels(f.id, "RELANCE")).toEqual([]);
    expect((await listeDuJour(comptable, j8)).relances.filter(de(f.id))).toEqual([]);

    // Paiement partiel de la 2e tranche : elle reste due (H49) ; reste dû de CETTE échéance.
    await enregistrerPaiement(comptable, f.id, paiement("2000000"), null);
    const j10 = ajouterJours(f.echeances[1].date, 10);
    expect((await listeDuJour(comptable, j10)).relances.filter(de(f.id)).map((r) => [r.echeance.numero, r.echeance.restant])).toEqual([[2, "898000"]]);
  });

  it("arrêt après avoir : facture annulée, plus d'avis ni de relance ; l'avis déjà produit est « Annulé » sur la page de vérification", async () => {
    const p = await policeT3();
    const f = await factureEmise(p.policeId);
    const terme = f.echeances[0]; // facture sans échéancier : une seule échéance, le terme (H67)
    expect(terme).toMatchObject({ numero: 1, date: "2026-07-22", montant: "122442" });
    const j10 = ajouterJours(terme.date, -10);
    expect(await genererAppel(comptable, { type: "AVIS_ECHEANCE", factureId: f.id, echeanceNumero: 1, niveau: null }, null, j10)).toMatchObject({ statut: "PRODUIT" });

    const j8 = ajouterJours(terme.date, 8);
    expect((await listeDuJour(comptable, j8)).relances.filter(de(f.id)).map((r) => r.niveau?.niveau)).toEqual([1]);
    const { lotId } = await creerLotEcheances(comptable, [{ type: "RELANCE", factureId: f.id, echeanceNumero: 1, niveau: 1 }], null, j8);
    const { numero: avoir } = await emettreAvoir(comptable, f.id, "Erreur de saisie (test)", null);

    await traiterLotEcheances(lotId);
    expect((await lireLotEcheances(comptable, lotId))!.elements).toEqual([expect.objectContaining({ statut: "SANS_OBJET", message: expect.stringMatching(/annulée par un avoir/) })]);
    expect(await appels(f.id, "RELANCE")).toEqual([]);
    expect((await listeDuJour(comptable, j8)).relances.filter(de(f.id))).toEqual([]);
    expect((await listeDuJour(comptable, j10)).avis.filter(de(f.id))).toEqual([]);
    const [avis] = await appels(f.id, "AVIS_ECHEANCE");
    expect(await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: avis.documentId! } })).toMatchObject({ annuleParNumero: avoir });
  });
});

describe("liste quotidienne : tâche planifiée, aucune émission", () => {
  it("la tâche établit la liste et la consigne au journal une seule fois par jour ; elle ne produit aucun document", async () => {
    const p = await policeT2();
    const f = await factureEmise(p.policeId);
    const date = ajouterJours(f.echeances[1].date, -5);
    const premier = await etablirListeDuJour(date);
    const second = await etablirListeDuJour(date);
    expect(second).toMatchObject({ avis: premier.avis, relances: premier.relances, dejaEtablie: true });
    expect(premier.avis).toBeGreaterThanOrEqual(1);
    const traces = (await lireJournal({ action: "LISTE_ECHEANCES_ETABLIE" })).lignes.filter((l) => l.objet === `echeances liste ${date}`);
    expect(traces).toHaveLength(1);
    expect(await appels(f.id, "AVIS_ECHEANCE")).toEqual([]);
  });
});

describe("échéances payées en partie (session 6.1) : une seule règle pour l'écran, le PDF, l'avis et la relance", () => {
  /** Même cas que la recette du 09/10/2026 (échéance 2 : restant 222), sur le jeu T2 : 2 898 000 × 4. */
  async function verifierLeCas(facture: { id: number; echeances: { date: string }[] }) {
    const attendu = [
      { numero: 1, montant: "2898000", paye: "2898000", restant: "0", statut: "Payé" },
      { numero: 2, montant: "2898000", paye: "2897778", restant: "222", statut: "Partiellement payé" },
      { numero: 3, montant: "2898000", paye: "0", restant: "2898000", statut: "Non payé" },
      { numero: 4, montant: "2898000", paye: "0", restant: "2898000", statut: "Non payé" },
    ];
    // Écran de la facture.
    const lue = (await lireFacture(comptable, facture.id))!;
    expect(lue.etat!.echeances).toEqual(attendu.map((e) => expect.objectContaining(e)));
    expect(lue.etat!.restantDu).toBe(String(4 * 2898000 - 2898000 - 2897778));
    // Données du PDF de la dernière version de la facture.
    expect(derniere("FACTURE").donnees.echeances).toEqual(attendu.map((e) => expect.objectContaining(e)));
    // Liste du jour : l'avis et la relance de l'échéance 2 appellent son restant.
    const e2 = facture.echeances[1].date;
    const avisJ10 = (await listeDuJour(comptable, ajouterJours(e2, -10))).avis.filter(de(facture.id));
    expect(avisJ10.map((a) => [a.echeance.numero, a.echeance.montant, a.echeance.restant])).toEqual([[2, "2898000", "222"]]);
    const j8 = ajouterJours(e2, 8);
    const relances = (await listeDuJour(comptable, j8)).relances.filter(de(facture.id));
    expect(relances.map((r) => [r.echeance.numero, r.echeance.restant, r.niveau?.niveau])).toEqual([[2, "222", 1]]);
    // Documents produits : le restant, pas le montant total de l'échéance.
    expect(await genererAppel(comptable, { type: "AVIS_ECHEANCE", factureId: facture.id, echeanceNumero: 2, niveau: null }, null, ajouterJours(e2, -10))).toMatchObject({ statut: "PRODUIT" });
    expect(derniere("AVIS_ECHEANCE").donnees.echeance_appelee).toEqual({ numero: 2, date: e2, montant: "2898000", restant_du: "222" });
    expect(await genererAppel(comptable, { type: "RELANCE", factureId: facture.id, echeanceNumero: 2, niveau: 1 }, null, j8)).toMatchObject({ statut: "PRODUIT" });
    expect(derniere("RELANCE").donnees.echeance_appelee).toEqual({ numero: 2, date: e2, montant: "2898000", restant_du: "222" });
    // L'échéance 1, payée, n'appelle plus rien ; le restant dû du tableau de bord compte bien 222 sur l'échéance 2.
    expect((await listeDuJour(comptable, ajouterJours(facture.echeances[0].date, 8))).relances.filter(de(facture.id))).toEqual([]);
  }

  it("deux paiements : 2 898 000 puis 2 897 778 : échéance 2 « Partiellement payé », 222 restant (écran, PDF, avis, relance)", async () => {
    const p = await policeT2();
    const f = await factureEmise(p.policeId);
    await enregistrerPaiement(comptable, f.id, paiement("2898000"), null);
    await enregistrerPaiement(comptable, f.id, paiement("2897778"), null);
    await verifierLeCas(f);
  });

  it("avec une imputation d'avance (comptée comme un paiement) : même répartition, même relance de 222", async () => {
    const p = await policeT2();
    const f = await factureEmise(p.policeId);
    // Renouvellement payé avec un trop-perçu : 14 500 000 − 11 592 000 = 2 908 000 F en avance sur la police.
    const ren = await creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null);
    await emettreFacture(technique, ren, null);
    expect((await enregistrerPaiement(comptable, ren, paiement("14500000"), null)).avance).toBe("2908000");
    await enregistrerPaiement(comptable, f.id, paiement("2898000"), null);
    expect(await imputerAvance(comptable, f.id, "2897778", null)).toMatchObject({ restantDu: "5796222", avance: "10222" });
    await verifierLeCas(f);
    expect((derniere("FACTURE").donnees.paiements as { canal: string }[]).map((x) => x.canal)).toEqual(["Virement", "Avance"]);
  });
});

describe("tableaux de bord : chiffres recalculés depuis la base", () => {
  it("un indicateur par bloc sur des données connues (écarts avant / après) ; droits", async () => {
    await expect(tableauDeBord(commercial)).rejects.toThrow(ErreurAcces);
    const avant = await tableauDeBord(comptable);
    await expect(tableauDeBord(dg)).resolves.toBeTruthy();
    await expect(tableauDeBord(technique, { debut: "2026-12-01", fin: "2026-01-01" })).rejects.toThrow(/début est après la fin/);

    // Cotations : une acceptée (police) et une émise non acceptée, du produit de groupe.
    const ligne = (t: Awaited<ReturnType<typeof tableauDeBord>>) => t.cotations.transformation.parProduit.find((l) => l.cle === produitGroupe) ?? { emises: 0, acceptees: 0 };
    const p = await policeT3();
    await policeT2();
    const seule = await creerBrouillon(commercial, { codeProduit: produitGroupe, typeContrat: "GROUPE", souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "Prospect inventé", telephone: "", email: "", adresse: "" }, dateEffet: "2026-01-01", dateEcheance: "2026-12-31", nombreTranches: 1, lignes: [{ codeFormule: "SOLO", effectif: 1 }], assures: [], clientId: null, motifForcage: null, beneficiaires: [], contactsUrgence: [], risque: {} }, null);
    await soumettre(commercial, seule, null);

    // Facturation : facture T3 (122 442) émise, 41 000 encaissés, terme du 22/07 échu (plus de 60 jours au 09/10).
    const f = await factureEmise(p.policeId);
    await enregistrerPaiement(comptable, f.id, paiement("41000"), null);
    // Relance de niveau 1 produite.
    expect(await genererAppel(comptable, { type: "RELANCE", factureId: f.id, echeanceNumero: 1, niveau: 1 }, null, "2026-07-30")).toMatchObject({ statut: "PRODUIT" });

    const apres = await tableauDeBord(comptable);
    expect([ligne(apres).emises - ligne(avant).emises, ligne(apres).acceptees - ligne(avant).acceptees]).toEqual([2, 1]);
    expect(apres.cotations.parStatut.ACCEPTEE - avant.cotations.parStatut.ACCEPTEE).toBe(2);
    const ecart = (a: string, b: string) => montant(a).minus(montant(b)).toFixed();
    expect(ecart(apres.facturation.emis, avant.facturation.emis)).toBe("122442");
    expect(ecart(apres.facturation.encaisse, avant.facturation.encaisse)).toBe("41000");
    expect(ecart(apres.facturation.restantDu, avant.facturation.restantDu)).toBe("81442");
    if (aujourdhui() > "2026-09-20") {
      expect(apres.facturation.impayes["60+"].nombre - avant.facturation.impayes["60+"].nombre).toBe(1);
      expect(ecart(apres.facturation.impayes["60+"].montant, avant.facturation.impayes["60+"].montant)).toBe("81442");
    }
    const relances1 = (t: typeof avant) => t.facturation.relancesParNiveau.find((r) => r.niveau === 1)?.nombre ?? 0;
    expect(relances1(apres) - relances1(avant)).toBe(1);

    // Production : la facture et le PDF de la relance, dans les documents émis du mois.
    const mois = aujourdhui().slice(0, 7);
    const factures = (t: typeof avant) => t.production.documents.find((d) => d.mois === mois && d.type === "FACTURE")?.nombre ?? 0;
    expect(factures(apres) - factures(avant)).toBe(1);
  });
});

describe("tableau de bord du commercial : ses chiffres seulement", () => {
  it("compte ses cotations, ses polices et l'encaissement de ses polices, jamais ceux d'un autre auteur", async () => {
    const avant = await tableauCommercial(commercial);
    const p = await policeT3();
    const f = await factureEmise(p.policeId);
    await enregistrerPaiement(comptable, f.id, paiement("41000"), null);
    // Un brouillon d'un AUTRE auteur (la Technique) ne change rien à ses chiffres.
    await creerBrouillon(technique, { codeProduit: produitIndividuel, typeContrat: "INDIVIDUEL", souscripteur: { type: "PHYSIQUE", nom: "KONE", prenoms: "Awa (inventée)", raison_sociale: "", telephone: "", email: "", adresse: "" }, dateEffet: "2026-01-01", dateEcheance: "2026-12-31", nombreTranches: 1, lignes: [{ codeFormule: "F", effectif: 1 }], assures: [], clientId: null, motifForcage: null, beneficiaires: [], contactsUrgence: [], risque: {} }, null);

    const apres = await tableauCommercial(commercial);
    const ecart = (a: string, b: string) => montant(a).minus(montant(b)).toFixed();
    expect(apres.production.polices - avant.production.polices).toBe(1);
    expect(apres.cotations.parStatut.ACCEPTEE - avant.cotations.parStatut.ACCEPTEE).toBe(1);
    expect(apres.cotations.parStatut.BROUILLON).toBe(avant.cotations.parStatut.BROUILLON);
    expect(ecart(apres.encaissement.emis, avant.encaissement.emis)).toBe("122442");
    expect(ecart(apres.encaissement.encaisse, avant.encaissement.encaisse)).toBe("41000");
    expect(ecart(apres.encaissement.restantDu, avant.encaissement.restantDu)).toBe("81442");
    expect(apres.enCours.every((c) => c.statut !== "ACCEPTEE")).toBe(true);
    // La Technique n'a produit aucune police : son tableau personnel (mêmes règles) ne voit rien de celles du commercial.
    expect((await tableauCommercial(technique)).production.polices).toBe(0);
    await expect(tableauCommercial(commercial, { debut: "2026-12-01", fin: "2026-01-01" })).rejects.toThrow(/début est après la fin/);
  });
});

describe("tableaux de bord de la page d'arrivée : mémoire de 60 s (audit M7)", () => {
  it("sert la mémoire sans relire la base, ne contourne aucun droit et ne mélange pas deux commerciaux", async () => {
    viderMemoireTableaux();
    const premier = await tableauDeBordMemorise(comptable);
    // Une nouvelle cotation acceptée change les chiffres de la base, pas ceux de la mémoire (moins d'une minute plus tard).
    await policeT3();
    const memorise = await tableauDeBordMemorise(dg);
    expect(memorise).toBe(premier); // même objet : rien n'a été recalculé
    expect((await tableauDeBord(comptable)).cotations.parStatut.ACCEPTEE).toBeGreaterThan(premier.cotations.parStatut.ACCEPTEE);

    // Le droit est vérifié avant la mémoire : un profil sans droit n'y lit rien, même remplie.
    await expect(tableauDeBordMemorise(commercial)).rejects.toThrow(ErreurAcces);

    // Une période refusée n'est pas gardée en mémoire.
    await expect(tableauDeBordMemorise(comptable, { debut: "2026-12-01", fin: "2026-01-01" })).rejects.toThrow(/début est après la fin/);
    await expect(tableauDeBordMemorise(comptable, { debut: "2026-12-01", fin: "2026-01-01" })).rejects.toThrow(/début est après la fin/);

    // Deux commerciaux : chacun garde ses propres chiffres.
    const moi = await tableauCommercialMemorise(commercial);
    const autre = await tableauCommercialMemorise(technique);
    expect(autre).not.toBe(moi);
    expect(await tableauCommercialMemorise(commercial)).toBe(moi);
    viderMemoireTableaux();
  });
});

describe("paramètres des avis et relances (par produit, historisés)", () => {
  it("nouvelle valeur à une date d'effet jamais passée, journalisée ; contrôles ; droits", async () => {
    const nouveaux = { delaiAvisJours: 20, niveaux: [{ niveau: 1, jours: 10, libelle: "Rappel amiable" }, { niveau: 2, jours: 45, libelle: "Mise en demeure" }] };
    await expect(enregistrerParametresRelance(technique, produitIndividuel, nouveaux, "2020-01-01", null)).rejects.toThrow(/rétroactivement/);
    await expect(enregistrerParametresRelance(technique, produitIndividuel, { ...nouveaux, delaiAvisJours: -3 }, aujourdhui(), null)).rejects.toThrow(/Délai de l'avis/);
    await expect(enregistrerParametresRelance(commercial, produitIndividuel, nouveaux, aujourdhui(), null)).rejects.toThrow(ErreurAcces);
    const defaut = (await consulterParametresRelance(technique, produitIndividuel))!;
    expect(defaut).toMatchObject({ parDefaut: true, enVigueur: { delaiAvisJours: 15 } });

    await enregistrerParametresRelance(technique, produitIndividuel, nouveaux, aujourdhui(), null);
    const lu = (await consulterParametresRelance(technique, produitIndividuel))!;
    expect(lu).toMatchObject({ parDefaut: false, enVigueur: nouveaux });
    expect(lu.historique).toHaveLength(1);
    const [trace] = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.filter((l) => l.objet === `parametre relances.${produitIndividuel}`);
    expect(trace.apres).toMatchObject({ avant: { delaiAvisJours: 15 }, apres: { delaiAvisJours: 20 } });
    expect(await consulterParametresRelance(technique, "INCONNU_X")).toBeNull();
  });
});
