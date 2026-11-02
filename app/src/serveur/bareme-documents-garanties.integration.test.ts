// Session bareme-documents-garanties (D61) : composantes figées avec chaque garantie, reconstitution pour une cotation antérieure, une CP par garantie
// (sous-modèle « garanties » de clé = code de la garantie) incluse dans la CP générale. SECURPRO INVENTÉ ; sous-modèles inventés (aucun texte réel de SIM).
// Modèle de mise en place : cotation-bareme.integration.test.ts.
import { createHash } from "node:crypto";


process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { beforeAll, describe, expect, it } from "vitest";

import { lireBareme, type Bareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";
import type { Analyse } from "@/domaine/documents/analyse";

import { assurerBranche, rattacherCgDeTest } from "./branches-test";
import { basculerVersionAuBareme, lireBaremePublie, publierBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { importerBaremeXlsx } from "./bareme-excel";
import { accepter, calculerCotationBareme, creerBrouillon, lireCotation, soumettre, type SaisieCotation } from "./cotations";
import { debutTest } from "./dates-test";
import { emettreCotation, emettreCp, reediter } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { creerFactureAffaireNouvelle, lireFacture } from "./factures";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
import { apercuVersion, creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature } from "./societe-test";
import { remplacerStockage } from "./stockage";
import { ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";


const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sha256 = (o: Uint8Array) => createHash("sha256").update(o).digest("hex");
const texte = (t: string) => new TextEncoder().encode(t);

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let gestionnaire: UtilisateurCourant;

let INCENDIE: string;
let IARD: string;
let codeSecurpro: string;
let versionId: number;
let modeleCpId: number;
const VISA_CG = "MFB/DGTCP/DA/N° 2026-SECURPRO-INVENTE";
const GARANTIES = ["incendie", "vol", "dde", "de", "bdg", "tempete", "tri"];

const demandes: DemandePdf[] = [];
const fichiers = new Map<string, Uint8Array>();
let prochaineAnalyse: Analyse;

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const analyse = (chemins: string[], options: { filtres?: string[]; textes?: string[]; blocs?: { nom: string; cle: string | null }[] } = {}): Analyse => ({
  docx_valide: true,
  erreur: null,
  nombre_balises: chemins.length,
  references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
  problemes: [],
  champs_word: [],
  blocs: (options.blocs ?? []).map((b) => ({ ...b, emplacement: ici })),
  filtres: options.filtres ?? [],
  polices: [],
  polices_absentes: [],
  textes: (options.textes ?? []).map((t) => ({ texte: t, emplacement: ici })),
});

const GARANTIES_CHAMPS = [
  "garanties_souscrites[].code",
  "garanties_souscrites[].libelle",
  "garanties_souscrites[].montant_garanti",
  "garanties_souscrites[].prime_nette",
  "garanties_souscrites[].accessoires",
  "garanties_souscrites[].taux_taxe",
  "garanties_souscrites[].taxe",
  "garanties_souscrites[].ttc",
  "garanties_souscrites[].composantes[].libelle",
  "garanties_souscrites[].composantes[].montant_garanti",
  "garanties_souscrites[].composantes[].prime_nette",
];
const CONTENU_CP = [
  "police.numero",
  "souscripteur.raison_sociale",
  "police.date_effet",
  "police.date_echeance",
  "prime.ttc",
  "police.duree_libelle",
  "prime.nette",
  "prime.accessoires",
  "prime.taxe",
  "produit.cg_libelle",
  "produit.cg_visa",
  "produit.branche_libelle",
  "societe.email_reclamation",
  "doc.lieu_emission",
  "doc.date_emission",
  "signature_sim",
  ...GARANTIES_CHAMPS,
];
const CONTENU_COTATION = ["doc.numero", "souscripteur.raison_sociale", "police.date_effet", "police.date_echeance", "prime.ttc", "produit.branche_libelle", ...GARANTIES_CHAMPS];
const BLOC_DE_GARANTIE = [{ nom: "garanties", cle: "garanties_souscrites[].code" }];

const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: `${profil} Test`, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

async function deposerEtPublier(modeleId: number, a: Analyse, nom: string, fichier = nom, dateEffet = aujourdhui()) {
  prochaineAnalyse = a;
  const depot = await deposerVersion(technique, modeleId, { fichier: texte(fichier), nomFichier: `${nom}.docx`, commentaire: "Version inventée", dateEffet, visa: null, dateDocument: null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, dateEffet, null);
  return { versionId: v.id, avertissements: depot.avertissements };
}

async function publierModele(type: "COTATION" | "CP" | "CG", produitCode: string | null, a: Analyse, options: { visa?: string } = {}) {
  const id = await creerModele(
    technique,
    { type, code: CODE(`${type}_GAR`), libelle: type === "CG" ? "Conditions générales Sécur Pro (inventées)" : `Modèle ${type} Sécur Pro`, produitCode, ...sans },
    null,
  );
  prochaineAnalyse = a;
  await deposerVersion(
    technique,
    id,
    { fichier: texte(`docx ${type}`), nomFichier: `${type.toLowerCase()}.docx`, commentaire: "Version initiale (inventée)", dateEffet: aujourdhui(), visa: options.visa ?? null, dateDocument: options.visa ? "2025-06-19" : null },
    null,
  );
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return { id, code: (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code };
}

/** Sous-modèle INVENTÉ de la garantie `cle`, publié pour le produit. */
async function publierSousModele(cle: string, contenu = `sous-modèle inventé ${cle}`, produitCode: string | null = codeSecurpro) {
  const id = await creerModele(technique, { type: "SOUS_MODELE", code: CODE(`SM_${cle}`), libelle: `Garantie ${cle} (inventée)`, produitCode, niveauRelance: null, listeAnnexe: null, blocNom: "garanties", blocCle: cle }, null);
  const r = await deposerEtPublier(id, analyse(["garantie.libelle", "garantie.montant_garanti", "garantie.composantes[].libelle"]), `garantie_${cle}`, contenu);
  return { id, ...r };
}

/** Publie, pour le produit, le sous-modèle de chaque garantie du barème qui n'en a pas encore (idempotent : les tests se suivent sur le même produit). */
async function assurerSousModeles(): Promise<void> {
  for (const code of GARANTIES) {
    const existant = await obtenirPrisma().modele.findFirst({ where: { type: "SOUS_MODELE", blocNom: "garanties", blocCle: code, produit: { code: codeSecurpro } } });
    if (!existant) await publierSousModele(code);
  }
}

const souscripteur: Souscripteur = {
  type: "MORALE",
  nom: "",
  prenoms: "",
  raison_sociale: "ATELIERS DU LAGON SARL (inventée)",
  telephone: "0700000000",
  email: "contact@ateliers-lagon.exemple.ci",
  adresse: "Zone industrielle de Yopougon, rue inventée, Abidjan",
};

const derniereDemande = (type: string) => [...demandes].reverse().find((d) => (d.donnees.doc as { type: string }).type === type)!;

type EntreesEssai = { champs: Record<string, string | boolean | string[]>; souscrit: string[]; effectif?: number };
const brutDe = (e: EntreesEssai) => ({
  champs: Object.fromEntries(Object.entries(e.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
  souscrit: e.souscrit,
  ...(e.effectif !== undefined ? { effectif: String(e.effectif) } : {}),
});

/** Cas 1 du SECURPRO inventé (139 420 F, six garanties), ou ses sept garanties (tempête en plus). */
async function entrees(sept: boolean): Promise<EntreesEssai> {
  const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0].entrees;
  return sept ? { champs: { ...essai.champs, tempete_montant: "2000000" }, souscrit: [...essai.souscrit, "tempete"] } : { champs: essai.champs, souscrit: essai.souscrit };
}

function saisie(e: EntreesEssai): SaisieCotation {
  const effet = aujourdhui();
  return {
    codeProduit: codeSecurpro,
    clientId: null,
    typeContrat: "INDIVIDUEL",
    souscripteur,
    dateEffet: effet,
    dateEcheance: ajouterJours(effet, 364),
    nombreTranches: 1,
    lignes: [],
    motifForcage: null,
    assures: [],
    beneficiaires: [],
    contactsUrgence: [],
    risque: {},
    baremeBrut: brutDe(e),
  };
}

let sequence = 0;
/** Cotation émise puis acceptée : renvoie la cotation et sa police. */
async function nouvellePolice(e: EntreesEssai) {
  const cotationId = await creerBrouillon(commercial, saisie(e), null);
  await soumettre(commercial, cotationId, null);
  await emettreCotation(commercial, cotationId, null);
  sequence += 1;
  const numero = `GA-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(sequence).padStart(5, "0")}`;
  await accepter(commercial, cotationId, [], numero, null);
  const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
  return { cotationId, police };
}

function baremeAuxBranches(): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return lireBareme(d);
}

async function contournerLesDeclencheurs(sql: string): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe(sql);
  });
}

/** Retire `code` et `composantes` des lignes d'une cotation, d'une police et de leurs factures : l'état d'une cotation faite avant leur conservation. */
async function rendreAnterieure(cotationId: number, policeId: number): Promise<void> {
  const sansDetail = (chemin: string) => `jsonb_set(${chemin}, '{lignes}', (SELECT jsonb_agg(l - 'code' - 'composantes') FROM jsonb_array_elements(${chemin}->'lignes') l))`;
  await contournerLesDeclencheurs(`UPDATE cotations SET donnees_calcul = ${sansDetail("donnees_calcul")} WHERE id = ${cotationId}`);
  await contournerLesDeclencheurs(`UPDATE polices SET donnees_calcul = ${sansDetail("donnees_calcul")} WHERE id = ${policeId}`);
}

const lignesFigees = async (cotationId: number) =>
  ((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id: cotationId } })).donneesCalcul as unknown as { lignes: { code?: string; composantes?: { code: string; libelle: string; montantGaranti: string; primeNette: string }[] }[] }).lignes;

beforeAll(async () => {
  remplacerGenerateur({
    analyser: async () => prochaineAnalyse,
    genererPdf: async (demande) => {
      demandes.push(demande);
      return texte(`%PDF-1.7 simulé ${demandes.length}`);
    },
  });
  remplacerStockage({
    async ecrire(chemin, contenu) {
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
  [technique, dg, commercial, gestionnaire] = [
    await nouveauCompte("TECHNIQUE"),
    await nouveauCompte("DIRECTION_GENERALE"),
    await nouveauCompte("COMMERCIAL"),
    await nouveauCompte("GESTIONNAIRE_PRODUCTION"),
  ];
  await assurerSignature(technique);

  INCENDIE = `INC_${CODE("T")}`.slice(0, 20);
  IARD = `IARD_${CODE("T")}`.slice(0, 20);
  await assurerBranche(INCENDIE);
  await assurerBranche(IARD);
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);

  const cg = await publierModele("CG", null, analyse(["produit.cg_libelle", "produit.cg_visa", "produit.cg_date"]), { visa: VISA_CG });
  await rattacherCgDeTest("INCENDIE_DOMMAGES", cg.code);

  codeSecurpro = CODE("SECURPRO");
  await creerProduit(technique, { code: codeSecurpro, libelle: "Sécur Pro Multirisque Professionnelle (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(
    technique,
    codeSecurpro,
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
  versionId = (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code: codeSecurpro } } })).id;
  await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await construireClasseur(baremeAuxBranches(), { titre: "SECURPRO inventé (test documents par garantie)" }), null);
  await publierBareme(technique, versionId, "Barème SECURPRO inventé (test documents par garantie)", null);
  await basculerVersionAuBareme(technique, versionId, null);
  await contournerLesDeclencheurs(`UPDATE produit_versions SET date_effet = DATE '2020-01-01' WHERE id = ${versionId}`);

  await publierModele("COTATION", codeSecurpro, analyse(CONTENU_COTATION));
  modeleCpId = (await publierModele("CP", codeSecurpro, analyse(CONTENU_CP, { blocs: BLOC_DE_GARANTIE }))).id;
});

describe("A. Composantes figées avec la cotation au barème", () => {
  it("cas 1 inventé : les montants sont inchangés au franc (6 lignes, 139 420 F) et le Vol porte deux composantes, figées en base", async () => {
    const e = await entrees(false);
    const cotationId = await creerBrouillon(commercial, saisie(e), null);
    const c = (await lireCotation(technique, cotationId))!;
    expect(c.resultat.totaux.arrondi).toMatchObject({ nette: expect.anything() });
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("139420");
    expect(c.resultat.lignes.map((l) => l.arrondi.ttc.toFixed())).toEqual(["26315", "25161", "15551", "13406", "13406", "45581"]);

    const lignes = await lignesFigees(cotationId);
    expect(lignes.map((l) => l.code)).toEqual(["incendie", "vol", "dde", "de", "bdg", "tri"]);
    expect(lignes[1].composantes).toEqual([
      { code: "contenu", libelle: "Contenu", montantGaranti: expect.any(String), primeNette: expect.any(String) },
      { code: "caisse", libelle: "Caisse", montantGaranti: "200000", primeNette: expect.any(String) },
    ]);
    // Les composantes du Vol se somment à la ligne : 20 960 F ; leurs assiettes à son montant garanti (1 529 975 F).
    expect(lignes[1].composantes!.reduce((s, x) => s + Number(x.primeNette), 0)).toBe(20960);
    expect(lignes[1].composantes!.reduce((s, x) => s + Number(x.montantGaranti), 0)).toBe(1529975);
    expect(lignes[0].composantes).toHaveLength(1);
    // La fiche lit les composantes figées.
    expect(c.composition!.lignes[1].composantes).toEqual(lignes[1].composantes);
  });

  it("le bouton « Calculer » rend les composantes sans rien écrire", async () => {
    const e = await entrees(false);
    const avant = await obtenirPrisma().cotation.count();
    const r = await calculerCotationBareme(commercial, { codeProduit: codeSecurpro, typeContrat: "INDIVIDUEL", regimeTaxe: "INDIVIDUEL", dateEffet: aujourdhui(), dateEcheance: ajouterJours(aujourdhui(), 364), nombreTranches: 1, baremeBrut: brutDe(e) });
    expect(r.totaux.ttc).toBe("139420");
    expect(r.lignes[1].composantes.map((c) => c.code)).toEqual(["contenu", "caisse"]);
    expect(await obtenirPrisma().cotation.count()).toBe(avant);
  });

  it("cotation antérieure : les composantes sont reconstituées à la lecture par le recalcul du barème figé, rien n'est écrit", async () => {
    const e = await entrees(false);
    const { cotationId, police } = await nouvellePolice(e);
    const figees = await lignesFigees(cotationId);
    await rendreAnterieure(cotationId, police.id);
    expect((await lignesFigees(cotationId)).every((l) => l.code === undefined && l.composantes === undefined)).toBe(true);

    const c = (await lireCotation(technique, cotationId))!;
    expect(c.composition!.lignes.map((l) => l.code)).toEqual(figees.map((l) => l.code));
    expect(c.composition!.lignes[1].composantes).toEqual(figees[1].composantes);
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("139420"); // aucun écart de prix
    // Lecture seule : la base garde l'état antérieur.
    expect((await lignesFigees(cotationId)).every((l) => l.code === undefined && l.composantes === undefined)).toBe(true);
  });

  it("reconstitution impossible : la ligne s'affiche sans détail, sans erreur", async () => {
    const { cotationId, police } = await nouvellePolice(await entrees(false));
    await rendreAnterieure(cotationId, police.id);
    // Une prime nette figée qui ne retombe plus sur le barème (barème ou règle changés depuis) : pas de reconstitution.
    await contournerLesDeclencheurs(
      `UPDATE cotations SET donnees_calcul = jsonb_set(donnees_calcul, '{lignes,1,primeNette}', '"99999"') WHERE id = ${cotationId}`,
    );
    const c = (await lireCotation(technique, cotationId))!;
    expect(c.composition!.lignes.every((l) => l.composantes === undefined)).toBe(true);
    expect(c.composition!.lignes).toHaveLength(6);
  });
});

describe("B. Une CP par garantie, incluse dans la CP générale", () => {
  it("garanties sans sous-modèle publié : l'émission est REFUSÉE, avant tout document, en nommant la garantie et la clé attendue", async () => {
    const { cotationId, police } = await nouvellePolice(await entrees(true));
    const avant = await obtenirPrisma().documentEmis.count({ where: { policeId: police.id } });
    const erreur = (await emettreCp(technique, cotationId, null).catch((x) => x)) as ErreurMetier;
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect(erreur.message).toContain("« Incendie » (sous-modèle « garanties », clé « incendie »)");
    expect(erreur.message).toContain("« Tempête » (sous-modèle « garanties », clé « tempete »)");
    expect(erreur.message).toContain("Aucun numéro n'a été consommé");
    expect(await obtenirPrisma().documentEmis.count({ where: { policeId: police.id } })).toBe(avant);
    // Un sous-modèle manquant sur sept : seul celui-là est nommé.
    for (const code of GARANTIES.filter((g) => g !== "tempete")) await publierSousModele(code);
    const reste = (await emettreCp(technique, cotationId, null).catch((x) => x)) as ErreurMetier;
    expect(reste.message).toContain("« Tempête » (sous-modèle « garanties », clé « tempete »)");
    expect(reste.message).not.toContain("clé « vol »");
    expect(await obtenirPrisma().documentEmis.count({ where: { policeId: police.id } })).toBe(avant);
  });

  it("avec les sept sous-modèles publiés, la CP est émise : un sous-modèle par garantie, dans l'ordre, avec le code et les composantes dans les données", async () => {
    await publierSousModele("tempete");
    const { cotationId, police } = await nouvellePolice(await entrees(true));
    const doc = await emettreCp(technique, cotationId, null);
    const demande = derniereDemande("CP");
    const donnees = demande.donnees as { garanties_souscrites: { code: string; libelle: string; composantes: { code: string; libelle: string; montant_garanti: string; prime_nette: string }[] }[] };
    expect(donnees.garanties_souscrites.map((g) => g.code)).toEqual(GARANTIES);
    expect(donnees.garanties_souscrites[1].composantes.map((c) => [c.code, c.libelle])).toEqual([["contenu", "Contenu"], ["caisse", "Caisse"]]);
    expect(donnees.garanties_souscrites[0].composantes).toHaveLength(1);
    // Les sept sous-modèles sont transmis au générateur, sous la clé de leur garantie.
    expect(Object.keys(demande.sousModeles!.garanties).sort()).toEqual([...GARANTIES].sort());
    expect(new TextDecoder().decode(demande.sousModeles!.garanties.vol)).toBe("sous-modèle inventé vol");
    // Leurs versions sont conservées avec le document émis (T10).
    const ligne = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    const versions = (ligne.versionsAssociees as { sousModeles: { garanties: Record<string, number> } }).sousModeles.garanties;
    expect(Object.keys(versions).sort()).toEqual([...GARANTIES].sort());
    void police;
  });

  it("réédition à l'identique (T10) : les mêmes versions de sous-modèles, même si une nouvelle version est déposée et publiée depuis", async () => {
    const { cotationId } = await nouvellePolice(await entrees(true));
    const doc = await emettreCp(technique, cotationId, null);
    const emission = derniereDemande("CP");
    const ligne = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    const avant = (ligne.versionsAssociees as { sousModeles: { garanties: Record<string, number> } }).sousModeles.garanties;

    // Une nouvelle version du sous-modèle « vol », publiée à une date à venir (une publication n'est jamais rétroactive).
    const vol = await obtenirPrisma().modele.findFirstOrThrow({ where: { type: "SOUS_MODELE", blocNom: "garanties", blocCle: "vol", produit: { code: codeSecurpro } } });
    await deposerEtPublier(vol.id, analyse(["garantie.libelle"]), "garantie_vol_v2", "sous-modèle inventé vol v2", ajouterJours(aujourdhui(), 1));

    const reedite = await reediter(technique, doc.id, null);
    expect(reedite.version).toBe(2);
    const relance = derniereDemande("CP");
    expect(relance).not.toBe(emission);
    expect(Object.fromEntries(Object.entries(relance.sousModeles!.garanties).map(([k, v]) => [k, new TextDecoder().decode(v)]))).toEqual(
      Object.fromEntries(Object.entries(emission.sousModeles!.garanties).map(([k, v]) => [k, new TextDecoder().decode(v)])),
    );
    expect(relance.donnees.garanties_souscrites).toEqual(emission.donnees.garanties_souscrites);
    const apres = (await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: reedite.id } })).versionsAssociees as { sousModeles: { garanties: Record<string, number> } };
    expect(apres.sousModeles.garanties).toEqual(avant);
  });

  it("une cotation antérieure (sans code de garantie en base) émet ses CP : les codes sont reconstitués, un sous-modèle par garantie", async () => {
    const { cotationId, police } = await nouvellePolice(await entrees(true));
    await rendreAnterieure(cotationId, police.id);
    await emettreCp(technique, cotationId, null);
    const donnees = derniereDemande("CP").donnees as { garanties_souscrites: { code: string; composantes: unknown[] }[] };
    expect(donnees.garanties_souscrites.map((g) => g.code)).toEqual(GARANTIES);
    expect(donnees.garanties_souscrites[1].composantes).toHaveLength(2);
  });

  it("une cotation antérieure irreconstituable : refus nommé (la garantie n'a pas de code), avant tout document", async () => {
    const { cotationId, police } = await nouvellePolice(await entrees(true));
    await rendreAnterieure(cotationId, police.id);
    await contournerLesDeclencheurs(`UPDATE polices SET donnees_calcul = jsonb_set(donnees_calcul, '{lignes,1,primeNette}', '"99999"') WHERE id = ${police.id}`);
    const erreur = (await emettreCp(technique, cotationId, null).catch((x) => x)) as ErreurMetier;
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect(erreur.message).toContain("la garantie « Incendie » n'a pas de code");
    expect(await obtenirPrisma().documentEmis.count({ where: { policeId: police.id } })).toBe(0);
  });

  it("le sous-modèle du produit l'emporte sur le sous-modèle commun de même clé", async () => {
    // Idempotent : la base de test peut servir à plusieurs lancements du fichier.
    if (!(await obtenirPrisma().modele.findFirst({ where: { type: "SOUS_MODELE", blocNom: "garanties", blocCle: "vol", produitId: null } }))) await publierSousModele("vol", "sous-modèle COMMUN inventé vol", null);
    const { cotationId } = await nouvellePolice(await entrees(false));
    await emettreCp(technique, cotationId, null);
    expect(new TextDecoder().decode(derniereDemande("CP").sousModeles!.garanties.vol)).toBe("sous-modèle inventé vol");
  });
});

describe("B. Contrôles au dépôt et aperçu", () => {
  it("dépôt d'une CP dont toutes les garanties du barème ont un sous-modèle publié : aucun avertissement de garantie", async () => {
    await assurerSousModeles();
    prochaineAnalyse = analyse(CONTENU_CP, { blocs: BLOC_DE_GARANTIE });
    const r = await deposerVersion(technique, modeleCpId, { fichier: texte("cp2"), nomFichier: "cp2.docx", commentaire: "Version inventée", dateEffet: ajouterJours(aujourdhui(), 2), visa: null, dateDocument: null }, null);
    expect(r.avertissements.filter((a) => a.message.includes("sous-modèle publié"))).toEqual([]);
  });

  it("une garantie du barème sans sous-modèle publié est nommée au dépôt de la CP", async () => {
    // Nouveau produit au barème : les sept garanties n'ont encore aucun sous-modèle.
    const code = CODE("SECURPRO");
    await creerProduit(technique, { code, libelle: "Sécur Pro bis (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
    await creerVersion(
      technique,
      code,
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
    const vId = (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } })).id;
    await importerBaremeXlsx(technique, vId, "securpro.xlsx", await construireClasseur(baremeAuxBranches(), { titre: "bis" }), null);
    await publierBareme(technique, vId, "Barème bis", null);

    const cp = await creerModele(technique, { type: "CP", code: CODE("CP_BIS"), libelle: "CP bis", produitCode: code, ...sans }, null);
    prochaineAnalyse = analyse(CONTENU_CP, { blocs: BLOC_DE_GARANTIE });
    const depot = await deposerVersion(technique, cp, { fichier: texte("cp"), nomFichier: "cp.docx", commentaire: "Version inventée", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null);
    const manquantes = depot.avertissements.filter((a) => a.message.includes("n'a pas de sous-modèle publié"));
    // Aucun sous-modèle propre à ce produit : toutes les garanties sont nommées, sauf celles qu'un sous-modèle COMMUN publié couvrirait (« vol », plus haut).
    const noms = manquantes.map((a) => /garantie « (\w+) »/.exec(a.message)![1]);
    expect(noms).toEqual(expect.arrayContaining(GARANTIES.filter((g) => g !== "vol")));
    expect(manquantes[0].message).toContain("nom du bloc : garanties, clé :");

    // Un sous-modèle dont la clé n'est pas une garantie du barème : avertissement.
    const inconnu = await creerModele(technique, { type: "SOUS_MODELE", code: CODE("SM_X"), libelle: "Garantie fantôme", produitCode: code, niveauRelance: null, listeAnnexe: null, blocNom: "garanties", blocCle: "fantome" }, null);
    prochaineAnalyse = analyse(["garantie.libelle"]);
    const d2 = await deposerVersion(technique, inconnu, { fichier: texte("x"), nomFichier: "x.docx", commentaire: "Version inventée", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null);
    expect(d2.avertissements.map((a) => a.message).join(" ")).toContain("« fantome » : ce n'est le code d'aucune garantie du barème");
  });

  it("garantie.* est refusé dans une CP au dépôt, accepté dans un sous-modèle « garanties »", async () => {
    prochaineAnalyse = analyse([...CONTENU_CP, "garantie.libelle"], { blocs: BLOC_DE_GARANTIE });
    const refus = (await deposerVersion(technique, modeleCpId, { fichier: texte("cp3"), nomFichier: "cp3.docx", commentaire: "Version inventée", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null).catch((x) => x)) as ErreurMetier;
    expect(refus).toBeInstanceOf(ErreurMetier);
    expect((refus.details ?? []).join(" ")).toContain("garantie.libelle");
  });

  it("aperçu de la CP : une ligne par garantie du barème (vrais codes), les sous-modèles retenus comme pour tout aperçu", async () => {
    const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: modeleCpId }, orderBy: { numero: "asc" } });
    await apercuVersion(technique, v.id, { nombreAssures: 2 }, null);
    const demande = demandes[demandes.length - 1];
    const lignes = demande.donnees.garanties_souscrites as { code: string; composantes: { code: string }[] }[];
    expect(lignes.map((l) => l.code)).toEqual(GARANTIES);
    expect(lignes[1].composantes.map((c) => c.code)).toEqual(["contenu", "caisse"]);
    expect(Object.keys(demande.sousModeles!.garanties)).toEqual(expect.arrayContaining(GARANTIES));
    // Comme aujourd'hui : la version en vigueur de chaque sous-modèle (v1 du « vol » ; la v2 n'entre en vigueur que demain), à défaut la plus récente déposée.
    expect(new TextDecoder().decode(demande.sousModeles!.garanties.vol)).toBe("sous-modèle inventé vol");
  });
});

describe("A. Facture à l'écran (après la publication des sous-modèles : la facture suit les CP, H48)", () => {
  it("facture à l'écran : les composantes de la facture d'une cotation neuve sont figées, celles d'une facture antérieure sont reconstituées", async () => {
    const { cotationId, police } = await nouvellePolice(await entrees(false));
    // La facture d'affaire nouvelle suit les CP (H48) : leurs sous-modèles sont publiés d'abord.
    await assurerSousModeles();
    await emettreCp(technique, cotationId, null);
    const factureId = await creerFactureAffaireNouvelle(gestionnaire, police.id, null, null);
    const f = (await lireFacture(gestionnaire, factureId))!;
    expect(f.contenu.garanties![1].composantes!.map((c) => c.code)).toEqual(["contenu", "caisse"]);
    expect(f.ttc).toBe("139420");

    // Facture antérieure : ni code ni composantes dans son contenu, ni dans sa composition figée.
    await contournerLesDeclencheurs(
      `UPDATE factures SET contenu = jsonb_set(jsonb_set(contenu, '{garanties}', (SELECT jsonb_agg(g - 'code' - 'composantes') FROM jsonb_array_elements(contenu->'garanties') g)), '{entree,lignes}', (SELECT jsonb_agg(l - 'code' - 'composantes') FROM jsonb_array_elements(contenu->'entree'->'lignes') l)) WHERE id = ${factureId}`,
    );
    const brut = (await obtenirPrisma().facture.findUniqueOrThrow({ where: { id: factureId } })).contenu as unknown as { garanties: { composantes?: unknown }[] };
    expect(brut.garanties.every((g) => g.composantes === undefined)).toBe(true);
    const relue = (await lireFacture(gestionnaire, factureId))!;
    expect(relue.contenu.garanties![1].composantes).toEqual(f.contenu.garanties![1].composantes);
    expect(relue.contenu.garanties![0].code).toBe("incendie");
    void cotationId;
  });
});
