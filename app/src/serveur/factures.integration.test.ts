// Session 4b : factures, avoirs, paiements, reçus (CDC §11, §12). Jeux T2, T3, T4, numérotation sans trou sous
// concurrence, « Oui (sous seuil) » à l'émission d'une facture, PDF en attente. Générateur SIMULÉ, stockage EN MÉMOIRE.
// Toutes les données sont inventées.
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import { MESSAGE_RENOUVELLEMENT_GARANTIES, MESSAGE_TARIFICATION_PAR_GARANTIES, type VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Analyse } from "@/domaine/documents/analyse";
import type { Assure } from "@/domaine/cotation/saisie";

import { incorporerAdherents } from "./adherents";
import { lireJournal } from "./audit";
import { assurerBranche, rattacherCgDeTest } from "./branches-test";
import { accepter, composerLaPrime, creerBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { emettreCp, verifierJeton } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import {
  abandonnerFacture,
  composerFacture,
  creerFactureAffaireNouvelle,
  creerFactureAvenant,
  creerFactureRenouvellement,
  emettreAvoir,
  emettreFacture,
  enregistrerPaiement,
  facturesDePolice,
  imputerAvance,
  lireFacture,
  modifierFacture,
  relancerPdf,
  restituerAvance,
} from "./factures";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion, listerVersions } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature } from "./societe-test";
import { consulterFormatsNumero, enregistrerFormatNumero } from "./societe";
import { remplacerStockage } from "./stockage";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sha256 = (o: Uint8Array) => createHash("sha256").update(o).digest("hex");
const texte = (t: string) => new TextEncoder().encode(t);

let technique: UtilisateurCourant;
let techniqueValideur: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let gestionnaire: UtilisateurCourant;
let gestionnaire2: UtilisateurCourant;
let comptable: UtilisateurCourant;
let admin: UtilisateurCourant;
let produitGroupe: string;
let produitIndividuel: string;
let compteurPolice = 0;
const numeroPolice = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(++compteurPolice).padStart(5, "0")}`;

const demandes: DemandePdf[] = [];
const fichiers = new Map<string, Uint8Array>();
let prochaineAnalyse: Analyse;
let generateurEnPanne = false;

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

const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
async function publier(type: "CP" | "CG" | "FACTURE" | "AVOIR" | "RECU", code: string | null, a: Analyse, options: { visa?: string } = {}) {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: type === "CG" ? "CG santé (test)" : `Modèle ${type}`, produitCode: code, ...sans }, null);
  prochaineAnalyse = a;
  await deposerVersion(technique, id, { fichier: texte(`docx ${type}`), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: options.visa ?? null, dateDocument: options.visa ? "2025-06-19" : null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return { code: (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code, versionId: v.id };
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
const policeT2 = async () => {
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2020-01-01T00:00:00.000Z") } },
    update: { valeur: "20000000" },
    create: { cle: "seuil_validation_global", valeur: "20000000", dateEffet: new Date("2020-01-01T00:00:00.000Z"), creePar: "test" },
  });
  return police(
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
};

/** T3 : facture individuelle YAO (nom inventé du CDC), effet 22/07/2026, échéance 31/12/2026. */
const policeT3 = async (dateEffet = "2026-07-22") => {
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2020-01-01T00:00:00.000Z") } },
    update: { valeur: "200000" },
    create: { cle: "seuil_validation_global", valeur: "200000", dateEffet: new Date("2020-01-01T00:00:00.000Z"), creePar: "test" },
  });
  return police(
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
};

const derniere = (type: string) => [...demandes].reverse().find((d) => (d.donnees.doc as { type: string }).type === type)!;
const doc = (d: DemandePdf) => d.donnees.doc as Record<string, string>;
const paiement = (montant: string, canal = "VIREMENT") => ({ date: aujourdhui(), montant, canal, reference: canal === "ESPECES" ? "" : "VIR-INVENTE-001", payeur: "" });
const numeroDe = (n: string) => Number(n.slice(-4));

/** SQL direct sur la base de test : renvoie le message de refus de la base (déclencheur), ou « accepté ». */
async function sql(requete: string): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(requete);
    return "accepté";
  } catch (erreur) {
    return (erreur as Error).message;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
  remplacerGenerateur({
    analyser: async () => prochaineAnalyse,
    genererPdf: async (demande) => {
      if (generateurEnPanne) throw new Error("générateur injoignable (panne simulée)");
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
  techniqueValideur = await nouveau("TECHNIQUE");
  dg = await nouveau("DIRECTION_GENERALE");
  commercial = await nouveau("COMMERCIAL");
  gestionnaire = await nouveau("GESTIONNAIRE_PRODUCTION");
  gestionnaire2 = await nouveau("GESTIONNAIRE_PRODUCTION");
  comptable = await nouveau("COMPTABILITE");
  await assurerSignature(technique);

  const cg = await publier("CG", null, analyse(["produit.cg_visa"]), { visa: "VISA-INVENTE-01" });
  await rattacherCgDeTest("MALADIE", cg.code);
  await rattacherCgDeTest("INCENDIE_DOMMAGES", cg.code);
  const references = { csModeleCode: null, csVisa: null };
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
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2026-01-01T00:00:00.000Z") } },
    update: { valeur: "10000000" },
    create: { cle: "seuil_validation_global", valeur: "10000000", dateEffet: new Date("2026-01-01T00:00:00.000Z"), creePar: "test" },
  });
  await obtenirPrisma().parametre.deleteMany({
    where: { cle: "seuil_validation_global", dateEffet: { not: new Date("2026-01-01T00:00:00.000Z") } },
  });
  remplacerGenerateur(null);
  remplacerStockage(null);
  await obtenirPrisma().$disconnect();
});

describe("T2 : facture de groupe CGE-SN (4 échéances)", () => {
  it("HT 11 420 690, taxe 171 310, TTC 11 592 000, 4 × 2 898 000, numéro de police, liste par adhérent en annexe", async () => {
    const p = await policeT2();
    const id = await creerFactureAffaireNouvelle(gestionnaire, p.policeId, { nom: "Service comptable (inventé)", adresse: "Plateau, autre rue inventée" }, null);
    // 11 592 000 F est sous le seuil du produit (20 000 000 F) : le Gestionnaire émet lui-même.
    const r = await emettreFacture(gestionnaire, id, null);
    expect(r.statut).toBe("EMISE");
    if (r.statut !== "EMISE") return;
    expect(r.numero).toMatch(new RegExp(`^FAC-${aujourdhui().slice(0, 4)}-${aujourdhui().slice(5, 7)}-\\d{4}$`));
    expect(r.productions[0]).toMatchObject({ ok: true, numero: r.numero, version: 1 });

    const d = derniere("FACTURE");
    expect(d.listesEnAnnexe).toEqual(["assures"]);
    expect(d.donnees.prime).toMatchObject({ nette: "11420690", accessoires: "0", base_taxe: "11420690", taux_taxe: "1.5", taxe: "171310", ttc: "11592000" });
    expect(d.donnees.echeances).toEqual([1, 2, 3, 4].map((n) => expect.objectContaining({ numero: n, montant: "2898000", statut: "Non payé" })));
    expect((d.donnees.police as { numero: string }).numero).toBe(p.numero);
    expect(doc(d)).toMatchObject({ numero: r.numero, version: "v1", facture_origine: null });
    expect(d.donnees.envoye_a).toEqual({ nom: "Service comptable (inventé)", adresse: "Plateau, autre rue inventée" });
    expect(d.donnees.paiements).toEqual([]);
    expect(d.donnees.solde).toEqual({ total_paye: "0", restant_du: "11592000", avance: "0" });
    // assures[].prime (H45) : TTC d'une unité de sa formule, 1 920 000 / 8 et 9 672 000 / 31.
    const primes = new Set((d.donnees.assures as { formule: string; prime: string }[]).map((a) => `${a.formule}:${a.prime}`));
    expect([...primes].sort()).toEqual(["FAMILLE:312000", "SOLO:240000"]);
    expect((d.donnees.formules as { code: string; ttc: string }[]).map((f) => [f.code, f.ttc])).toEqual([["SOLO", "1920000"], ["FAMILLE", "9672000"]]);

    const lue = (await lireFacture(comptable, id))!;
    expect(lue).toMatchObject({ statut: "EMISE", numero: r.numero, ttc: "11592000", restantDu: "11592000", pdfEnAttente: 0 });
    expect(lue.actions).toMatchObject({ modifier: false, emettre: false, avoir: true, payer: true });
  });

  it("« Envoyé à » identique à « Facturé à » : bloc masqué (null)", async () => {
    const p = await policeT2();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, { nom: "cge-sn  (société inventée)", adresse: "Plateau, rue inventée, Abidjan" }, null);
    expect((await lireFacture(technique, id))!.contenu.envoyeA).toBeNull();
  });
});

describe("T3 : facture individuelle YAO (prorata), paiement de 41 000, reçu et facture v2", () => {
  it("163 jours, HT 120 633, taxe 1 809 (1 809,495 avant arrondi), restant dû recalculé, REC, facture rééditée", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    const r = await emettreFacture(technique, id, null);
    if (r.statut !== "EMISE") throw new Error("attendu : émise");
    const v1 = derniere("FACTURE");
    expect(v1.donnees.police).toMatchObject({ date_effet: "2026-07-22", date_echeance: "2026-12-31", duree_jours: 163, duree_libelle: "163 jours" });
    expect(v1.donnees.prime).toMatchObject({ nette: "120633", base_taxe: "120633", taxe: "1809", ttc: "122442" });
    expect(v1.donnees.echeances).toEqual([]); // une seule tranche : pas d'échéancier
    expect(v1.donnees.envoye_a).toBeNull();

    const pay = await enregistrerPaiement(gestionnaire, id, paiement("41 000"), null);
    expect(pay.numeroRecu).toMatch(/^REC-\d{4}-\d{2}-\d{4}$/);
    expect(pay.restantDu).toBe("81442");
    expect(pay.productions.map((x) => [x.type, x.numero, x.version, x.ok])).toEqual([
      ["RECU", pay.numeroRecu, 1, true],
      ["FACTURE", r.numero, 2, true],
    ]);

    const recu = derniere("RECU");
    expect(doc(recu)).toMatchObject({ numero: pay.numeroRecu, facture_origine: r.numero });
    expect(recu.donnees.paiements).toEqual([expect.objectContaining({ numero: pay.numeroRecu, montant: "41000", canal: "Virement", restant_du: "81442", payeur: "YAO Koffi (inventé)" })]);
    expect(recu.donnees.solde).toEqual({ total_paye: "41000", restant_du: "81442", avance: "0" });

    const v2 = derniere("FACTURE");
    expect(doc(v2)).toMatchObject({ numero: r.numero, version: "v2", date_emission: doc(v1).date_emission });
    expect(doc(v2).url_verification).not.toBe(doc(v1).url_verification);
    expect(v2.donnees.solde).toEqual({ total_paye: "41000", restant_du: "81442", avance: "0" });
    expect(v2.donnees.prime).toEqual(v1.donnees.prime);

    const emis = await obtenirPrisma().documentEmis.findMany({ where: { numero: r.numero }, orderBy: { version: "asc" } });
    expect(emis.map((e) => e.version)).toEqual([1, 2]);
    expect(emis[1].origineId).toBe(emis[0].id);
    expect(emis[1].modeleVersionId).toBe(emis[0].modeleVersionId);
  });

  it("trop-perçu accepté (H33, 09/10/2026) : l'excédent devient une avance, visible sur le reçu et la fiche de la police", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, id, null);
    const recusAvant = await obtenirPrisma().paiement.count();
    await expect(enregistrerPaiement(comptable, id, paiement("0"), null)).rejects.toThrow(/supérieur à 0/);
    await expect(enregistrerPaiement(comptable, id, paiement("-5"), null)).rejects.toThrow(ErreurMetier);
    expect(await obtenirPrisma().paiement.count()).toBe(recusAvant);

    const r = await enregistrerPaiement(comptable, id, paiement("130 000"), null);
    expect(r).toMatchObject({ restantDu: "0", excedent: "7558", avance: "7558" });
    const recu = derniere("RECU");
    // Le reçu porte le montant reçu en entier, et l'avance de la police.
    expect(recu.donnees.paiements).toEqual([expect.objectContaining({ numero: r.numeroRecu, montant: "130000", restant_du: "0" })]);
    expect(recu.donnees.solde).toEqual({ total_paye: "122442", restant_du: "0", avance: "7558" });
    expect(derniere("FACTURE").donnees.solde).toEqual({ total_paye: "122442", restant_du: "0", avance: "7558" });

    const vue = (await facturesDePolice(comptable, p.cotationId))!;
    expect(vue.avance.disponible).toBe("7558");
    expect(vue.avance.mouvements).toEqual([expect.objectContaining({ type: "EXCEDENT", credit: true, montant: "7558", facture: null, recu: r.numeroRecu })]);
    const journal = await lireJournal({ action: "AVANCE_CREDITEE" });
    expect(journal.lignes.some((l) => (l.apres as { recu?: string } | null)?.recu === r.numeroRecu)).toBe(true);

    // Facture soldée : plus rien à y payer.
    await expect(enregistrerPaiement(comptable, id, paiement("1"), null)).rejects.toThrow(/déjà soldée/);
    expect((await lireFacture(comptable, id))!.actions.payer).toBe(false);

    // Filets de la base : paiements en ajout seul ; une part réglée jamais au-delà du TTC ; un excédent seulement s'il solde.
    expect(await sql(`DELETE FROM paiements WHERE facture_id = ${id}`)).toMatch(/paiement/);
    expect(await sql(`UPDATE paiements SET montant = 1 WHERE facture_id = ${id}`)).toMatch(/paiement/);
    expect(await sql(`INSERT INTO paiements (facture_id, numero_recu, date, montant, canal, reference, payeur, cree_par_id, cree_par) VALUES (${id}, 'REC-TEST-${id}', CURRENT_DATE, 1, 'ESPECES', '', 'x', ${comptable.id}, 'x')`)).toMatch(/trop-perçu non déclaré/);
    // Avance : ajout seul, jamais négative.
    expect(await sql(`DELETE FROM mouvements_avance WHERE police_id = ${p.policeId}`)).toMatch(/ajout seul/);
    expect(await sql(`INSERT INTO mouvements_avance (police_id, type, montant, date, canal, reference, cree_par_id, cree_par) VALUES (${p.policeId}, 'RESTITUTION', 7559, CURRENT_DATE, 'ESPECES', '', ${comptable.id}, 'x')`)).toMatch(/avance insuffisante/);
  });

  it("avance : imputée sur une facture de la même police (rééditée), puis restituée ; jamais au-delà du disponible", async () => {
    const p = await policeT2();
    const an = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, an, null);
    // Renouvellement payé avec un trop-perçu de 1 000 000 F.
    const ren = await creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null);
    await emettreFacture(technique, ren, null);
    expect((await enregistrerPaiement(comptable, ren, paiement("12592000"), null)).avance).toBe("1000000");

    const avant = (await lireFacture(comptable, an))!;
    expect(avant.avance).toEqual({ disponible: "1000000", proposee: "1000000", reportsEnAttente: [] });
    expect(avant.actions.imputer).toBe(true);
    await expect(imputerAvance(technique, an, "1000", null)).rejects.toThrow(ErreurAcces);
    await expect(imputerAvance(comptable, an, "1000001", null)).rejects.toThrow(/dépasse l'avance disponible/);
    const i = await imputerAvance(comptable, an, "600 000", null);
    expect(i).toMatchObject({ restantDu: "10992000", avance: "400000" });
    const v2 = derniere("FACTURE");
    expect(doc(v2)).toMatchObject({ version: "v2" });
    expect(v2.donnees.paiements).toEqual([expect.objectContaining({ numero: "", montant: "600000", canal: "Avance", restant_du: "10992000" })]);
    // 600 000 imputés sur l'échéance 1 (2 898 000) : couverte en partie (session 6.1).
    expect(v2.donnees.echeances).toEqual([
      expect.objectContaining({ numero: 1, statut: "Partiellement payé", paye: "600000", restant: "2298000" }),
      ...[2, 3, 4].map((numero) => expect.objectContaining({ numero, statut: "Non payé", paye: "0", restant: "2898000" })),
    ]);
    expect(v2.donnees.solde).toEqual({ total_paye: "600000", restant_du: "10992000", avance: "400000" });

    await expect(restituerAvance(comptable, p.policeId, { date: aujourdhui(), montant: "400001", canal: "VIREMENT", reference: "VIR-REMB-1" }, null)).rejects.toThrow(/dépasse l'avance/);
    await expect(restituerAvance(comptable, p.policeId, { date: aujourdhui(), montant: "1000", canal: "VIREMENT", reference: "" }, null)).rejects.toThrow(/référence/);
    expect(await restituerAvance(comptable, p.policeId, { date: aujourdhui(), montant: "400000", canal: "VIREMENT", reference: "VIR-REMB-1" }, null)).toEqual({ avance: "0" });
    const vue = (await facturesDePolice(comptable, p.cotationId))!;
    expect(vue.avance.mouvements.map((m) => [m.type, m.montant])).toEqual([["EXCEDENT", "1000000"], ["IMPUTATION", "600000"], ["RESTITUTION", "400000"]]);
    expect((await lireFacture(comptable, an))!.actions.imputer).toBe(false);
    const journal = await lireJournal({ action: "AVANCE_RESTITUEE" });
    expect(journal.lignes.some((l) => (l.apres as { reference?: string } | null)?.reference === "VIR-REMB-1")).toBe(true);
  });

  it("droits : la Technique et le Commercial n'enregistrent pas de paiement ; le Commercial ne lit pas les factures", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, id, null);
    await expect(enregistrerPaiement(technique, id, paiement("1000"), null)).rejects.toThrow(ErreurAcces);
    await expect(lireFacture(commercial, id)).rejects.toThrow(ErreurAcces);
    await expect(creerFactureAffaireNouvelle(commercial, p.policeId, null, null)).rejects.toThrow(ErreurAcces);
  });
});

describe("échéances payées dans l'ordre (H49)", () => {
  it("2 898 000 puis 2 000 000 : 1re échéance payée, 2e « Partiellement payé » (898 000 restant)", async () => {
    const p = await policeT2();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, id, null);
    await enregistrerPaiement(comptable, id, paiement("2898000"), null);
    await enregistrerPaiement(comptable, id, paiement("2000000"), null);
    const v3 = derniere("FACTURE");
    expect(doc(v3).version).toBe("v3");
    expect((v3.donnees.echeances as { statut: string }[]).map((e) => e.statut)).toEqual(["Payé", "Partiellement payé", "Non payé", "Non payé"]);
    expect((v3.donnees.echeances as { restant: string }[]).map((e) => e.restant)).toEqual(["0", "898000", "2898000", "2898000"]);
    expect(v3.donnees.solde).toEqual({ total_paye: "4898000", restant_du: "6694000", avance: "0" });
    expect((v3.donnees.paiements as { restant_du: string }[]).map((x) => x.restant_du)).toEqual(["8694000", "6694000"]);
  });
});

describe("T4 : intangibilité, avoir puis nouvelle facture", () => {
  it("la base refuse toute modification ou suppression d'une facture émise", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, id, null);
    const prisma = obtenirPrisma();
    // Prisma résume l'erreur du déclencheur (« Foreign key constraint violated ») : le message de la base se lit en SQL direct.
    await expect(prisma.facture.update({ where: { id }, data: { ttc: "1" } })).rejects.toThrow();
    await expect(prisma.facture.delete({ where: { id } })).rejects.toThrow();
    expect(await sql(`UPDATE factures SET ttc = 1 WHERE id = ${id}`)).toMatch(/émise, elle ne se modifie plus \(correction : avoir puis nouvelle facture\)/);
    expect(await sql(`UPDATE factures SET contenu = '{}' WHERE id = ${id}`)).toMatch(/émise, elle ne se modifie plus/);
    expect(await sql(`UPDATE factures SET statut = 'BROUILLON', numero = NULL WHERE id = ${id}`)).toMatch(/émise, elle ne se modifie plus/);
    expect(await sql(`DELETE FROM factures WHERE id = ${id}`)).toMatch(/suppression interdite/);
    expect((await prisma.facture.findUniqueOrThrow({ where: { id } })).ttc.toFixed()).toBe("122442");
    await expect(modifierFacture(technique, id, { envoyeA: { nom: "X", adresse: "Y" }, lignes: null, nombreTranches: null }, null)).rejects.toThrow(/Seul un brouillon/);
    const pa = await prisma.documentAProduire.findFirstOrThrow({ where: { factureId: id } });
    expect(await sql(`UPDATE documents_a_produire SET donnees = '{}' WHERE id = ${pa.id}`)).toMatch(/déjà produit/);
  });

  it("avoir AV (montants négatifs, facture d'origine), facture « Annulée – avoir AV-… », nouvelle facture numérotée sans trou", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    const f = await emettreFacture(technique, id, null);
    if (f.statut !== "EMISE") throw new Error("attendu : émise");

    await expect(emettreAvoir(gestionnaire, id, "Erreur de date d'effet", null)).rejects.toThrow(ErreurAcces); // Gestionnaire : « – »
    await expect(emettreAvoir(comptable, id, "abc", null)).rejects.toThrow(/Motif/);
    const av = await emettreAvoir(comptable, id, "Erreur sur la date d'effet (test)", null);
    expect(av.numero).toMatch(/^AV-\d{4}-\d{2}-\d{4}$/);
    const d = derniere("AVOIR");
    expect(doc(d)).toMatchObject({ numero: av.numero, facture_origine: f.numero });
    expect(d.donnees.prime).toMatchObject({ nette: "-120633", taxe: "-1809", ttc: "-122442" });

    const origine = (await lireFacture(comptable, id))!;
    expect(origine).toMatchObject({ statut: "ANNULEE", avoir: { numero: av.numero } });
    expect(origine.actions).toMatchObject({ payer: false, avoir: false });
    const emis = await obtenirPrisma().documentEmis.findFirstOrThrow({ where: { numero: f.numero } });
    expect((await verifierJeton(emis.jeton))!.statut.libelle).toBe(`Annulée – avoir ${av.numero}`);

    await expect(enregistrerPaiement(comptable, id, paiement("1000"), null)).rejects.toThrow(/annulée par un avoir/);
    await expect(emettreAvoir(comptable, id, "Deuxième avoir (test)", null)).rejects.toThrow(/déjà annulée/);
    await expect(obtenirPrisma().facture.update({ where: { id }, data: { motif: "x" } })).rejects.toThrow(/annulée/);

    const nouvelle = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    const n = await emettreFacture(technique, nouvelle, null);
    if (n.statut !== "EMISE") throw new Error("attendu : émise");
    expect((await lireFacture(technique, nouvelle))!.remplace).toEqual({ id, numero: f.numero });
    expect((await lireFacture(technique, id))!.remplacante).toMatchObject({ id: nouvelle, numero: n.numero });
    // Sans trou : la nouvelle facture prend le numéro suivant de l'année, l'avoir a son propre compteur.
    const dernierFac = await obtenirPrisma().facture.findFirstOrThrow({ where: { numero: { startsWith: "FAC-" }, id: { not: nouvelle } }, orderBy: { emiseLe: "desc" } });
    expect(numeroDe(n.numero)).toBe(numeroDe(dernierFac.numero!) + 1);
  });

  it("T4 sur T3 tel que le CDC l'écrit (H47, 09/10/2026) : facture YAO payée de 41 000, erreur, avoir, nouvelle facture qui reprend les 41 000", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    const f = await emettreFacture(technique, id, null);
    if (f.statut !== "EMISE") throw new Error("attendu : émise");
    const pay = await enregistrerPaiement(comptable, id, paiement("41 000"), null);
    expect(pay.restantDu).toBe("81442");
    const recu = await obtenirPrisma().documentEmis.findFirstOrThrow({ where: { numero: pay.numeroRecu } });

    // Erreur constatée : avoir, malgré le paiement. La facture est conservée, « Annulée ».
    expect((await lireFacture(comptable, id))!.actions.avoir).toBe(true);
    const av = await emettreAvoir(comptable, id, "Erreur sur la facture (test T4)", null);
    const annulee = (await lireFacture(comptable, id))!;
    expect(annulee).toMatchObject({ statut: "ANNULEE", avoir: { numero: av.numero } });
    expect(annulee.reports).toEqual([{ recu: pay.numeroRecu, date: aujourdhui(), montant: "41000" }]);
    // Le reçu déjà émis reste valable, sans modification.
    expect((await verifierJeton(recu.jeton))!.statut.libelle).not.toMatch(/Annulé/);
    expect(await obtenirPrisma().documentEmis.count({ where: { numero: pay.numeroRecu } })).toBe(1);
    // En attendant la nouvelle facture, la somme est en avance sur la police.
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.disponible).toBe("41000");
    // Session 6.1 (H73, option a) : la somme reportée n'est pas réservée ; les écrans de restitution (police) et d'imputation
    // (facture) la signalent tant que la facture de remplacement n'est pas émise.
    const enAttente = [expect.objectContaining({ factureAnnulee: f.numero, montant: "41000", recu: pay.numeroRecu, avertissement: `Provient de la facture annulée ${f.numero}, en attente de sa facture de remplacement` })];
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.reportsEnAttente).toEqual(enAttente);
    expect(annulee.avance.reportsEnAttente).toEqual(enAttente);

    // Nouvelle facture : numérotée sans trou ; à son émission, les 41 000 sont repris (date, montant, référence d'origine).
    const nouvelle = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    // Un brouillon de remplacement n'a rien repris : l'avertissement reste.
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.reportsEnAttente).toEqual(enAttente);
    const n = await emettreFacture(technique, nouvelle, null);
    if (n.statut !== "EMISE") throw new Error("attendu : émise");
    expect(numeroDe(n.numero)).toBe(numeroDe(f.numero) + 1);
    const v1 = derniere("FACTURE");
    expect(doc(v1)).toMatchObject({ numero: n.numero, version: "v1" });
    expect(v1.donnees.paiements).toEqual([
      expect.objectContaining({ numero: pay.numeroRecu, date: aujourdhui(), montant: "41000", reference: "VIR-INVENTE-001", canal: "Virement", restant_du: "81442" }),
    ]);
    expect(v1.donnees.solde).toEqual({ total_paye: "41000", restant_du: "81442", avance: "0" });
    const lue = (await lireFacture(comptable, nouvelle))!;
    expect(lue.etat).toMatchObject({ totalPaye: "41000", restantDu: "81442" });
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.disponible).toBe("0");
    // Remplaçante émise : plus d'avertissement.
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.reportsEnAttente).toEqual([]);
    expect(lue.avance.reportsEnAttente).toEqual([]);

    // Journal : annulation et report de chaque paiement.
    const annulations = await lireJournal({ action: "FACTURE_ANNULEE" });
    expect(annulations.lignes.some((l) => (l.apres as { numero?: string } | null)?.numero === f.numero)).toBe(true);
    const reports = await lireJournal({ action: "PAIEMENT_REPORTE" });
    expect(reports.lignes.filter((l) => (l.apres as { factureAnnulee?: string } | null)?.factureAnnulee === f.numero).map((l) => (l.apres as { recu: string; montant: string })))
      .toEqual([expect.objectContaining({ recu: pay.numeroRecu, montant: "41000" })]);
    const imputes = await lireJournal({ action: "AVANCE_IMPUTEE" });
    expect(imputes.lignes.some((l) => (l.apres as { facture?: string; origine?: string } | null)?.facture === n.numero)).toBe(true);

    // Une deuxième correction reporte de nouveau les 41 000 (ils sont sur la nouvelle facture), sans double compte.
    await emettreAvoir(comptable, nouvelle, "Deuxième erreur (test T4)", null);
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.disponible).toBe("41000");
    // Seul le nouveau report est signalé : le premier a sa facture de remplacement.
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.reportsEnAttente).toEqual([expect.objectContaining({ factureAnnulee: n.numero, montant: "41000" })]);
    const troisieme = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, troisieme, null);
    expect((await facturesDePolice(comptable, p.cotationId))!.avance.reportsEnAttente).toEqual([]);
    expect((await lireFacture(comptable, troisieme))!.etat).toMatchObject({ totalPaye: "41000", restantDu: "81442" });
  });

  it("paiements reportés supérieurs au TTC de la facture de remplacement : l'excédent reste en avance (H47, H33)", async () => {
    const p = await policeT2();
    const an = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, an, null);
    const ren = await creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null);
    await emettreFacture(technique, ren, null);
    await enregistrerPaiement(comptable, ren, paiement("5000000"), null);
    await emettreAvoir(comptable, ren, "Effectifs erronés (test)", null);
    // Renouvellement corrigé : un seul Solo (TTC 240 000).
    const corrige = await creerFactureRenouvellement(technique, p.policeId, { lignes: [{ codeFormule: "SOLO", effectif: 1 }], nombreTranches: 1, envoyeA: null }, null);
    expect((await lireFacture(technique, corrige))!.remplace).toMatchObject({ id: ren });
    await emettreFacture(technique, corrige, null);
    const lu = (await lireFacture(comptable, corrige))!;
    expect(lu.etat).toMatchObject({ totalPaye: "240000", restantDu: "0" });
    expect(lu.avance.disponible).toBe("4760000");
    expect(derniere("FACTURE").donnees.solde).toEqual({ total_paye: "240000", restant_du: "0", avance: "4760000" });
  });
});

describe("numérotation : sans trou, même sous concurrence", () => {
  it("20 émissions simultanées reçoivent 20 numéros consécutifs", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) {
      const p = await policeT3();
      ids.push(await creerFactureAffaireNouvelle(technique, p.policeId, null, null));
    }
    const resultats = await Promise.all(ids.map((id) => emettreFacture(technique, id, null)));
    const numeros = resultats.map((r) => (r.statut === "EMISE" ? r.numero : "?"));
    expect(new Set(numeros).size).toBe(20);
    const rangs = numeros.map(numeroDe).sort((a, b) => a - b);
    expect(rangs[19] - rangs[0]).toBe(19);
    const enBase = await obtenirPrisma().facture.findMany({ where: { id: { in: ids } }, select: { numero: true } });
    expect(enBase.map((f) => f.numero).sort()).toEqual([...numeros].sort());
  });

  it("une demande « À valider » ne consomme aucun numéro (numéro attribué seulement à l'émission)", async () => {
    const prisma = obtenirPrisma();
    const cle = `FAC-${aujourdhui().slice(0, 4)}`;
    const avant = await prisma.sequence.findUnique({ where: { cle } });
    const p = await policeT3("2026-01-01"); // TTC annuel 274 181 F > seuil 200 000 F
    const id = await creerFactureAffaireNouvelle(gestionnaire, p.policeId, null, null);
    expect((await emettreFacture(gestionnaire, id, null)).statut).toBe("A_VALIDER");
    expect((await prisma.sequence.findUnique({ where: { cle } }))?.valeur).toBe(avant?.valeur);
  });
});

describe("« Oui (sous seuil) » à l'émission d'une facture (H21 fermée, comme les contrats)", () => {
  it("Gestionnaire au-dessus du seuil : « À valider » ; ni lui ni le commercial n'émettent ; la DG et la Comptabilité émettent", async () => {
    const p = await policeT3("2026-01-01");
    const id = await creerFactureAffaireNouvelle(gestionnaire, p.policeId, null, null);
    const lue = (await lireFacture(gestionnaire, id))!;
    expect(lue.actions.emettreSousSeuil).toBe(true);
    const r = await emettreFacture(gestionnaire, id, null);
    expect(r).toMatchObject({ statut: "A_VALIDER", seuil: "200000", demandeePar: gestionnaire.identifiant });
    expect((await lireFacture(gestionnaire, id))!).toMatchObject({ statut: "A_VALIDER", numero: null, demandePar: gestionnaire.identifiant });
    await expect(emettreFacture(gestionnaire, id, null)).rejects.toThrow(/attend déjà sa validation/);
    await expect(emettreFacture(gestionnaire2, id, null)).rejects.toThrow(/attend déjà sa validation/); // autre « sous seuil »
    await expect(emettreFacture(commercial, id, null)).rejects.toThrow(ErreurAcces); // Commercial : aucun droit
    const e = await emettreFacture(dg, id, null); // DG valide (fin écart D21)
    expect(e.statut).toBe("EMISE");
    const journal = (await lireJournal({ action: "FACTURE_EMISE" })).lignes.find((l) => l.objet === `facture ${id}`)!;
    expect(journal.apres).toMatchObject({ validationDemandeePar: gestionnaire.identifiant });
  });

  it("sous le seuil, le Gestionnaire émet lui-même", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(gestionnaire, p.policeId, null, null);
    expect((await emettreFacture(gestionnaire, id, null)).statut).toBe("EMISE"); // 122 442 F < 200 000 F
  });

  it("le demandeur ne valide pas sa propre demande, même si ses droits ont changé depuis", async () => {
    const p = await policeT3("2026-01-01");
    const id = await creerFactureAffaireNouvelle(gestionnaire2, p.policeId, null, null);
    await emettreFacture(gestionnaire2, id, null);
    const promu = { ...gestionnaire2, profil: "TECHNIQUE" as const };
    await expect(emettreFacture(promu, id, null)).rejects.toThrow(/séparation des tâches/);
  });
});

describe("PDF en attente : la facture reste émise, son numéro n'est pas perdu, relance à l'identique", () => {
  it("générateur en panne à l'émission puis relance", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    generateurEnPanne = true;
    let r;
    try {
      r = await emettreFacture(technique, id, null);
    } finally {
      generateurEnPanne = false;
    }
    if (r.statut !== "EMISE") throw new Error("attendu : émise");
    expect(r.productions[0]).toMatchObject({ ok: false, numero: r.numero });
    const lue = (await lireFacture(technique, id))!;
    expect(lue).toMatchObject({ statut: "EMISE", numero: r.numero, pdfEnAttente: 1 });
    expect(lue.documents[0]).toMatchObject({ statut: "EN_ATTENTE", tentatives: 1, derniereErreur: expect.stringMatching(/panne simulée/) });
    expect(await obtenirPrisma().documentEmis.count({ where: { numero: r.numero } })).toBe(0);

    const fige = await obtenirPrisma().documentAProduire.findFirstOrThrow({ where: { factureId: id } });
    const issues = await relancerPdf(technique, id, null);
    expect(issues).toEqual([expect.objectContaining({ ok: true, numero: r.numero, version: 1 })]);
    const d = derniere("FACTURE");
    // À l'identique : mêmes données, même jeton (QR code) que ce qui a été figé à l'émission.
    expect(d.donnees).toEqual(fige.donnees);
    const emis = await obtenirPrisma().documentEmis.findFirstOrThrow({ where: { numero: r.numero } });
    expect(emis.jeton).toBe(fige.jeton);
    expect(emis.chemin).toMatch(/_essai2\.pdf$/);
    expect((await lireFacture(technique, id))!.pdfEnAttente).toBe(0);
    expect((await lireJournal({ action: "PDF_EN_ATTENTE" })).lignes.filter((l) => l.objet === `document ${r.numero} v1`)).toHaveLength(1);
  });

  it("un paiement enregistré pendant que la v1 est en attente produit d'abord la v1, puis le reçu et la v2", async () => {
    const p = await policeT3();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    generateurEnPanne = true;
    try {
      await emettreFacture(technique, id, null);
    } finally {
      generateurEnPanne = false;
    }
    const pay = await enregistrerPaiement(comptable, id, paiement("1000"), null);
    expect(pay.productions.every((x) => x.ok)).toBe(true);
    const f = (await lireFacture(comptable, id))!;
    expect(f.documents.map((x) => [x.type, x.version, x.statut])).toEqual(
      expect.arrayContaining([
        ["FACTURE", 1, "PRODUIT"],
        ["FACTURE", 2, "PRODUIT"],
        ["RECU", 1, "PRODUIT"],
      ]),
    );
  });
});

describe("renouvellement et avenant d'incorporation (H50, H51)", () => {
  it("renouvellement : période suivante, tarif en vigueur, effectifs repris puis modifiables", async () => {
    const p = await policeT2();
    const an = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await expect(creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: null, envoyeA: null }, null)).rejects.toThrow(/émettez-la d'abord/);
    await emettreFacture(technique, an, null);
    const vue = (await facturesDePolice(technique, p.cotationId))!;
    expect(vue.possibles.renouvellement).toEqual({ dateEffet: "2027-01-01", dateEcheance: "2027-12-31" });
    const id = await creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: null, envoyeA: null }, null);
    const r = (await lireFacture(technique, id))!;
    expect(r).toMatchObject({ type: "RENOUVELLEMENT", statut: "BROUILLON", dateEffet: "2027-01-01", dateEcheance: "2027-12-31", ttc: "11592000" });
    expect(r.contenu.echeances).toHaveLength(4);
    await modifierFacture(technique, id, { lignes: [{ codeFormule: "SOLO", effectif: 9 }, { codeFormule: "FAMILLE", effectif: 31 }], nombreTranches: 1, envoyeA: null }, null);
    const m = (await lireFacture(technique, id))!;
    expect(m.ttc).toBe("11832000"); // + 240 000 F (un Solo de plus)
    expect(m.contenu.echeances).toEqual([]);
    await expect(creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: null, envoyeA: null }, null)).rejects.toThrow(/déjà en cours/);
  });

  it("avenant : prime additionnelle au prorata des adhérents incorporés, une seule fois par incorporation", async () => {
    const p = await policeT2();
    const an = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, an, null);
    await incorporerAdherents(gestionnaire, p.policeId, "2026-07-22", [{ nom_prenoms: "Nouvel Adhérent Inventé", date_naissance: "1992-02-02", sexe: "M", lien: "Salarié", formule: "SOLO" }], null);
    const vue = (await facturesDePolice(technique, p.cotationId))!;
    expect(vue.possibles.avenants).toEqual([{ numero: 2, dateEffet: "2026-07-22", adherents: 1 }]);
    const id = await creerFactureAvenant(technique, p.policeId, 2, null, null);
    const f = await emettreFacture(technique, id, null);
    if (f.statut !== "EMISE") throw new Error("attendu : émise");
    const d = derniere("FACTURE");
    expect(d.donnees.police).toMatchObject({ date_effet: "2026-07-22", date_echeance: "2026-12-31", duree_jours: 163 });
    // 236 453,25 × 163/365 = 105 594,44 → 105 594 ; taxe 1,5 % = 1 583,92 → 1 584 ; pas d'accessoires.
    expect(d.donnees.prime).toMatchObject({ nette: "105594", accessoires: "0", taxe: "1584", ttc: "107178" });
    expect((d.donnees.assures as { nom_prenoms: string }[]).map((a) => a.nom_prenoms)).toEqual(["Nouvel Adhérent Inventé"]);
    await expect(creerFactureAvenant(technique, p.policeId, 2, null, null)).rejects.toThrow(/déjà facturée/);
    await expect(creerFactureAvenant(technique, p.policeId, 1, null, null)).rejects.toThrow(/incorporation/);
  });

  // Étape 7 (H126) : même incorporation (un Solo le 22/07/2026, période du 01/01 au 31/12/2026), prorata OUI puis NON.
  // Prime unitaire du Solo dans la période facturée : 236 453,25 F net (voir le test précédent), taxe 1,5 %, pas d'accessoires.
  async function avenantApresIncorporation(prorata: boolean | undefined) {
    const p = await policeT2();
    await emettreFacture(technique, await creerFactureAffaireNouvelle(technique, p.policeId, null, null), null);
    await incorporerAdherents(gestionnaire, p.policeId, "2026-07-22", [{ nom_prenoms: "Nouvel Adhérent Inventé", date_naissance: "1992-02-02", sexe: "M", lien: "Salarié", formule: "SOLO" }], null);
    const id = prorata === undefined ? await creerFactureAvenant(technique, p.policeId, 2, null, null) : await creerFactureAvenant(technique, p.policeId, 2, null, null, prorata);
    return { p, id };
  }

  it("avenant, prorata temporis OUI : 163 jours sur 365 (choix explicite ou par défaut)", async () => {
    const { id } = await avenantApresIncorporation(true);
    const lu = (await lireFacture(technique, id))!;
    expect(lu.prorataAvenant).toBe(true);
    // 236 453,25 × 163/365 = 105 594,44 → 105 594 ; taxe 1,5 % = 1 583,92 → 1 584 ; TTC 107 178.
    expect(lu.contenu.totaux).toMatchObject({ nette: "105594", accessoires: "0", taxe: "1584", ttc: "107178" });
    const parDefaut = await avenantApresIncorporation(undefined);
    expect((await lireFacture(technique, parDefaut.id))!).toMatchObject({ prorataAvenant: true, ttc: "107178" });
  });

  it("avenant, prorata temporis NON : prime entière de la période, figée, journalisée et reprise par la réédition", async () => {
    const { id } = await avenantApresIncorporation(false);
    const lu = (await lireFacture(technique, id))!;
    expect(lu.prorataAvenant).toBe(false);
    // 236 453,25 × 1 = 236 453,25 → 236 453 ; taxe 1,5 % = 3 546,80 → 3 547 ; TTC 240 000 (le même Solo qu'un renouvellement complet).
    expect(lu.contenu.totaux).toMatchObject({ nette: "236453", accessoires: "0", taxe: "3547", ttc: "240000" });
    expect(lu.contenu.joursCouverts).toBe(163); // la période reste celle de l'incorporation ; seul le montant ne se réduit pas
    const creation = (await lireJournal({ action: "FACTURE_CREEE" })).lignes.find((l) => l.objet === `facture ${id}`)!;
    expect(creation.apres).toMatchObject({ type: "AVENANT", prorata: false, ttc: "240000" });

    const e = await emettreFacture(technique, id, null);
    if (e.statut !== "EMISE") throw new Error("attendu : émise");
    const v1 = derniere("FACTURE");
    expect(v1.donnees.prime).toMatchObject({ nette: "236453", accessoires: "0", taxe: "3547", ttc: "240000" });
    const emission = (await lireJournal({ action: "FACTURE_EMISE" })).lignes.find((l) => l.objet === `facture ${id}`)!;
    expect(emission.apres).toMatchObject({ type: "AVENANT", prorata: false, ttc: "240000" });

    // Une réédition (à chaque paiement, H55) reprend le contenu figé : même prime, aucun recalcul au prorata.
    await enregistrerPaiement(comptable, id, paiement("40 000"), null);
    const v2 = derniere("FACTURE");
    expect(doc(v2).version).toBe("v2");
    expect(v2.donnees.prime).toEqual(v1.donnees.prime);
    expect((await lireFacture(technique, id))!.prorataAvenant).toBe(false);
  });

  it("une facture qui n'est pas un avenant calculé n'a pas de prorata d'avenant", async () => {
    const p = await policeT2();
    const id = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    expect((await lireFacture(technique, id))!.prorataAvenant).toBeNull();
  });
});

describe("formats des numéros (paramétrables, historisés, journalisés)", () => {
  it("un format invalide est refusé ; un nouveau format est historisé avec l'ancien dans le journal", async () => {
    await expect(enregistrerFormatNumero(technique, "FAC", "FAC-{NNNN}", "2099-01-01", null)).rejects.toThrow(/AAAA/);
    await expect(enregistrerFormatNumero(technique, "XYZ", "X-{AAAA}-{NNNN}", "2099-01-01", null)).rejects.toThrow(/inconnu/);
    await expect(enregistrerFormatNumero(gestionnaire, "FAC", "F-{AAAA}-{NNNNN}", "2099-01-01", null)).rejects.toThrow(ErreurAcces);
    const date = `2099-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
    await enregistrerFormatNumero(technique, "REC", "RC/{AAAA}/{NNNNNN}", date, null);
    const formats = await consulterFormatsNumero(comptable);
    const rec = formats.find((f) => f.prefixe === "REC")!;
    expect(rec.historique.some((h) => h.valeur === "RC/{AAAA}/{NNNNNN}" && h.dateEffet === date)).toBe(true);
    expect(formats.find((f) => f.prefixe === "FAC")!.exemple).toMatch(/^FAC-\d{4}-\d{2}-0001$/);
    const j = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.find((l) => l.objet === "parametre numerotation.format.REC")!;
    // « avant » : le format en vigueur à cette date (le défaut, ou celui d'une exécution précédente sur la même base de test).
    expect(j.apres).toMatchObject({ formatNumero: "REC", avant: expect.stringMatching(/\{AAAA\}/), apres: "RC/{AAAA}/{NNNNNN}", dateEffet: date });
  });
});

describe("session 6.2a : un produit tarifé par garanties ne produit aucune facture calculée", () => {
  it("le renouvellement (création, recalcul, émission) est refusé dès que la version en vigueur à sa date d'effet est en mode GARANTIES ; l'affaire nouvelle d'une police figée reste facturable (T10)", async () => {
    const code = CODE("SW");
    const branche = await assurerBranche(`SANTE_${code}`);
    await creerTaxe(technique, { branche, typeContrat: "INDIVIDUEL", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerProduit(technique, { code, libelle: "Bascule en garanties (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche }, null);
    // Mêmes conditions générales que les autres produits du fichier (l'émission des CP exige le visa des CG jointes).
    const references = (await listerVersions(technique, produitIndividuel))!.versions[0].references;
    await creerVersion(
      technique,
      code,
      {
        dateEffet: "2020-01-01",
        references,
        arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
        prorata: { actif: true, primeMinimale: null },
        fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
        cotation: { validiteMois: 3, formulesMax: 3 },
        seuilValidationTtc: null,
        formules: [{ code: "F", libelle: "Formule unique", tauxCouverture: null, primeUnitaire: "100000", accessoireMode: "AUCUN", accessoireValeur: "0" }],
      },
      null,
    );
    await publier("CP", code, analyse(CONTENU_CP));
    const saisieSw = {
      codeProduit: code,
      typeContrat: "INDIVIDUEL" as const,
      souscripteur: { type: "PHYSIQUE" as const, nom: "ZADI", prenoms: "Awa (inventée)", raison_sociale: "", telephone: "0700000000", email: "", adresse: "Cocody, rue inventée" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      nombreTranches: 1,
      lignes: [{ codeFormule: "F", effectif: 1 }],
      assures: [],
    };
    // Deux polices acceptées sous la version à la formule, CP émises. Le renouvellement de A se prépare avant la bascule (100 000 + taxe 1,5 % = 101 500).
    const [a, b] = [await police(saisieSw, ["F"]), await police(saisieSw, ["F"])];
    const anA = await creerFactureAffaireNouvelle(technique, a.policeId, null, null);
    expect((await emettreFacture(technique, anA, null)).statut).toBe("EMISE");
    const renA = await creerFactureRenouvellement(technique, a.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null);
    expect((await lireFacture(technique, renA))!.ttc).toBe("101500");

    // La Technique passe le produit en GARANTIES à compter du 01/01/2027, date d'effet des renouvellements.
    await creerVersion(
      technique,
      code,
      {
        dateEffet: "2027-01-01",
        modeTarification: "GARANTIES",
        arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
        prorata: { actif: true, primeMinimale: null },
        fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
        cotation: { validiteMois: 3, formulesMax: 3 },
        seuilValidationTtc: null,
        formules: [{ code: "F", libelle: "Formule de forme (sans tarif)", tauxCouverture: null, primeUnitaire: "0", accessoireMode: "AUCUN", accessoireValeur: "0" }],
      },
      null,
    );

    // T10 : la police B, figée sous la version à la formule, se facture et s'émet encore (101 500, montants de sa cotation).
    const anB = await creerFactureAffaireNouvelle(technique, b.policeId, null, null);
    expect((await emettreFacture(technique, anB, null)).statut).toBe("EMISE");
    expect((await lireFacture(technique, anB))!).toMatchObject({ statut: "EMISE", ttc: "101500" });

    // Le renouvellement de B ne se crée plus ; le brouillon de A ne se recalcule plus et ne s'émet plus.
    await expect(creerFactureRenouvellement(technique, b.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null)).rejects.toThrow(MESSAGE_RENOUVELLEMENT_GARANTIES);
    expect(await obtenirPrisma().facture.count({ where: { policeId: b.policeId, type: "RENOUVELLEMENT" } })).toBe(0);
    await expect(modifierFacture(technique, renA, { lignes: [{ codeFormule: "F", effectif: 2 }], nombreTranches: 1, envoyeA: null }, null)).rejects.toThrow(MESSAGE_RENOUVELLEMENT_GARANTIES);
    await expect(emettreFacture(technique, renA, null)).rejects.toThrow(MESSAGE_TARIFICATION_PAR_GARANTIES);
    const restee = (await lireFacture(technique, renA))!;
    expect(restee).toMatchObject({ statut: "BROUILLON", ttc: "101500" });
    expect(restee.numero).toBeNull();
    await expect(emettreFacture(technique, renA, null)).rejects.toThrow(/Abandonner le brouillon/);

    // H87 : le brouillon bloqué s'abandonne (motif obligatoire, définitif, aucun numéro consommé).
    await abandonnerFacture(technique, renA, "Produit passé en garanties avant l'émission", null);
    expect(await lireFacture(technique, renA)).toMatchObject({ statut: "ABANDONNEE", numero: null, abandon: { par: technique.identifiant, motif: "Produit passé en garanties avant l'émission" } });
  });
});

const TAGS_GARANTIES = ["libelle", "branche", "prime_nette", "accessoires", "taux_taxe", "taxe", "ttc"].map((c) => `garanties_souscrites[].${c}`);

/** Modèle de facture d'un produit par garanties : il cite `garanties_souscrites[]` (une ligne par garantie, avec son taux). */
const publierFactureGaranties = (code: string) =>
  publier("FACTURE", code, analyse([...CONTENU_FACTURE, ...TAGS_GARANTIES], { filtres: ["lettres"], textes: ["Article 13 du Code CIMA : la prise d'effet est subordonnée au paiement de la prime."] }));

describe("session 6.2b : produit par garanties, de la cotation composée à la facture", () => {
  async function produitParGaranties(options: { factureDuProduit?: boolean; cpAvecGaranties?: boolean; seuilValidationTtc?: number | null } = {}): Promise<{ code: string; incendie: string; iard: string }> {
    const code = CODE("GPR");
    const incendie = (await assurerBranche(`INC_${code}`)).slice(0, 28);
    const iard = (await assurerBranche(`IARD_${code}`)).slice(0, 28);
    await creerTaxe(technique, { branche: incendie, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerTaxe(technique, { branche: iard, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerProduit(technique, { code, libelle: "SECURPRO (produit de test par garanties)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: iard }, null);
    const references = (await listerVersions(technique, produitIndividuel))!.versions[0].references;
    if (options.seuilValidationTtc != null) {
      await obtenirPrisma().parametre.upsert({
        where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2020-01-01T00:00:00.000Z") } },
        update: { valeur: String(options.seuilValidationTtc) },
        create: { cle: "seuil_validation_global", valeur: String(options.seuilValidationTtc), dateEffet: new Date("2020-01-01T00:00:00.000Z"), creePar: "test" },
      });
    }
    await creerVersion(
      technique,
      code,
      {
        dateEffet: "2020-01-01",
        modeTarification: "GARANTIES",
        references,
        arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
        prorata: { actif: false, primeMinimale: null },
        fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
        cotation: { validiteMois: 3, formulesMax: 3 },
        seuilValidationTtc: options.seuilValidationTtc != null ? String(options.seuilValidationTtc) : null,
        formules: [],
        garanties: [{ libelle: "Incendie", branche: incendie }],
      },
      null,
    );
    // Les modèles du produit citent les champs `garanties_souscrites[]` : le dictionnaire les connaît, sinon le dépôt serait refusé (T9).
    await publier("CP", code, analyse(options.cpAvecGaranties === false ? CONTENU_CP : [...CONTENU_CP, ...TAGS_GARANTIES]));
    if (options.factureDuProduit !== false) await publierFactureGaranties(code);
    return { code, incendie, iard };
  }

  /** Police d'un produit par garanties : cotation créée par le Commercial, prime composée par la Technique, soumise, acceptée, CP émises. */
  async function policeGaranties(p: { code: string; incendie: string; iard: string }, typeContrat: "INDIVIDUEL" | "GROUPE" = "INDIVIDUEL", options: { emettreLesCp?: boolean; montantGarantiIncendie?: string } = {}) {
    const id = await creerBrouillon(commercial, {
      codeProduit: p.code,
      clientId: null,
      typeContrat,
      souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE SA", telephone: "", email: "", adresse: "Plateau, rue inventée" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      nombreTranches: 2,
      lignes: [],
      motifForcage: null,
      assures: typeContrat === "GROUPE" ? [assure(1, ""), assure(2, "")] : [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
    }, null);
    await composerLaPrime(
      technique,
      id,
      [
        { libelle: "Incendie", branche: p.incendie, ...(options.montantGarantiIncendie ? { montantGaranti: options.montantGarantiIncendie } : {}), primeNette: "10000", accessoires: "2500" },
        { libelle: "Vol", branche: p.iard, primeNette: "9850", accessoires: "2500" },
        { libelle: "Dégât des eaux", branche: p.iard, primeNette: "6000", accessoires: "2500" },
      ],
      "Simulateur de la Technique (chiffres inventés)",
      null,
    );
    const s = await soumettre(commercial, id, null);
    if (s.statut === "A_VALIDER") {
      await valider(techniqueValideur, id, null);
    }
    const { numeroPolice: numero } = await accepter(commercial, id, [], numeroPolice(), null);
    if (options.emettreLesCp !== false) await emettreCp(technique, id, null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
    return { cotationId: id, policeId: police.id, numero };
  }

  it("CP et facture : une ligne par garantie avec son taux, prime.* = somme des lignes, taux unique vide, formules vide ; mêmes montants partout", async () => {
    const p = await produitParGaranties();
    const pol = await policeGaranties(p);

    // CP : mêmes données que la facture.
    const cp = derniere("CP");
    expect((cp.donnees.garanties_souscrites as unknown[]).length).toBe(3);
    expect(cp.donnees.formules).toEqual([]);
    expect(cp.donnees.prime).toMatchObject({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424" });

    // T10 : la Technique relève le taux de l'incendie (15 %, branche propre à ce produit) APRÈS l'émission des CP : la facture reprend la
    // composition figée de la police, ses taux et ses montants, au caractère près.
    await creerTaxe(technique, { branche: p.incendie, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "15", assiette: "NETTE_ACCESSOIRES", dateEffet: "2025-06-01", dateFin: null }, null);
    const id = await creerFactureAffaireNouvelle(technique, pol.policeId, null, null);
    expect((await emettreFacture(technique, id, null)).statut).toBe("EMISE");
    const d = derniere("FACTURE");
    expect(d.donnees.garanties_souscrites).toEqual(cp.donnees.garanties_souscrites);
    expect(d.donnees.prime).toMatchObject({ taxe: "3074", ttc: "36424" });
    // Incendie : (10 000 + 2 500) × 12,5 % = 1 562,5 → 1 563 ; Vol : 895 ; Dégât des eaux : 616 ; TTC 14 063 + 13 245 + 9 116 = 36 424.
    expect(d.donnees.garanties_souscrites).toEqual([
      { libelle: "Incendie", branche: p.incendie, prime_nette: "10000", accessoires: "2500", montant_garanti: null, taux_taxe: "12.5", taxe: "1563", ttc: "14063" },
      { libelle: "Vol", branche: p.iard, prime_nette: "9850", accessoires: "2500", montant_garanti: null, taux_taxe: "7.25", taxe: "895", ttc: "13245" },
      { libelle: "Dégât des eaux", branche: p.iard, prime_nette: "6000", accessoires: "2500", montant_garanti: null, taux_taxe: "7.25", taxe: "616", ttc: "9116" },
    ]);
    // Plusieurs taux : prime.taux_taxe est vide (facultatif) ; la base de la taxe est la somme des bases des lignes (25 850 + 7 500).
    expect(d.donnees.prime).toMatchObject({ nette: "25850", accessoires: "7500", base_taxe: "33350", taux_taxe: null, taxe: "3074", ttc: "36424" });
    expect(d.donnees.formules).toEqual([]);
    // Fractionnement inchangé, appliqué au TTC total : 2 × 18 212.
    expect(d.donnees.echeances).toEqual([1, 2].map((n) => expect.objectContaining({ numero: n, montant: "18212" })));
    const lue = (await lireFacture(technique, id))!;
    expect(lue).toMatchObject({ statut: "EMISE", ttc: "36424" });
    expect(lue.contenu.garanties).toHaveLength(3);

    // L'avoir reprend les lignes en négatif.
    await emettreAvoir(technique, id, "Erreur sur la facture (avoir de test)", null);
    const avoir = derniere("AVOIR");
    expect((avoir.donnees.garanties_souscrites as { ttc: string }[]).map((g) => g.ttc)).toEqual(["-14063", "-13245", "-9116"]);
    expect(avoir.donnees.prime).toMatchObject({ nette: "-25850", taxe: "-3074", ttc: "-36424" });
  });

  it("un seul taux dans toute la composition : prime.taux_taxe est rempli", async () => {
    const p = await produitParGaranties();
    const id = await creerBrouillon(commercial, {
      codeProduit: p.code, clientId: null, typeContrat: "INDIVIDUEL",
      souscripteur: { type: "PHYSIQUE", nom: "ZADI", prenoms: "Awa (inventée)", raison_sociale: "", telephone: "", email: "", adresse: "Cocody, rue inventée" },
      dateEffet: "2026-01-01", dateEcheance: "2026-12-31", nombreTranches: 1, lignes: [], motifForcage: null, assures: [], beneficiaires: [], contactsUrgence: [], risque: {},
    }, null);
    await composerLaPrime(technique, id, [{ libelle: "Vol", branche: p.iard, primeNette: "9850", accessoires: "2500" }], "Une seule garantie (inventée)", null);
    await soumettre(commercial, id, null);
    const { numeroPolice: numero } = await accepter(commercial, id, [], numeroPolice(), null);
    await emettreCp(technique, id, null);
    const pol = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
    const fid = await creerFactureAffaireNouvelle(technique, pol.id, null, null);
    await emettreFacture(technique, fid, null);
    expect(derniere("FACTURE").donnees.prime).toMatchObject({ taux_taxe: "7.25", taxe: "895", ttc: "13245" });
  });

  it("la facture d'un produit par garanties ne s'émet pas avec un modèle qui ne détaille pas les garanties (ici le modèle commun) : refus avant tout numéro ; elle s'émet avec le modèle du produit", async () => {
    // Le produit n'a pas de modèle de facture propre : c'est le modèle commun (fait pour les produits à la formule, sans garanties_souscrites[]) qui serait retenu.
    const p = await produitParGaranties({ factureDuProduit: false });
    const pol = await policeGaranties(p);
    const temoin = await emettreFacture(technique, await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null), null);
    if (temoin.statut !== "EMISE") throw new Error("attendu : émise");

    const id = await creerFactureAffaireNouvelle(technique, pol.policeId, null, null);
    await expect(emettreFacture(technique, id, null)).rejects.toThrow(/ne détaille pas les garanties/);
    expect(await lireFacture(technique, id)).toMatchObject({ statut: "BROUILLON", numero: null });

    // Après la publication du modèle du produit, la même facture s'émet ; aucun numéro n'avait été consommé par le refus.
    await publierFactureGaranties(p.code);
    const r = await emettreFacture(technique, id, null);
    if (r.statut !== "EMISE") throw new Error("attendu : émise");
    expect(numeroDe(r.numero)).toBe(numeroDe(temoin.numero) + 1);
    expect(derniere("FACTURE").donnees.garanties_souscrites).toHaveLength(3);
  });

  it("les CP d'un produit par garanties ne s'émettent pas avec un modèle qui ne détaille pas les garanties (aucun CP n'est émis) ; avec le modèle des garanties, ils s'émettent", async () => {
    const sansDetail = await produitParGaranties({ cpAvecGaranties: false });
    const pol = await policeGaranties(sansDetail, "INDIVIDUEL", { emettreLesCp: false });
    await expect(emettreCp(technique, pol.cotationId, null)).rejects.toThrow(/ne détaille pas les garanties/);
    expect(await obtenirPrisma().documentEmis.count({ where: { policeId: pol.policeId, type: "CP" } })).toBe(0);

    const avecDetail = await produitParGaranties();
    const pol2 = await policeGaranties(avecDetail, "INDIVIDUEL", { emettreLesCp: false });
    await emettreCp(technique, pol2.cotationId, null);
    expect(derniere("CP").donnees.garanties_souscrites).toHaveLength(3);
  });

  it("session 6.2c-1 (H90) : renouvellement d'une police par garanties (reprise N, taux N+1 résolus, confirmation obligatoire, montant garanti)", async () => {
    const p = await produitParGaranties();
    const pol = await policeGaranties(p, "GROUPE", { montantGarantiIncendie: "5000000" });
    const anId = await creerFactureAffaireNouvelle(technique, pol.policeId, null, null);
    await emettreFacture(technique, anId, null);

    // Taux N+1 inventé pour la branche Incendie (effet au 01/01/2027) : 14 % au lieu de 12.5 %
    await creerTaxe(
      technique,
      {
        branche: p.incendie,
        typeContrat: null,
        tauxMixte: false,
        commentaire: "Changement de taux N+1 (test inventé)",
        tauxPourcent: "14",
        assiette: "NETTE_ACCESSOIRES",
        dateEffet: "2027-01-01",
        dateFin: null,
      },
      null,
    );

    // 1. Préparation du renouvellement : brouillon arrive à « À composer — composition précédente proposée »
    const renId = await creerFactureRenouvellement(technique, pol.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null);
    const lu = (await lireFacture(technique, renId))!;
    expect(lu.statut).toBe("BROUILLON");
    expect(lu.libelleStatut).toBe("À composer — composition précédente proposée");
    expect(lu.actions.emettre).toBe(false);
    expect(lu.actions.composer).toBe(true);

    // Lignes reprises : montant garanti, libellé, branche, prime nette, accessoires
    const lignes = lu.contenu.garanties!;
    expect(lignes).toHaveLength(3);
    expect(lignes[0].libelle).toBe("Incendie");
    expect(lignes[0].montantGaranti).toBe("5000000");
    expect(lignes[0].nette).toBe("10000");
    expect(lignes[0].accessoires).toBe("2500");
    // H93 : taux de taxe de l'année N+1 résolu à la date d'effet (14 % au lieu de 12.5 %)
    expect(lignes[0].tauxTaxe).toBe("14");
    // 12 500 * 14 % = 1 750 (au lieu de 12 500 * 12.5 % = 1 563)
    expect(lignes[0].taxe).toBe("1750");

    // 2. Émission refusée tant que la Technique n'a pas confirmé la composition
    await expect(emettreFacture(technique, renId, null)).rejects.toThrow(/doit être confirmée par la Technique/);

    // 3. Confirmation sans motif ou motif trop court refusée
    const lignesSaisies = (lu.composition?.lignes ?? []).map((l) => ({
      libelle: l.libelle,
      branche: l.branche,
      montantGaranti: l.montantGaranti ?? null,
      primeNette: l.primeNette,
      accessoires: l.accessoires,
    }));
    await expect(composerFacture(technique, renId, lignesSaisies, "  ", null)).rejects.toThrow(/motif.*obligatoire/i);
    await expect(composerFacture(technique, renId, lignesSaisies, "ab", null)).rejects.toThrow(/3 caractères/);

    // Droit requis : le Commercial ne peut pas composer
    await expect(composerFacture(commercial, renId, lignesSaisies, "Motif valide de test", null)).rejects.toThrow(ErreurAcces);

    // 4. Confirmation par la Technique avec motif obligatoire
    const compRes = await composerFacture(technique, renId, lignesSaisies, "Reconduction conforme pour l'exercice 2027", null);
    expect(Number(compRes.ttc)).toBeGreaterThan(0);

    const luApres = (await lireFacture(technique, renId))!;
    expect(luApres.statut).toBe("BROUILLON");
    expect(luApres.libelleStatut).toBe("Brouillon");
    expect(luApres.actions.emettre).toBe(true);
    expect(luApres.composition).toMatchObject({
      composePar: technique.identifiant,
      motif: "Reconduction conforme pour l'exercice 2027",
    });

    // Journal d'audit FACTURE_COMPOSEE
    const auditComp = (await lireJournal({ action: "FACTURE_COMPOSEE" })).lignes.find((l) => l.objet === `facture ${renId}`);
    expect(auditComp).toBeDefined();

    // 5. Émission réussie
    const emise = await emettreFacture(technique, renId, null);
    expect(emise.statut).toBe("EMISE");
    if (emise.statut === "EMISE") {
      expect(emise.numero).toMatch(/^FAC-\d{4}-\d{2}-\d{4}$/);
    }

    // 6. Données du document PDF : garanties_souscrites[] avec montant_garanti
    const d = derniere("FACTURE");
    expect(d.donnees.garanties_souscrites).toHaveLength(3);
    const g1 = (d.donnees.garanties_souscrites as Record<string, unknown>[])[0];
    expect(g1.libelle).toBe("Incendie");
    expect(g1.montant_garanti).toBe("5000000");
  });

  it("session 6.2c-1 (H90) : avenant d'incorporation sur une police par garanties (sans montant, composition manuelle, pas de prorata)", async () => {
    const p = await produitParGaranties();
    const pol = await policeGaranties(p, "GROUPE");
    const anId = await creerFactureAffaireNouvelle(technique, pol.policeId, null, null);
    await emettreFacture(technique, anId, null);

    // Incorporation de 3 adhérents
    await incorporerAdherents(
      gestionnaire,
      pol.policeId,
      "2026-07-22",
      [
        { nom_prenoms: "Adhérent Un", date_naissance: "1990-01-01", sexe: "M", lien: "Salarié", formule: "" },
        { nom_prenoms: "Adhérent Deux", date_naissance: "1991-02-02", sexe: "F", lien: "Conjoint", formule: "" },
        { nom_prenoms: "Adhérent Trois", date_naissance: "2015-03-03", sexe: "M", lien: "Enfant", formule: "" },
      ],
      null,
    );
    const vue = (await facturesDePolice(technique, pol.cotationId))!;
    const incorporation = vue.possibles.avenants[0];
    expect(incorporation.adherents).toBe(3);

    // 1. Préparation de l'avenant : brouillon sans montant, état « À composer »
    // Étape 7 : le choix du prorata est sans objet pour un produit par garanties (composition manuelle), même demandé « Non ».
    const avenantId = await creerFactureAvenant(technique, pol.policeId, incorporation.numero, null, null, false);
    const lu = (await lireFacture(technique, avenantId))!;
    expect(lu.prorataAvenant).toBeNull();
    expect(lu.statut).toBe("BROUILLON");
    expect(lu.libelleStatut).toBe("À composer");
    expect(lu.ttc).toBe("0");
    expect(lu.contenu.garanties).toHaveLength(0);
    expect(lu.actions.emettre).toBe(false);
    expect(lu.actions.composer).toBe(true);

    // 2. Émission refusée tant qu'elle n'est pas composée
    await expect(emettreFacture(technique, avenantId, null)).rejects.toThrow(/doit être composée par la Technique/);

    // 3. Composition de la prime additionnelle par la Technique
    await composerFacture(
      technique,
      avenantId,
      [
        { libelle: "Extension Incendie 3 adhérents", branche: p.incendie, primeNette: "12000", accessoires: "0" },
        { libelle: "Extension Vol 3 adhérents", branche: p.iard, primeNette: "8000", accessoires: "0" },
      ],
      "Prime additionnelle pour l'incorporation de 3 bénéficiaires",
      null,
    );

    const luApres = (await lireFacture(technique, avenantId))!;
    expect(luApres.statut).toBe("BROUILLON");
    expect(luApres.libelleStatut).toBe("Brouillon");
    expect(Number(luApres.ttc)).toBeGreaterThan(0);
    expect(luApres.actions.emettre).toBe(true);

    // 4. Émission réussie
    const emise = await emettreFacture(technique, avenantId, null);
    expect(emise.statut).toBe("EMISE");
    const d = derniere("FACTURE");
    expect(d.donnees.garanties_souscrites).toHaveLength(2);
  });

  it("session 6.2c-1 (H95) : séparation des tâches à la validation d'une facture (auteur, demandeur, composeur exclus)", async () => {
    // Créons un deuxième utilisateur Technique pour valider
    const technique2 = await (async () => {
      const identifiant = unique("technique-2");
      await creerUtilisateur(admin, { identifiant, nom: "Technique Deux", profil: "TECHNIQUE", motDePasse: MDP }, null);
      return compte(identifiant);
    })();

    // Produit par garanties avec seuil bas pour déclencher « À valider » (seuil 5 000 TTC)
    const p = await produitParGaranties({ seuilValidationTtc: 5000 });
    const pol = await policeGaranties(p);
    const anId = await creerFactureAffaireNouvelle(technique, pol.policeId, null, null);
    await emettreFacture(technique, anId, null);

    // Renouvellement créé par le gestionnaire (qui n'a pas le droit de composer)
    const renId = await creerFactureRenouvellement(gestionnaire, pol.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null);

    // Prime composée par le premier utilisateur Technique
    const lu = (await lireFacture(technique, renId))!;
    const lignes = (lu.composition?.lignes ?? []).map((l) => ({
      libelle: l.libelle,
      branche: l.branche,
      primeNette: l.primeNette,
      accessoires: l.accessoires,
    }));
    await composerFacture(technique, renId, lignes, "Composition exercice suivant", null);

    // Le gestionnaire demande la validation (TTC > seuil 5 000)
    const demande = await emettreFacture(gestionnaire, renId, null);
    expect(demande.statut).toBe("A_VALIDER");

    // Séparation des tâches :
    // 1. Le demandeur / auteur ne peut pas valider (même promu avec les droits de validation)
    const demandeurHabilite = { ...gestionnaire, profil: "TECHNIQUE" as const };
    await expect(emettreFacture(demandeurHabilite, renId, null)).rejects.toThrow(/séparation des tâches/);
    await expect(emettreFacture(gestionnaire, renId, null)).rejects.toThrow(/attend déjà sa validation/);
    // 2. Le composeur (technique) ne peut pas valider
    await expect(emettreFacture(technique, renId, null)).rejects.toThrow(/séparation des tâches/);
    // 3. Un autre valideur habilité (technique2) PEUT valider
    const emise = await emettreFacture(technique2, renId, null);
    expect(emise.statut).toBe("EMISE");
  });
});

describe("session 6.2b : abandon d'un brouillon de facture (H87)", () => {
  it("motif obligatoire, journalisé, définitif, aucun numéro consommé : la facture suivante porte le numéro qui suit la dernière émise", async () => {
    const prisma = obtenirPrisma();
    const premiere = await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null);
    const emise = await emettreFacture(technique, premiere, null);
    if (emise.statut !== "EMISE") throw new Error("attendu : émise");

    const brouillon = await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null);
    expect((await lireFacture(technique, brouillon))!.actions.abandonner).toBe(true);
    await expect(abandonnerFacture(technique, brouillon, "  ", null)).rejects.toThrow(/Motif de l'abandon obligatoire/);
    await expect(abandonnerFacture(technique, brouillon, "abc", null)).rejects.toThrow(/Motif de l'abandon obligatoire/);
    await expect(abandonnerFacture(commercial, brouillon, "Doublon de saisie", null)).rejects.toThrow(ErreurAcces);
    expect((await lireFacture(technique, brouillon))!.statut).toBe("BROUILLON");

    await abandonnerFacture(technique, brouillon, "Doublon de saisie (test)", null);
    const abandonnee = (await lireFacture(technique, brouillon))!;
    expect(abandonnee).toMatchObject({ statut: "ABANDONNEE", numero: null, libelleStatut: "Abandonnée", abandon: { par: technique.identifiant, motif: "Doublon de saisie (test)" } });
    expect(abandonnee.actions).toMatchObject({ abandonner: false, modifier: false, emettre: false });
    const journal = (await lireJournal({ action: "FACTURE_ABANDONNEE" })).lignes.find((l) => l.objet === `facture ${brouillon}`)!;
    expect(journal.avant).toMatchObject({ statut: "BROUILLON", type: "AFFAIRE_NOUVELLE" });
    expect(journal.apres).toMatchObject({ statut: "ABANDONNEE", motif: "Doublon de saisie (test)" });

    // Définitif : ni nouvel abandon, ni émission, ni modification ; la base l'impose aussi.
    await expect(abandonnerFacture(technique, brouillon, "Encore un abandon", null)).rejects.toThrow(/déjà abandonné/);
    await expect(emettreFacture(technique, brouillon, null)).rejects.toThrow(/déjà abandonnée/);
    await expect(modifierFacture(technique, brouillon, { lignes: null, nombreTranches: null, envoyeA: null }, null)).rejects.toThrow(/abandonné/);
    expect(await sql(`UPDATE factures SET statut = 'BROUILLON' WHERE id = ${brouillon}`)).toMatch(/abandonnée/);
    expect(await sql(`DELETE FROM factures WHERE id = ${brouillon}`)).toMatch(/suppression interdite/);

    // Aucun numéro consommé : la facture suivante prend le numéro qui suit celui de la dernière émise.
    const suivante = await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null);
    const s2 = await emettreFacture(technique, suivante, null);
    if (s2.statut !== "EMISE") throw new Error("attendu : émise");
    expect(numeroDe(s2.numero)).toBe(numeroDe(emise.numero) + 1);
    // Aucune facture abandonnée ne porte de numéro : la base l'impose (voir le test des gardes SQL ci-dessous), ce n'est pas un résultat du hasard.
    expect(await prisma.facture.count({ where: { statut: "ABANDONNEE" } })).toBeGreaterThan(0);
  });

  it("une facture émise, un avoir ne s'abandonnent pas ; une demande « À valider » s'abandonne", async () => {
    const emise = await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null);
    await emettreFacture(technique, emise, null);
    await expect(abandonnerFacture(technique, emise, "Facture émise à tort", null)).rejects.toThrow(/Seul un brouillon/);
    const { avoirId } = await emettreAvoir(technique, emise, "Erreur de saisie (avoir de test)", null);
    await expect(abandonnerFacture(technique, avoirId, "Un avoir ne s'abandonne pas", null)).rejects.toThrow(/avoir/);

    const p = await policeT3("2026-01-01"); // TTC annuel 274 181 F > seuil 200 000 F
    const demande = await creerFactureAffaireNouvelle(gestionnaire, p.policeId, null, null);
    expect((await emettreFacture(gestionnaire, demande, null)).statut).toBe("A_VALIDER");
    await abandonnerFacture(gestionnaire, demande, "La souscription est annulée (test)", null);
    expect((await lireFacture(gestionnaire, demande))!).toMatchObject({ statut: "ABANDONNEE", numero: null });
  });

  it("une demande « À valider » d'un autre ne s'abandonne que par son demandeur ou par un profil qui peut décider ; un brouillon, par n'importe quel profil qui peut le modifier", async () => {
    const p = await policeT3("2026-01-01"); // TTC annuel 274 181 F > seuil 200 000 F
    const demande = await creerFactureAffaireNouvelle(gestionnaire, p.policeId, null, null);
    expect((await emettreFacture(gestionnaire, demande, null)).statut).toBe("A_VALIDER");

    // Un second gestionnaire (« Oui sous seuil ») ne peut ni émettre ni valider cette demande : il ne la détruit pas non plus.
    expect((await lireFacture(gestionnaire2, demande))!.actions).toMatchObject({ abandonner: false, emettre: false });
    await expect(abandonnerFacture(gestionnaire2, demande, "Je n'en veux pas (test)", null)).rejects.toThrow(/demandeur/);
    expect((await lireFacture(technique, demande))!.statut).toBe("A_VALIDER");
    // Un profil qui peut décider (Technique, « Oui ») l'abandonne.
    expect((await lireFacture(technique, demande))!.actions.abandonner).toBe(true);
    await abandonnerFacture(technique, demande, "Demande sans suite après vérification (test)", null);
    expect((await lireFacture(technique, demande))!).toMatchObject({ statut: "ABANDONNEE", numero: null });

    // Le brouillon (non soumis) d'un gestionnaire s'abandonne par un autre gestionnaire.
    const brouillon = await creerFactureAffaireNouvelle(gestionnaire, (await policeT3()).policeId, null, null);
    await abandonnerFacture(gestionnaire2, brouillon, "Doublon de saisie (test)", null);
    expect((await lireFacture(gestionnaire, brouillon))!.statut).toBe("ABANDONNEE");
  });

  it("la base refuse les abandons incohérents, même en SQL : facture émise, sans motif, motif trop court, numéro conservé ; le brouillon refusé reste intact", async () => {
    const emise = await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null);
    await emettreFacture(technique, emise, null);
    const brouillon = await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null);
    const abandon = (motif: string) => `statut = 'ABANDONNEE', abandonne_par_id = ${technique.id}, abandonne_par = 'x', abandonne_le = now(), motif_abandon = '${motif}'`;

    expect(await sql(`UPDATE factures SET ${abandon("Motif de test")} WHERE id = ${emise}`)).toMatch(/seul un brouillon ou une demande à valider peut être abandonné/);
    expect(await sql(`UPDATE factures SET statut = 'ABANDONNEE' WHERE id = ${brouillon}`)).toMatch(/factures_abandon_coherent/);
    expect(await sql(`UPDATE factures SET ${abandon("ab")} WHERE id = ${brouillon}`)).toMatch(/factures_abandon_coherent/);
    expect(await sql(`UPDATE factures SET abandonne_par_id = ${technique.id} WHERE id = ${brouillon}`)).toMatch(/factures_abandon_coherent/); // des champs d'abandon sans statut
    expect(await sql(`UPDATE factures SET ${abandon("Motif de test")}, numero = 'FAC-2026-9999', emise_le = now() WHERE id = ${brouillon}`)).toMatch(/factures_numero_a_l_emission/);
    expect((await lireFacture(technique, brouillon))!).toMatchObject({ statut: "BROUILLON", numero: null, abandon: null });
    expect((await lireFacture(technique, emise))!.statut).toBe("EMISE");
    // Un abandon complet et cohérent, lui, est accepté par la base (le contrôle est donc bien celui des contraintes, pas un refus systématique).
    expect(await sql(`UPDATE factures SET ${abandon("Motif de test")} WHERE id = ${brouillon}`)).toBe("accepté");
    expect((await lireFacture(technique, brouillon))!).toMatchObject({ statut: "ABANDONNEE", numero: null });
  });

  it("un brouillon d'avenant s'abandonne ; l'incorporation peut alors être facturée de nouveau", async () => {
    const p = await policeT2();
    await emettreFacture(technique, await creerFactureAffaireNouvelle(technique, p.policeId, null, null), null);
    await incorporerAdherents(gestionnaire, p.policeId, "2026-07-22", [{ nom_prenoms: "Nouvel Adhérent Inventé", date_naissance: "1992-02-02", sexe: "M", lien: "Salarié", formule: "SOLO" }], null);
    const avenant = await creerFactureAvenant(technique, p.policeId, 2, null, null);
    await expect(creerFactureAvenant(technique, p.policeId, 2, null, null)).rejects.toThrow(/déjà/);
    await abandonnerFacture(technique, avenant, "Mauvaise date d'incorporation (test)", null);
    expect((await lireFacture(technique, avenant))!).toMatchObject({ statut: "ABANDONNEE", numero: null });
    expect((await facturesDePolice(technique, p.cotationId))!.possibles.avenants).toEqual([{ numero: 2, dateEffet: "2026-07-22", adherents: 1 }]);
    const refait = await creerFactureAvenant(technique, p.policeId, 2, null, null);
    expect(refait).not.toBe(avenant);
  });

  it("une facture annulée n'est pas « remplacée » par un brouillon de remplacement abandonné", async () => {
    const p = await policeT3();
    const f = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, f, null);
    await emettreAvoir(technique, f, "Erreur de facturation (avoir de test)", null);
    const brouillon = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    expect((await lireFacture(technique, f))!.remplacante).toMatchObject({ id: brouillon, numero: null });
    await abandonnerFacture(technique, brouillon, "Remplacement préparé par erreur (test)", null);
    expect((await lireFacture(technique, f))!.remplacante).toBeNull();
  });

  it("l'émission ou l'avoir d'une facture abandonnée dit qu'elle est abandonnée, jamais « émise par quelqu'un d'autre »", async () => {
    const brouillon = await creerFactureAffaireNouvelle(technique, (await policeT3()).policeId, null, null);
    await abandonnerFacture(technique, brouillon, "Facture préparée par erreur (test)", null);
    await expect(emettreFacture(technique, brouillon, null)).rejects.toThrow(/déjà abandonnée/);
    await expect(emettreAvoir(technique, brouillon, "Un avoir sur un abandon (test)", null)).rejects.toThrow(/abandonnée.*rien à annuler/);
  });

  it("l'abandon libère la place : un renouvellement en cours bloquait le suivant, une affaire nouvelle abandonnée se refait", async () => {
    const p = await policeT2();
    const an = await creerFactureAffaireNouvelle(technique, p.policeId, null, null);
    await emettreFacture(technique, an, null);
    const ren = await creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null);
    await expect(creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: 1, envoyeA: null }, null)).rejects.toThrow(/déjà en cours/);
    await abandonnerFacture(technique, ren, "Mauvais effectifs, à refaire (test)", null);
    const renBis = await creerFactureRenouvellement(technique, p.policeId, { lignes: null, nombreTranches: 4, envoyeA: null }, null);
    expect(renBis).not.toBe(ren);
    expect((await lireFacture(technique, renBis))!.statut).toBe("BROUILLON");
    const vue = (await facturesDePolice(technique, p.cotationId))!;
    expect(vue.factures.map((f) => f.statut)).toEqual(expect.arrayContaining(["EMISE", "ABANDONNEE", "BROUILLON"]));

    const q = await policeT3();
    const brouillon = await creerFactureAffaireNouvelle(technique, q.policeId, null, null);
    await abandonnerFacture(technique, brouillon, "Facture préparée trop tôt (test)", null);
    const refaite = await creerFactureAffaireNouvelle(technique, q.policeId, null, null);
    expect(refaite).not.toBe(brouillon);
  });
});
