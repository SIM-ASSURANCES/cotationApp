// Corrections de la 4a : « Oui (sous seuil) » appliqué à l'émission d'un contrat (CDC §4, §4.1, D22).
// Vraie base PostgreSQL de test, générateur SIMULÉ, stockage EN MÉMOIRE.
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Analyse } from "@/domaine/documents/analyse";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { accepter, creerBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { emettreCp, soumettreCp } from "./documents";
import { enregistrerDroit, initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature } from "./societe-test";
import { remplacerStockage } from "./stockage";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";
import { lireValidationContrat } from "./validation-contrat";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const texte = (t: string) => new TextEncoder().encode(t);
const sha256 = (o: Uint8Array) => createHash("sha256").update(o).digest("hex");

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let gestionnaire: UtilisateurCourant;
let gestionnaire2: UtilisateurCourant;
let compteurPolice = 0;
const numeroPolice = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(++compteurPolice).padStart(5, "0")}`;

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const CONTENU_CP = [
  "police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "police.duree_libelle", "prime.nette", "prime.accessoires", "prime.taxe",
  "produit.cg_libelle", "produit.cg_visa", "societe.email_reclamation", "doc.lieu_emission", "doc.date_emission", "signature_sim",
];
const analyse = (chemins: string[]): Analyse => ({
  docx_valide: true, erreur: null, nombre_balises: chemins.length,
  references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
  problemes: [], champs_word: [], blocs: [], filtres: [], polices: [], polices_absentes: [], textes: [],
});
let prochaineAnalyse: Analyse = analyse(CONTENU_CP);
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

async function publier(type: "CP" | "CG", produit: string | null, visa?: string): Promise<string> {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: type === "CG" ? "SECUR DOMMAGE (test)" : `Modèle ${type}`, produitCode: produit, ...sans }, null);
  prochaineAnalyse = analyse(type === "CG" ? ["produit.cg_visa"] : CONTENU_CP);
  await deposerVersion(technique, id, { fichier: texte(`docx ${type}`), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: visa ?? null, dateDocument: visa ? "2025-06-19" : null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

const VISA = "MFB/DGTCP/DA/N° 01498";
/** TTC de la cotation : 3 × 93 581,33 + 3 000 d'accessoires + 1,5 % de taxe = 288 000 F. */
const TTC = "288000";

async function produit(seuil: string | null): Promise<string> {
  const code = CODE("SEUIL");
  const branche = `SANTE_${code}`;
  await assurerBranche(branche);
  await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code, libelle: "Produit à seuil (test)", gamme: "RELAX", branche }, null);
  const cg = await publier("CG", null, VISA);
  const version: VersionSaisie = {
    dateEffet: "2020-01-01",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: true, primeMinimale: null },
    fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    seuilValidationTtc: seuil,
    formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: "80", primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" }],
    references: { cgModeleCode: cg, cgVisa: VISA, csModeleCode: null, csVisa: null },
  };
  await creerVersion(technique, code, version, null);
  await publier("CP", code);
  return code;
}

/** Contrat accepté, CP pas encore émises. */
async function contrat(code: string): Promise<{ cotationId: number; policeId: number }> {
  const saisie: SaisieCotation = {
    codeProduit: code,
    clientId: null,
    typeContrat: "INDIVIDUEL",
    souscripteur: { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa", raison_sociale: "", telephone: "", email: "", adresse: "" },
    dateEffet: "2026-01-01",
    dateEcheance: "2026-12-31",
    nombreTranches: 1,
    lignes: [{ codeFormule: "SOLO", effectif: 3 }],
    motifForcage: null,
    assures: [],
    beneficiaires: [],
    contactsUrgence: [],
    risque: {},
  };
  const cotationId = await creerBrouillon(commercial, saisie, null);
  // Au-dessus du seuil, la COTATION elle-même attend la validation de la Technique (T13) ; c'est une autre validation que celle du contrat.
  if ((await soumettre(commercial, cotationId, null)).statut === "A_VALIDER") await valider(technique, cotationId, null);
  const { numeroPolice: numero } = await accepter(commercial, cotationId, ["SOLO"], numeroPolice(), null);
  const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
  expect(police.ttcTotal.toFixed()).toBe(TTC);
  return { cotationId, policeId: police.id };
}

const ouvertes = (policeId: number) => obtenirPrisma().validationContrat.findMany({ where: { policeId }, orderBy: { id: "asc" } });
const journal = async (action: string, policeId: number) => (await lireJournal({ action })).lignes.filter((l) => l.objet === `police ${policeId}`);

beforeAll(async () => {
  remplacerGenerateur({ analyser: async () => prochaineAnalyse, genererPdf: async () => texte("%PDF-1.7 simulé") });
  const fichiers = new Map<string, Uint8Array>();
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
  const nom = unique("admin");
  await creerAdministrateurInitial({ identifiant: nom, nom: "Admin", motDePasse: MDP });
  admin = await compte(nom);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, dg, commercial, gestionnaire, gestionnaire2] = [
    await nouveau("TECHNIQUE"),
    await nouveau("DIRECTION_GENERALE"),
    await nouveau("COMMERCIAL"),
    await nouveau("GESTIONNAIRE_PRODUCTION"),
    await nouveau("GESTIONNAIRE_PRODUCTION"),
  ];
  await assurerSignature(technique);
});

afterAll(async () => {
  remplacerGenerateur(null);
  remplacerStockage(null);
  await obtenirPrisma().$disconnect();
});

describe("émission d'un contrat : « Oui (sous seuil) » du Gestionnaire production (CDC §4)", () => {
  it("au-dessus du seuil du produit, l'émission directe est refusée et la demande passe « À valider », sans rien émettre", async () => {
    const { cotationId, policeId } = await contrat(await produit("200000"));

    await expect(emettreCp(gestionnaire, cotationId, null)).rejects.toThrow(/dépasse le seuil de validation/);
    const r = await soumettreCp(gestionnaire, cotationId, null);

    expect(r).toMatchObject({ statut: "A_VALIDER", ttc: TTC, seuil: "200000" });
    expect(await obtenirPrisma().documentEmis.count({ where: { policeId, type: "CP" } })).toBe(0);
    const demandes = await ouvertes(policeId);
    expect(demandes).toHaveLength(1);
    expect(demandes[0]).toMatchObject({ statut: "A_VALIDER", demandeParIdentifiant: gestionnaire.identifiant, valideParId: null });
    expect(demandes[0].ttc.toFixed()).toBe(TTC);
    expect(demandes[0].seuil.toFixed()).toBe("200000");
    expect(await journal("CONTRAT_A_VALIDER", policeId)).toHaveLength(1);
  });

  it("une demande répétée ne crée pas une seconde demande ; l'état s'affiche sur la fiche pour chaque profil", async () => {
    const { cotationId, policeId } = await contrat(await produit("200000"));
    await soumettreCp(gestionnaire, cotationId, null);
    await soumettreCp(gestionnaire2, cotationId, null);

    const demandes = await ouvertes(policeId);
    expect(demandes).toHaveLength(1);
    expect(demandes[0].demandeParIdentifiant).toBe(gestionnaire.identifiant);
    expect(await journal("CONTRAT_A_VALIDER", policeId)).toHaveLength(1);
    expect(await lireValidationContrat(gestionnaire, cotationId)).toMatchObject({ requise: true, validation: { statut: "A_VALIDER", demandeePar: gestionnaire.identifiant } });
    expect(await lireValidationContrat(technique, cotationId)).toMatchObject({ requise: false, validation: { statut: "A_VALIDER" } });
  });

  it("la Technique (« Oui ») émet le contrat : la demande est validée, avec qui et quand ; le Gestionnaire ne peut plus rien demander", async () => {
    const { cotationId, policeId } = await contrat(await produit("200000"));
    await soumettreCp(gestionnaire, cotationId, null);

    const r = await soumettreCp(technique, cotationId, null);

    expect(r.statut).toBe("EMISE");
    expect(await obtenirPrisma().documentEmis.count({ where: { policeId, type: "CP" } })).toBe(1);
    const [demande] = await ouvertes(policeId);
    expect(demande).toMatchObject({ statut: "VALIDEE", valideParIdentifiant: technique.identifiant });
    expect(demande.valideLe).not.toBeNull();
    expect(await journal("CONTRAT_VALIDE", policeId)).toHaveLength(1);
    await expect(soumettreCp(gestionnaire, cotationId, null)).rejects.toThrow(/déjà émises/);
  });

  it("sous le seuil, ou sans seuil sur le produit, le Gestionnaire émet directement", async () => {
    const sous = await contrat(await produit("288000")); // le TTC n'est pas strictement au-dessus du seuil
    const sansSeuil = await contrat(await produit(null));

    expect((await soumettreCp(gestionnaire, sous.cotationId, null)).statut).toBe("EMISE");
    expect((await soumettreCp(gestionnaire, sansSeuil.cotationId, null)).statut).toBe("EMISE");
    expect(await ouvertes(sous.policeId)).toHaveLength(0);
    expect(await ouvertes(sansSeuil.policeId)).toHaveLength(0);
  });

  it("un profil « Oui » (Technique) n'est jamais limité par le seuil, même sans demande préalable", async () => {
    const { cotationId, policeId } = await contrat(await produit("1000"));

    expect((await soumettreCp(technique, cotationId, null)).statut).toBe("EMISE");
    expect(await ouvertes(policeId)).toHaveLength(0);
  });

  it("le demandeur ne décide jamais sa propre validation, même si ses droits changent (séparation des tâches)", async () => {
    const { cotationId } = await contrat(await produit("200000"));
    await soumettreCp(gestionnaire, cotationId, null);
    try {
      await enregistrerDroit(admin, { profil: "GESTIONNAIRE_PRODUCTION", action: "EMETTRE_CONTRAT", niveau: "OUI" }, null);

      await expect(emettreCp(gestionnaire, cotationId, null)).rejects.toThrow(/séparation des tâches/);
      expect((await emettreCp(gestionnaire2, cotationId, null)).type).toBe("CP");
    } finally {
      await enregistrerDroit(admin, { profil: "GESTIONNAIRE_PRODUCTION", action: "EMETTRE_CONTRAT", niveau: "OUI_SOUS_SEUIL" }, null);
    }
  });

  it("le Commercial (aucun droit) et la Direction Générale (lecture) n'émettent ni ne demandent", async () => {
    const { cotationId } = await contrat(await produit("200000"));

    await expect(soumettreCp(commercial, cotationId, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(soumettreCp(dg, cotationId, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(lireValidationContrat(commercial, cotationId)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("la base garde une seule demande ouverte par police et ne laisse pas modifier une demande décidée", async () => {
    const { cotationId, policeId } = await contrat(await produit("200000"));
    await soumettreCp(gestionnaire, cotationId, null);
    const prisma = obtenirPrisma();

    await expect(prisma.$executeRawUnsafe(`INSERT INTO validations_contrat (police_id, ttc, seuil, statut, demande_par_id, demande_par_identifiant) VALUES (${policeId}, 1, 1, 'A_VALIDER', ${gestionnaire.id}, 'x')`)).rejects.toThrow();
    await soumettreCp(technique, cotationId, null);
    await expect(prisma.$executeRawUnsafe(`UPDATE validations_contrat SET seuil = 1 WHERE police_id = ${policeId}`)).rejects.toThrow(/déjà décidée/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM validations_contrat WHERE police_id = ${policeId}`)).rejects.toThrow(/suppression interdite/);
  });
});
