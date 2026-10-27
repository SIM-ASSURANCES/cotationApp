// Session B6a (D51) : cotation SECURPRO AU BARÈME (inventé), de bout en bout. Modèle : securpro.integration.test.ts.
// (hérité) Session SECURPRO (mardi 20/10/2026) — premier produit par garanties livrable : parcours complet de bout en bout (cotation, composition
// avec montant garanti et accessoires par défaut, modification d'un montant garanti, soumission, acceptation, CP, facture, paiement, reçu)
// et contrôles de refus (date d'effet d'hier, produit sans branche, CG sans visa et sans code, composition par un Commercial).
// Données de test INVENTÉES (aucun barème du simulateur).
import { createHash } from "node:crypto";

import ExcelJS from "exceljs";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { beforeAll, describe, expect, it } from "vitest";

import { lireBareme, type Bareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import { MODE_DE_LA_NATURE, natureDuCalcul } from "@/domaine/calcul/composition";
import { MESSAGE_BAREME_INCOHERENT, MESSAGE_BROUILLON_A_FORMULES_BAREME, MESSAGE_TARIFICATION_AU_BAREME } from "@/domaine/calcul/parametrage";

import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";
import type { Analyse } from "@/domaine/documents/analyse";

import { assurerBranche, rattacherCgDeTest } from "./branches-test";
import { basculerVersionAuBareme, lireBaremePublie, publierBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { importerBaremeXlsx } from "./bareme-excel";
import { debutTest } from "./dates-test";
import { fixerSeuilGlobalDeTest, retablirSeuilGlobalDeTest } from "./parametres-test";

import { accepter, calculerCotationBareme, composerLaPrime, creerBrouillon, lireCotation, modifierBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { retirerAdherents, lireAdherents } from "./adherents";
import { emettreCotation, emettreCp, montantsDu } from "./documents";
import { confirmerImport, controlerImport, lireLot, modeleImport } from "./imports";
import { initialiserProfilsEtDroits } from "./droits";
import { creerFactureAffaireNouvelle, creerFactureRenouvellement, emettreFacture, enregistrerPaiement, lireFacture } from "./factures";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { construireEntree, creerProduit, creerTaxe, creerVersion, exigerModeCoherent, exigerModeCoherentEnVigueur, resoudreContexte } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature } from "./societe-test";
import { remplacerStockage } from "./stockage";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
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
let comptable: UtilisateurCourant;

let INCENDIE: string; // catégorie fiscale 12,5 %
let IARD: string; // catégorie fiscale 7,25 %
let codeSecurpro: string;
let cgCode: string;
const VISA_CG = "MFB/DGTCP/DA/N° 2026-SECURPRO-INVENTE";

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

const GARANTIES_CHAMPS = [
  "garanties_souscrites[].libelle",
  "garanties_souscrites[].montant_garanti",
  "garanties_souscrites[].prime_nette",
  "garanties_souscrites[].accessoires",
  "garanties_souscrites[].taux_taxe",
  "garanties_souscrites[].taxe",
  "garanties_souscrites[].ttc",
];
const CONTENU_COTATION = ["doc.numero", "souscripteur.raison_sociale", "police.date_effet", "police.date_echeance", "prime.ttc", "produit.branche_libelle", ...GARANTIES_CHAMPS];
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
const CONTENU_FACTURE = [
  "doc.numero",
  "doc.date_emission",
  "police.numero",
  "police.date_effet",
  "police.date_echeance",
  "souscripteur.raison_sociale",
  "souscripteur.adresse",
  "prime.taxe",
  "prime.ttc",
  "societe.rccm",
  "societe.ncc",
  "societe.rib[].numero",
  "societe.mobile_money[].numero_marchand",
  "signature_sim",
  "qr_code",
  ...GARANTIES_CHAMPS,
];
const CONTENU_RECU = ["police.numero", "souscripteur.raison_sociale", "police.date_effet", "police.date_echeance", "prime.ttc", "paiements[].montant", "doc.facture_origine"];

const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: `${profil} Test`, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

async function publierModele(type: "COTATION" | "CP" | "CG" | "FACTURE" | "RECU", produitCode: string | null, a: Analyse, options: { visa?: string } = {}) {
  const id = await creerModele(
    technique,
    { type, code: CODE(`${type}_SP`), libelle: type === "CG" ? "Conditions générales Sécur Pro (inventées)" : `Modèle ${type} Sécur Pro`, produitCode, ...sans },
    null,
  );
  prochaineAnalyse = a;
  await deposerVersion(
    technique,
    id,
    {
      fichier: texte(`docx ${type}`),
      nomFichier: `${type.toLowerCase()}.docx`,
      commentaire: "Version initiale SECURPRO (inventée)",
      dateEffet: aujourdhui(),
      visa: options.visa ?? null,
      dateDocument: options.visa ? "2025-06-19" : null,
    },
    null,
  );
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

const souscripteurSecurpro: Souscripteur = {
  type: "MORALE",
  nom: "",
  prenoms: "",
  raison_sociale: "ATELIERS DU LAGON SARL (inventée)",
  telephone: "0700000000",
  email: "contact@ateliers-lagon.exemple.ci",
  adresse: "Zone industrielle de Yopougon, rue inventée, Abidjan",
};

const derniereDemande = (type: string) => [...demandes].reverse().find((d) => (d.donnees.doc as { type: string }).type === type)!;

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
  [technique, dg, commercial, gestionnaire, comptable] = [
    await nouveauCompte("TECHNIQUE"),
    await nouveauCompte("DIRECTION_GENERALE"),
    await nouveauCompte("COMMERCIAL"),
    await nouveauCompte("GESTIONNAIRE_PRODUCTION"),
    await nouveauCompte("COMPTABILITE"),
  ];
  await assurerSignature(technique);

  INCENDIE = `INC_${CODE("T")}`.slice(0, 20);
  IARD = `IARD_${CODE("T")}`.slice(0, 20);
  await assurerBranche(INCENDIE);
  await assurerBranche(IARD);
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);

  // Modèle de CG publié avec code et visa obligatoires.
  cgCode = await publierModele("CG", null, analyse(["produit.cg_libelle", "produit.cg_visa", "produit.cg_date"]), { visa: VISA_CG });
  await rattacherCgDeTest("INCENDIE_DOMMAGES", cgCode);

  // Produit SECURPRO inventé : branche principale INCENDIE_DOMMAGES, mode GARANTIES, 3 garanties avec montant garanti et accessoires par défaut.
  codeSecurpro = CODE("SECURPRO");
  await creerProduit(
    technique,
    {
      code: codeSecurpro,
      libelle: "Sécur Pro Multirisque Professionnelle (inventé)",
      gamme: "SECUR",
      branchePrincipale: "INCENDIE_DOMMAGES",
      branche: IARD,
    },
    null,
  );
  // Une version ne naît pas au barème (D50) : version future « Par garanties », barème importé d'un classeur, publié, puis bascule. La version est
  // enfin mise en vigueur « à la main » (test seulement : on ne peut pas attendre sa date d'effet).
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
  await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await construireClasseur(baremeAuxBranches(), { titre: "SECURPRO inventé (test B6a)" }), null);
  await publierBareme(technique, versionId, "Barème SECURPRO inventé (test B6a)", null);
  await basculerVersionAuBareme(technique, versionId, null);
  await changerLaVersionPourTest(versionId, "date_effet = DATE '2020-01-01'");


  await publierModele("COTATION", codeSecurpro, analyse(CONTENU_COTATION));
  await publierModele("CP", codeSecurpro, analyse(CONTENU_CP));
  await publierModele(
    "FACTURE",
    codeSecurpro,
    analyse(CONTENU_FACTURE, {
      filtres: ["lettres"],
      textes: ["Rappel art. 13 du code CIMA : la prise d'effet du contrat est subordonnée au paiement de la prime."],
    }),
  );
  await publierModele("RECU", codeSecurpro, analyse(CONTENU_RECU));
});

describe("Session B6a : cotation SECURPRO au barème (inventé), de bout en bout", () => {
  it("cotation → soumission → acceptation → CP → facture → paiement → reçu, montants = jeu d'essai (139 420 F TTC)", async () => {
    const effet = aujourdhui();
    const echeance = ajouterJours(effet, 364);
    const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0];
    expect(essai.attendu.ttc).toBe("139420");

    const cotationId = await creerBrouillon(commercial, saisieAuBareme(essai.entrees, { dateEffet: effet, dateEcheance: echeance }), null);
    const brouillon = (await lireCotation(technique, cotationId))!;
    expect(brouillon.modeTarification).toBe("BAREME");
    expect(brouillon.resultat.totaux.arrondi.ttc.toFixed()).toBe("139420");
    // Composition d'origine BAREME : empreinte du barème et saisie figées, lignes avec taux de taxe résolus.
    const figee = brouillon.composition!.bareme!;
    expect(figee.empreinte).toBe((await lireBaremePublie(obtenirPrisma(), versionId)).empreinte);
    expect(figee.versionId).toBe(versionId);
    expect(figee.saisie.souscrit).toEqual(essai.entrees.souscrit);
    expect(brouillon.composition!.lignes.map((l) => [l.libelle, l.tauxPourcent])).toEqual([
      ["Incendie", "12.5"],
      ["Vol", "7.25"],
      ["Dégâts des eaux", "7.25"],
      ["Dommages électriques", "7.25"],
      ["Bris de glaces", "7.25"],
      ["Tous risques informatique", "7.25"],
    ]);
    expect(brouillon.composition!.lignes[0].montantGaranti).toBe("26866500"); // capitaux totaux (D37)
    expect(brouillon.composition!.lignes[1].montantGaranti).toBe("1529975"); // Vol : 1 329 975 + 200 000

    const soumise = await soumettre(commercial, cotationId, null);
    expect(soumise.statut).toBe("EMISE");
    await emettreCotation(commercial, cotationId, null);
    const MONTANTS = [
      { libelle: "Incendie", prime_nette: "20891", accessoires: "2500", taxe: "2924", ttc: "26315" },
      { libelle: "Vol", prime_nette: "20960", accessoires: "2500", taxe: "1701", ttc: "25161" },
      { libelle: "Dégâts des eaux", prime_nette: "12000", accessoires: "2500", taxe: "1051", ttc: "15551" },
      { libelle: "Dommages électriques", prime_nette: "10000", accessoires: "2500", taxe: "906", ttc: "13406" },
      { libelle: "Bris de glaces", prime_nette: "10000", accessoires: "2500", taxe: "906", ttc: "13406" },
      { libelle: "Tous risques informatique", prime_nette: "40000", accessoires: "2500", taxe: "3081", ttc: "45581" },
    ];
    type PdfDonnees = { prime: Record<string, string | null>; garanties_souscrites: Record<string, string>[] };
    const pdfCotation = derniereDemande("COTATION").donnees as PdfDonnees;
    expect(pdfCotation.prime).toMatchObject({ nette: "113851", accessoires: "15000", taxe: "10569", ttc: "139420", taux_taxe: null });
    expect(pdfCotation.garanties_souscrites).toMatchObject(MONTANTS);

    const numPolice = `SB-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I00001`;
    await accepter(commercial, cotationId, [], numPolice, null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: numPolice } });
    policeId = police.id;
    expect(police.ttcTotal.toFixed()).toBe("139420");
    expect((police.donneesCalcul as { origine?: string; bareme?: { empreinte: string } }).origine).toBe("BAREME");

    await emettreCp(technique, cotationId, null);
    expect((derniereDemande("CP").donnees as PdfDonnees).garanties_souscrites).toMatchObject(MONTANTS);

    const factureId = await creerFactureAffaireNouvelle(gestionnaire, police.id, null, null);
    expect((await emettreFacture(gestionnaire, factureId, null)).statut).toBe("EMISE");
    expect((await lireFacture(gestionnaire, factureId))!.ttc).toBe("139420");
    expect((derniereDemande("FACTURE").donnees as PdfDonnees).garanties_souscrites).toMatchObject(MONTANTS);

    const reglement = await enregistrerPaiement(comptable, factureId, { date: effet, montant: "139420", canal: "VIREMENT", reference: "VIR-BAREME-001", payeur: "ATELIERS DU LAGON SARL" }, null);
    expect(reglement.restantDu).toBe("0");
    expect(reglement.numeroRecu).toMatch(/^REC-/);
    expect((derniereDemande("RECU").donnees as PdfDonnees).prime).toMatchObject({ ttc: "139420" });
  });

  it("le bouton « Calculer » rend les lignes et totaux du jeu d'essai sans rien écrire ; la saisie est recontrôlée au serveur", async () => {
    const avant = await obtenirPrisma().cotation.count();
    const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0];
    const base = demandeCalcul(essai.entrees);
    const r = await calculerCotationBareme(commercial, base);
    expect(r.totaux).toEqual({ nette: "113851", accessoires: "15000", taxe: "10569", ttc: "139420" });
    expect(r.lignes.map((l) => l.ttc)).toEqual(["26315", "25161", "15551", "13406", "13406", "45581"]);

    // Un champ non applicable (valeur du bâtiment alors que l'occupation est « Locataire ») est ignoré : même résultat.
    const avecChampCache = { ...base, baremeBrut: { ...base.baremeBrut, champs: { ...base.baremeBrut.champs, valeur_batiment: ["99999999"] } } };
    expect((await calculerCotationBareme(commercial, avecChampCache)).totaux.ttc).toBe("139420");
    // Un champ obligatoire vide est refusé, nommé.
    const sansLoyer = { ...base, baremeBrut: { ...base.baremeBrut, champs: { ...base.baremeBrut.champs, loyer_mensuel: [""] } } };
    await expect(calculerCotationBareme(commercial, sansLoyer)).rejects.toThrow(/Loyer|loyer_mensuel/);
    // Un champ inconnu ajouté à la main dans la requête n'est jamais lu ; une garantie inconnue est refusée.
    expect((await calculerCotationBareme(commercial, { ...base, baremeBrut: { ...base.baremeBrut, champs: { ...base.baremeBrut.champs, pirate: ["1"] } } })).totaux.ttc).toBe("139420");
    await expect(calculerCotationBareme(commercial, { ...base, baremeBrut: { ...base.baremeBrut, souscrit: [...base.baremeBrut.souscrit, "fantome"] } })).rejects.toThrow(/fantome/);
    // Une valeur de liste de montants absente de la liste est refusée.
    await expect(calculerCotationBareme(commercial, { ...base, baremeBrut: { ...base.baremeBrut, champs: { ...base.baremeBrut.champs, dde_montant: ["1234567"] } } })).rejects.toThrow(/dde_montant|liste/);
    // Une condition de souscription : le montant d'une garantie non souscrite n'est pas lu.
    const sansDde = { ...base, baremeBrut: { ...base.baremeBrut, souscrit: base.baremeBrut.souscrit.filter((s) => s !== "dde") } };
    expect((await calculerCotationBareme(commercial, sansDde)).lignes.map((l) => l.libelle)).not.toContain("Dégâts des eaux");
    // Le droit de créer une cotation est exigé.
    await expect(calculerCotationBareme(comptable, base)).rejects.toBeInstanceOf(ErreurAcces);
    expect(await obtenirPrisma().cotation.count()).toBe(avant);
  });

  it("refus E4 : le message de la Technique, rien n'est créé ; aucun secours par composition manuelle (Q3, réponse A)", async () => {
    const essais = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai;
    const refuse = essais[2];
    expect(refuse.attendu.refus).toBeDefined();
    const avant = await obtenirPrisma().cotation.count({ where: { produit: { code: codeSecurpro } } });

    const e = (await calculerCotationBareme(commercial, demandeCalcul(refuse.entrees)).catch((x) => x)) as ErreurMetier;
    expect(e).toBeInstanceOf(ErreurMetier);
    expect(e.message).toBe("Les capitaux dépassent la limite de la classe : ce risque ne peut pas être assuré dans ce barème.");
    const e2 = (await creerBrouillon(commercial, saisieAuBareme(refuse.entrees, {}), null).catch((x) => x)) as ErreurMetier;
    expect(e2.message).toBe(e.message);
    expect(await obtenirPrisma().cotation.count({ where: { produit: { code: codeSecurpro } } })).toBe(avant);

    // Secours refusé sans exception : ni à la création (lignes composées dans la saisie), ni par « Composer une prime » sur une cotation existante.
    const bonne = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0];
    await expect(creerBrouillon(technique, { ...saisieAuBareme(bonne.entrees, {}), composition: [{ libelle: "Incendie", branche: IARD, primeNette: "1000", accessoires: "0" }] }, null)).rejects.toThrow(MESSAGE_TARIFICATION_AU_BAREME);
    const id = await creerBrouillon(commercial, saisieAuBareme(bonne.entrees, {}), null);
    await expect(composerLaPrime(technique, id, [{ libelle: "Incendie", branche: IARD, primeNette: "1000", accessoires: "0" }], "Secours demandé après un refus", null)).rejects.toThrow(MESSAGE_TARIFICATION_AU_BAREME);
    expect((await lireCotation(technique, id))!.resultat.totaux.arrondi.ttc.toFixed()).toBe("139420"); // rien n'a été remplacé
    // Pas de formule non plus.
    await expect(creerBrouillon(commercial, { ...saisieAuBareme(bonne.entrees, {}), lignes: [{ codeFormule: "SOLO", effectif: 1, primeForcee: null, accessoireValeur: null }] }, null)).rejects.toThrow(MESSAGE_BROUILLON_A_FORMULES_BAREME);
    // Un produit au barème exige les champs du barème.
    await expect(creerBrouillon(commercial, { ...saisieAuBareme(bonne.entrees, {}), baremeBrut: undefined }, null)).rejects.toThrow(/Renseignez les champs du barème/);
  });

  it("modification d'un brouillon : la prime est recalculée du barème, un changement de période ne vide rien ; la saisie enregistrée est reprise", async () => {
    const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[1]; // Bureau, propriétaire, minimum de la caisse : 21 784
    const id = await creerBrouillon(commercial, saisieAuBareme(essai.entrees, {}), null);
    expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed()).toBe("21784");

    // Sans nouvelle saisie du barème : la saisie enregistrée est reprise, la période change, les lignes demeurent.
    const decale = ajouterJours(aujourdhui(), 3);
    const r = await modifierBrouillon(commercial, id, { ...saisieAuBareme(essai.entrees, { dateEffet: decale, dateEcheance: ajouterJours(decale, 364) }), baremeBrut: undefined, id: undefined } as never, null);
    expect(r.compositionVidee).toBe(false);
    const apres = (await lireCotation(commercial, id))!;
    expect(apres.dateEffet).toBe(decale);
    expect(apres.composition!.lignes).toHaveLength(2);
    expect(apres.resultat.totaux.arrondi.ttc.toFixed()).toBe("21784");

    // Avec une saisie modifiée (caisse à 200 000 : 5 000 au lieu du minimum de 2 500) : prime recalculée.
    const modifiee = { champs: { ...brutDe(essai.entrees).champs, vol_caisse_montant: ["200000"] }, souscrit: essai.entrees.souscrit };
    await modifierBrouillon(commercial, id, { ...saisieAuBareme(essai.entrees, {}), baremeBrut: modifiee } as never, null);
    expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed()).not.toBe("21784");
    // Soumission : recalcul depuis la saisie enregistrée, émission.
    expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
  });
});

describe("Gardes « nature ↔ mode » à trois valeurs sur les cinq sites D31/D32 (une cotation au barème est une composition d'origine BAREME)", () => {
  const compositionManuelle = { type: "COMPOSITION", version: 1, lignes: [{}] } as never;
  const compositionBareme = { type: "COMPOSITION", version: 1, lignes: [{}], origine: "BAREME", bareme: { versionId: 1, empreinte: "x", saisie: { champs: {}, souscrit: [] } } } as never;
  const automatique = { type: "CALCUL" } as never;

  it("la nature d'un calcul figé se reconnaît, et chaque nature a son mode", () => {
    expect([automatique, compositionManuelle, compositionBareme].map(natureDuCalcul)).toEqual(["AUTOMATIQUE", "COMPOSITION", "BAREME"]);
    expect(MODE_DE_LA_NATURE).toEqual({ AUTOMATIQUE: "FORMULE", COMPOSITION: "GARANTIES", BAREME: "BAREME" });
  });

  it("site 3 — exigerModeCoherent : seule la bonne nature passe, pour chacun des trois modes", () => {
    for (const mode of ["FORMULE", "GARANTIES", "BAREME"]) {
      for (const [nature, donnees] of [["AUTOMATIQUE", automatique], ["COMPOSITION", compositionManuelle], ["BAREME", compositionBareme]] as const) {
        const attendu = MODE_DE_LA_NATURE[nature] === mode;
        if (attendu) expect(() => exigerModeCoherent(mode, donnees)).not.toThrow();
        else expect(() => exigerModeCoherent(mode, donnees), `${nature} avec ${mode}`).toThrow(ErreurMetier);
      }
    }
    expect(() => exigerModeCoherent("GARANTIES", compositionBareme)).toThrow(MESSAGE_BAREME_INCOHERENT);
    expect(() => exigerModeCoherent("BAREME", compositionManuelle)).toThrow(MESSAGE_TARIFICATION_AU_BAREME);
  });

  it("site 3 — l'émission d'une cotation « À valider » est refusée si la version n'est plus au barème", async () => {
    await fixerSeuilGlobalDeTest("1000"); // tout dépasse le seuil : la cotation passe « À valider »
    try {
      const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[1];
      const id = await creerBrouillon(commercial, saisieAuBareme(essai.entrees, {}), null);
      expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");
      await changerLaVersionPourTest(versionId, "mode_tarification = 'GARANTIES'");
      try {
        await expect(valider(dg, id, null)).rejects.toThrow(MESSAGE_BAREME_INCOHERENT);
      } finally {
        await changerLaVersionPourTest(versionId, "mode_tarification = 'BAREME'");
      }
      expect((await valider(dg, id, null)).length).toBeGreaterThan(0); // une fois la version rétablie, l'émission passe
    } finally {
      await retablirSeuilGlobalDeTest();
    }
  });

  it("site 1 — resoudreContexte (calcul automatique) et site 2 — construireEntree refusent un produit au barème", async () => {
    await expect(resoudreContexte(obtenirPrisma(), codeSecurpro, aujourdhui(), aujourdhui(), "INDIVIDUEL")).rejects.toThrow(MESSAGE_TARIFICATION_AU_BAREME);
    const faux = { version: { modeTarification: "BAREME" }, taxe: {}, produit: {} } as never;
    expect(() => construireEntree(faux, { dateEffet: aujourdhui(), dateEcheance: aujourdhui(), lignes: [], nombreTranches: 1 })).toThrow(MESSAGE_TARIFICATION_AU_BAREME);
  });

  it("site 4 — le renouvellement : la garde « en vigueur » suit les trois natures, et un renouvellement de police au barème est refusé en attendant B8", async () => {
    const { produitId } = await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: versionId } });
    await expect(exigerModeCoherentEnVigueur(obtenirPrisma(), produitId, aujourdhui(), compositionBareme)).resolves.toBeUndefined();
    await expect(exigerModeCoherentEnVigueur(obtenirPrisma(), produitId, aujourdhui(), compositionManuelle)).rejects.toThrow(MESSAGE_TARIFICATION_AU_BAREME);
    await expect(exigerModeCoherentEnVigueur(obtenirPrisma(), produitId, aujourdhui(), automatique)).rejects.toThrow(MESSAGE_TARIFICATION_AU_BAREME);
    await changerLaVersionPourTest(versionId, "mode_tarification = 'GARANTIES'");
    try {
      await expect(exigerModeCoherentEnVigueur(obtenirPrisma(), produitId, aujourdhui(), compositionBareme)).rejects.toThrow(MESSAGE_BAREME_INCOHERENT);
    } finally {
      await changerLaVersionPourTest(versionId, "mode_tarification = 'BAREME'");
    }
    await expect(creerFactureRenouvellement(gestionnaire, policeId, {} as never, null)).rejects.toBeInstanceOf(ErreurMetier);
  });

  it("site 5 — montantsDu : une composition d'origine BAREME ne se lit que sous un mode BAREME", () => {
    const ctx = (mode: string) => ({ modeTarification: mode, formules: new Map(), references: {} }) as never;
    const lignes = [{ libelle: "Incendie", branche: "IARD", primeNette: "1000", accessoires: "0", tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES" }];
    const entree = { type: "COMPOSITION", version: 1, dateEffet: aujourdhui(), dateEcheance: ajouterJours(aujourdhui(), 364), arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" }, lignes } as never;
    const deBareme = { ...(entree as object), origine: "BAREME", bareme: { versionId: 1, empreinte: "x", saisie: { champs: {}, souscrit: [] } } } as never;
    expect(montantsDu(deBareme, ctx("BAREME")).totaux.ttc).toBe("1073");
    expect(() => montantsDu(deBareme, ctx("GARANTIES"))).toThrow(MESSAGE_BAREME_INCOHERENT);
    expect(() => montantsDu(deBareme, ctx("FORMULE"))).toThrow(MESSAGE_BAREME_INCOHERENT);
    expect(() => montantsDu(entree, ctx("BAREME"))).toThrow(MESSAGE_TARIFICATION_AU_BAREME); // composition manuelle sous un mode BAREME
    expect(montantsDu(entree, ctx("GARANTIES")).totaux.ttc).toBe("1073");
  });
});

// ---------------------------------------------------------------- Aides

let versionId: number;
let policeId: number;

/** Le SECURPRO inventé, avec les catégories de taxe (aléatoires) de ce fichier : la base est partagée avec d'autres tests. */
function baremeAuxBranches(): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return lireBareme(d);
}

/** Change la version du barème en contournant les déclencheurs : base de test seulement (on ne peut ni attendre une date d'effet, ni la rétrograder). */
async function changerLaVersionPourTest(id: number, affectation: string): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe(`UPDATE produit_versions SET ${affectation} WHERE id = ${id}`);
  });
}

type EntreesEssai = { champs: Record<string, string | boolean | string[]>; souscrit: string[]; effectif?: number };

/** Les champs d'un jeu d'essai tels qu'un formulaire les envoie : des listes de textes, OUI / NON pour un oui/non. */
const brutDe = (e: EntreesEssai) => ({
  champs: Object.fromEntries(Object.entries(e.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
  souscrit: e.souscrit,
  ...(e.effectif !== undefined ? { effectif: String(e.effectif) } : {}),
});

function saisieAuBareme(e: EntreesEssai, surcharge: Partial<SaisieCotation>): SaisieCotation {
  const effet = surcharge.dateEffet ?? aujourdhui();
  return {
    codeProduit: codeSecurpro,
    clientId: null,
    typeContrat: "INDIVIDUEL",
    souscripteur: souscripteurSecurpro,
    dateEffet: effet,
    dateEcheance: surcharge.dateEcheance ?? ajouterJours(effet, 364),
    nombreTranches: 1,
    lignes: [],
    motifForcage: null,
    assures: [],
    beneficiaires: [],
    contactsUrgence: [],
    risque: {},
    baremeBrut: brutDe(e),
    ...surcharge,
  };
}

const demandeCalcul = (e: EntreesEssai) => ({
  codeProduit: codeSecurpro,
  typeContrat: "INDIVIDUEL",
  regimeTaxe: "INDIVIDUEL",
  dateEffet: aujourdhui(),
  dateEcheance: ajouterJours(aujourdhui(), 364),
  nombreTranches: 1,
  baremeBrut: brutDe(e),
});

describe("B6b, D52 : import en masse sur une police au barème (plafond = effectif figé de la cotation)", () => {
  const EFFECTIF = 5;
  let produitParTete: string;
  let seq = 0;
  // Une racine propre à chaque police : les numéros de certificat proposés (racine + ordre) ne heurtent jamais ceux d'une autre police.
  const numeroGroupe = () => `TST-2026-${String((Date.now() + ++seq) % 1_000_000).padStart(6, "0")}-G00000`;
  const csv = (k: number, debut = 1) => ({
    nom: "adherents.csv",
    contenu: texte(["nom_prenoms;date_naissance", ...Array.from({ length: k }, (_, i) => `Nouveau ${debut + i} Inventé;${String(1 + (i % 28)).padStart(2, "0")}/03/1990`)].join("\n")),
  });

  /** Le SECURPRO inventé avec un accessoire PAR TÊTE : le barème tarife par effectif. */
  function baremeParTete(): Bareme {
    const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string; accessoires: unknown }; garanties: { taxe?: string }[]; jeuxEssai: { entrees: { effectif?: number }; attendu: unknown }[] };
    const carte: Record<string, string> = { IARD, INCENDIE };
    d.produit.taxe = carte[d.produit.taxe];
    for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
    d.produit.accessoires = { mode: "PAR_TETE", montant: "1000" };
    d.jeuxEssai = d.jeuxEssai.slice(0, 1).map((j) => ({ ...j, entrees: { ...j.entrees, effectif: EFFECTIF }, attendu: {} }));
    return lireBareme(d);
  }

  beforeAll(async () => {
    produitParTete = CODE("PARTETE");
    await creerProduit(technique, { code: produitParTete, libelle: "Sécur Pro par tête (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
    await creerVersion(
      technique,
      produitParTete,
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
    const id = (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code: produitParTete } } })).id;
    await importerBaremeXlsx(technique, id, "partete.xlsx", await construireClasseur(baremeParTete(), { titre: "Par tête inventé (test B6b)" }), null);
    await publierBareme(technique, id, "Barème par tête inventé (test B6b)", null);
    await basculerVersionAuBareme(technique, id, null);
    await changerLaVersionPourTest(id, "date_effet = DATE '2020-01-01'");
    await publierModele("COTATION", produitParTete, analyse(CONTENU_COTATION));
  });

  /** Police mère de groupe au barème : deux adhérents actifs, effectif figé à la cotation (ou aucun pour le barème sans effectif). */
  async function policeDeGroupe(code: string, effectif: number | undefined) {
    const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0].entrees as EntreesEssai;
    const assures = [1, 2].map((ordre) => ({ ordre, nom_prenoms: `Existant ${ordre} Inventé`, date_naissance: `1980-01-0${ordre}`, sexe: "M" as const, lien: "Salarié", formule: "" }));
    const entrees = { ...essai, ...(effectif !== undefined ? { effectif } : {}) };
    const id = await creerBrouillon(commercial, { ...saisieAuBareme(entrees, { typeContrat: "GROUPE", assures }), codeProduit: code }, null);
    await soumettre(commercial, id, null);
    const { numeroPolice } = await accepter(commercial, id, [], numeroGroupe(), null);
    return (await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: numeroPolice } })).id;
  }
  const refusEffectif = async (lotId: number) => (await lireLot(technique, lotId))!.lignesEnErreur.filter((l) => /tarifé pour/.test(JSON.stringify(l)));
  const controler = (policeId: number, k: number, debut = 1) => controlerImport(technique, policeId, aujourdhui(), csv(k, debut), null);

  it("barème par tête : limite exacte acceptée, limite + 1 refusée avec le message, les lignes dans la limite restent valides", async () => {
    const policeId = await policeDeGroupe(produitParTete, EFFECTIF);
    expect(await lireLot(technique, await controler(policeId, 3))).toMatchObject({ total: 3, valides: 3, erreurs: 0 });
    const lot = await lireLot(technique, await controler(policeId, 4));
    expect(lot).toMatchObject({ total: 4, valides: 3, erreurs: 1 });
    expect(JSON.stringify(lot!.lignesEnErreur[0])).toContain("Ce contrat est tarifé pour 5 assurés ; 2 sont déjà actifs. Les 1 lignes en trop doivent passer par un avenant d'incorporation, qui recalculera la prime.");
    // La confirmation incorpore seulement les lignes valides, jusqu'à l'effectif.
    await confirmerImport(technique, lot!.id, null);
    expect((await lireAdherents(technique, policeId))!.courants).toHaveLength(5);
    expect(await refusEffectif(await controler(policeId, 1, 10))).toHaveLength(1); // plus aucune place
  });

  it("retrait puis ajout : un retrait libère une place ; seuls les adhérents actifs comptent", async () => {
    const policeId = await policeDeGroupe(produitParTete, EFFECTIF);
    await retirerAdherents(technique, policeId, aujourdhui(), [1], null);
    expect((await lireAdherents(technique, policeId))!.courants).toHaveLength(1);
    expect(await refusEffectif(await controler(policeId, 4))).toHaveLength(0); // 1 actif + 4 = 5
    const lot = await controler(policeId, 5);
    expect(await refusEffectif(lot)).toHaveLength(1);
    expect(JSON.stringify(await refusEffectif(lot))).toContain("1 sont déjà actifs");
  });

  it("barème sans effectif (accessoire par garantie) : aucun contrôle ; modèle et aide corrigés (colonne formule vide)", async () => {
    const policeId = await policeDeGroupe(codeSecurpro, undefined);
    expect(await lireLot(technique, await controler(policeId, 30))).toMatchObject({ total: 30, valides: 30, erreurs: 0 });

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(Buffer.from((await modeleImport(technique, codeSecurpro, policeId)).contenu) as unknown as ArrayBuffer);
    const feuille = classeur.getWorksheet("Adhérents")!;
    const colonne = (cle: string) => (feuille.getRow(1).values as unknown[]).slice(1).indexOf(cle) + 1;
    expect(feuille.getRow(2).getCell(colonne("formule")).value ?? "").toBe("");
    expect(feuille.getRow(3).getCell(colonne("formule")).dataValidation).toBeUndefined();
    const aide = JSON.stringify(classeur.getWorksheet("Aide")!.getSheetValues());
    expect(aide).toContain("Produit tarifé au barème");
    expect(aide).not.toContain("Effectif maximal");
  });

  it("le fichier modèle d'une police au barème par tête indique l'effectif maximal et les places restantes", async () => {
    const policeId = await policeDeGroupe(produitParTete, EFFECTIF);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(Buffer.from((await modeleImport(technique, produitParTete, policeId)).contenu) as unknown as ArrayBuffer);
    expect(JSON.stringify(classeur.getWorksheet("Aide")!.getSheetValues())).toContain("Effectif maximal de cette police : 5 assurés ; 2 sont déjà actifs, il reste 3 places.");
  });
});

describe("B6b, D52 : balises risque.<code> d'un produit au barème", () => {
  it("la cotation porte les champs du barème dans risque (vide pour un champ inapplicable) et le document les reçoit", async () => {
    const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0];
    const id = await creerBrouillon(commercial, saisieAuBareme(essai.entrees as EntreesEssai, {}), null);
    const ligne = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } });
    expect(ligne.risque).toMatchObject({ type_commerce: "ELECTRONIQUE", occupation: "LOCATAIRE", gardien: "OUI", loyer_mensuel: "150000", valeur_batiment: "" });
    await soumettre(commercial, id, null);
    await emettreCotation(commercial, id, null);
    expect(derniereDemande("COTATION").donnees.risque).toMatchObject({ type_commerce: "ELECTRONIQUE", loyer_mensuel: "150000", valeur_batiment: "" });
  });

  it("le dépôt d'un modèle du produit signale une balise risque.<code> inconnue du barème publié, sans la rejeter", async () => {
    const produit = await obtenirPrisma().produit.findUniqueOrThrow({ where: { code: codeSecurpro } });
    const id = await creerModele(technique, { type: "COTATION", code: CODE("COT_RISQUE"), libelle: "Cotation avec risque", produitCode: codeSecurpro, ...sans }, null);
    prochaineAnalyse = analyse([...CONTENU_COTATION, "risque.type_commerce", "risque.typo_commerce"]);
    const { avertissements } = await deposerVersion(technique, id, { fichier: texte("docx"), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null);
    expect(produit.id).toBeGreaterThan(0);
    const messages = avertissements.map((a) => a.message);
    expect(messages.some((m) => m.includes("risque.typo_commerce") && /barème publié/.test(m))).toBe(true);
    expect(messages.some((m) => m.includes("risque.type_commerce"))).toBe(false);
  });
});
