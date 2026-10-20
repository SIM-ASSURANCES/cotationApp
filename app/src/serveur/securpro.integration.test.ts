// Session SECURPRO (mardi 20/10/2026) — premier produit par garanties livrable : parcours complet de bout en bout (cotation, composition
// avec montant garanti et accessoires par défaut, modification d'un montant garanti, soumission, acceptation, CP, facture, paiement, reçu)
// et contrôles de refus (date d'effet d'hier, produit sans branche, CG sans visa et sans code, composition par un Commercial).
// Données de test INVENTÉES (aucun barème du simulateur).
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { beforeAll, describe, expect, it } from "vitest";

import { ajouterJours, aujourdhui, MESSAGE_DATE_EFFET_PASSEE } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";
import type { Analyse } from "@/domaine/documents/analyse";

import { assurerBranche } from "./branches-test";
import { accepter, composerLaPrime, creerBrouillon, lireCotation, soumettre, type SaisieCotation } from "./cotations";
import { emettreCotation, emettreCp } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { creerFactureAffaireNouvelle, emettreFacture, enregistrerPaiement, lireFacture } from "./factures";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
import { creerModele, deposerVersion, listerModeles, publierVersion, soumettreVersion } from "./modeles";
import { creerProduit, creerTaxe, creerVersion, listerProduits } from "./parametrage";
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
  const versionSecurpro: VersionSaisie = {
    dateEffet: "2020-01-01",
    modeTarification: "GARANTIES",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: false, primeMinimale: null },
    fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    seuilValidationTtc: null,
    formules: [],
    garantiesSaisieLibre: true,
    garanties: [
      { libelle: "Incendie", branche: INCENDIE, montantGaranti: "50000000", accessoires: "2500" },
      { libelle: "Vol", branche: IARD, montantGaranti: "10000000", accessoires: "2500" },
      { libelle: "Dégâts des eaux", branche: IARD, montantGaranti: "5000000", accessoires: "2500" },
    ],
    references: { cgModeleCode: cgCode, cgVisa: VISA_CG, csModeleCode: null, csVisa: null },
  };
  await creerVersion(technique, codeSecurpro, versionSecurpro, null);

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

describe("Session SECURPRO : parcours complet de bout en bout (données inventées)", () => {
  it("produit SECURPRO (INCENDIE_DOMMAGES, GARANTIES, 3 garanties) : cotation → composition → soumission → acceptation → CP → facture → paiement → reçu", async () => {
    // Filtre par branche principale dans la liste des produits : SECURPRO remonte dans INCENDIE_DOMMAGES, pas dans MALADIE.
    expect((await listerProduits(technique, { branchePrincipale: "INCENDIE_DOMMAGES" })).some((p) => p.code === codeSecurpro)).toBe(true);
    expect((await listerProduits(technique, { branchePrincipale: "MALADIE" })).some((p) => p.code === codeSecurpro)).toBe(false);

    const effet = aujourdhui();
    const echeance = ajouterJours(effet, 364);
    const saisieCotation: SaisieCotation = {
      codeProduit: codeSecurpro,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur: souscripteurSecurpro,
      dateEffet: effet,
      dateEcheance: echeance,
      nombreTranches: 1,
      lignes: [],
      motifForcage: null,
      assures: [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: { bien_assure: "Atelier de menuiserie et stock (inventé)", situation: "Yopougon Zone Industrielle" },
    };

    // 1. Cotation créée par le Commercial (date d'effet = aujourd'hui).
    const cotationId = await creerBrouillon(commercial, saisieCotation, null);
    const brouillon = (await lireCotation(technique, cotationId))!;
    expect(brouillon.garantiesDuProduit).toEqual([
      { libelle: "Incendie", branche: INCENDIE, montantGaranti: "50000000", accessoires: "2500" },
      { libelle: "Vol", branche: IARD, montantGaranti: "10000000", accessoires: "2500" },
      { libelle: "Dégâts des eaux", branche: IARD, montantGaranti: "5000000", accessoires: "2500" },
    ]);

    // 2. Composition par la Technique : saisie des primes nettes, reprise des accessoires par défaut (2 500) et modification du montant garanti de « Vol » (15 000 000 au lieu de 10 000 000).
    // Calcul inventé :
    // - Incendie (12,5 %) : nette 10 000 + accessoires 2 500 = assiette 12 500 ; taxe = 12 500 × 12,5 % = 1 562,5 → 1 563 ; TTC = 14 063
    // - Vol (7,25 %) : nette 9 850 + accessoires 2 500 = assiette 12 350 ; taxe = 12 350 × 7,25 % = 895,375 → 895 ; TTC = 13 245
    // - Dégâts des eaux (7,25 %) : nette 6 000 + accessoires 2 500 = assiette 8 500 ; taxe = 8 500 × 7,25 % = 616,25 → 616 ; TTC = 9 116
    // Totaux : nette = 25 850, accessoires = 7 500, taxe = 3 074, TTC = 36 424.
    const comp = await composerLaPrime(
      technique,
      cotationId,
      brouillon.garantiesDuProduit.map((g) => ({
        libelle: g.libelle,
        branche: g.branche!,
        montantGaranti: g.libelle === "Vol" ? "15000000" : g.montantGaranti,
        primeNette: g.libelle === "Incendie" ? "10000" : g.libelle === "Vol" ? "9850" : "6000",
        accessoires: g.accessoires ?? "0",
      })),
      "Tarification SECURPRO inventée : capital Vol porté à 15 000 000 FCFA",
      null,
    );
    expect(comp.ttc).toBe("36424");

    // 3. Soumission et émission du PDF de cotation.
    const soumise = await soumettre(commercial, cotationId, null);
    expect(soumise.statut).toBe("EMISE");
    await emettreCotation(commercial, cotationId, null);
    const pdfCotation = derniereDemande("COTATION").donnees as {
      produit: { code: string; branche_libelle: string; cg_visa: string };
      prime: { nette: string; accessoires: string; taxe: string; ttc: string; taux_taxe: string | null };
      garanties_souscrites: { libelle: string; montant_garanti: string; prime_nette: string; accessoires: string; taux_taxe: string; taxe: string; ttc: string }[];
    };
    const GARANTIES_ATTENDUES = [
      { libelle: "Incendie", montant_garanti: "50000000", prime_nette: "10000", accessoires: "2500", taux_taxe: "12.5", taxe: "1563", ttc: "14063" },
      { libelle: "Vol", montant_garanti: "15000000", prime_nette: "9850", accessoires: "2500", taux_taxe: "7.25", taxe: "895", ttc: "13245" },
      { libelle: "Dégâts des eaux", montant_garanti: "5000000", prime_nette: "6000", accessoires: "2500", taux_taxe: "7.25", taxe: "616", ttc: "9116" },
    ];
    expect(pdfCotation.produit).toMatchObject({
      code: codeSecurpro,
      branche_libelle: "Incendie et dommages aux biens",
      cg_visa: VISA_CG,
    });
    expect(pdfCotation.prime).toMatchObject({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424", taux_taxe: null });
    expect(pdfCotation.garanties_souscrites).toMatchObject(GARANTIES_ATTENDUES);

    // 4. Acceptation de la cotation → création de la police.
    const numPolice = `SP-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I00001`;
    const acceptee = await accepter(commercial, cotationId, [], numPolice, null);
    expect(acceptee.numeroPolice).toBe(numPolice);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: numPolice } });
    const totaux = (police.resultat as { totaux: Record<string, unknown> }).totaux;
    expect([totaux.nette, totaux.accessoires, totaux.taxe, totaux.ttc].map((v) => String(v))).toEqual(["25850", "7500", "3074", "36424"]);
    expect(police.ttcTotal.toFixed()).toBe("36424");

    // 5. Émission des Conditions Particulières (CP) avec CG jointes.
    await emettreCp(technique, cotationId, null);
    const demandeCp = derniereDemande("CP");
    expect(demandeCp.piecesJointes).toHaveLength(1);
    const pdfCp = demandeCp.donnees as typeof pdfCotation;
    expect(pdfCp.produit).toMatchObject({
      code: codeSecurpro,
      branche_libelle: "Incendie et dommages aux biens",
      cg_visa: VISA_CG,
    });
    expect(pdfCp.prime).toMatchObject({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424", taux_taxe: null });
    expect(pdfCp.garanties_souscrites).toMatchObject(GARANTIES_ATTENDUES);

    // 6. Création et émission de la facture d'affaire nouvelle.
    const factureId = await creerFactureAffaireNouvelle(gestionnaire, police.id, null, null);
    const emissionFacture = await emettreFacture(gestionnaire, factureId, null);
    expect(emissionFacture.statut).toBe("EMISE");
    const factureLue = (await lireFacture(gestionnaire, factureId))!;
    expect(factureLue.ttc).toBe("36424");
    const pdfFacture = derniereDemande("FACTURE").donnees as typeof pdfCotation;
    expect(pdfFacture.prime).toMatchObject({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424", taux_taxe: null });
    expect(pdfFacture.garanties_souscrites).toMatchObject(GARANTIES_ATTENDUES);

    // 7. Paiement intégral et émission automatique du reçu.
    const reglement = await enregistrerPaiement(
      comptable,
      factureId,
      { date: effet, montant: "36424", canal: "VIREMENT", reference: "VIR-SECURPRO-001", payeur: "ATELIERS DU LAGON SARL" },
      null,
    );
    expect(reglement.restantDu).toBe("0");
    expect(reglement.numeroRecu).toMatch(/^REC-/);
    const pdfRecu = derniereDemande("RECU").donnees as typeof pdfCotation & { paiements: { montant: string }[] };
    expect(pdfRecu.prime).toMatchObject({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424" });
    expect(pdfRecu.garanties_souscrites).toMatchObject(GARANTIES_ATTENDUES);
    expect(pdfRecu.paiements).toMatchObject([{ montant: "36424" }]);
  });

  it("refus testés : date d'effet d'hier, produit sans branche, CG sans visa (et CG sans code signalée), composition par un Commercial", async () => {
    const hier = ajouterJours(aujourdhui(), -1);
    const echeance = ajouterJours(aujourdhui(), 364);

    // 1. Refus d'une date d'effet d'hier (création de cotation).
    await expect(
      creerBrouillon(
        commercial,
        {
          codeProduit: codeSecurpro,
          clientId: null,
          typeContrat: "INDIVIDUEL",
          souscripteur: souscripteurSecurpro,
          dateEffet: hier,
          dateEcheance: echeance,
          nombreTranches: 1,
          lignes: [],
          motifForcage: null,
          assures: [],
          beneficiaires: [],
          contactsUrgence: [],
          risque: {},
        },
        null,
      ),
    ).rejects.toThrow(MESSAGE_DATE_EFFET_PASSEE);

    // 2. Refus d'un produit sans branche principale.
    await expect(
      creerProduit(
        technique,
        { code: CODE("SANS_BR"), libelle: "Produit sans branche", gamme: "SECUR", branchePrincipale: "", branche: IARD },
        null,
      ),
    ).rejects.toThrow("La branche principale est obligatoire");

    // 3. Refus d'un dépôt de CG sans visa ; et signalement « Code CG manquant » pour une CG existante en base sans code.
    const cgTestId = await creerModele(technique, { type: "CG", code: CODE("CG_SANS_VISA"), libelle: "CG sans visa (test)", produitCode: null, ...sans }, null);
    prochaineAnalyse = analyse(["produit.cg_visa"]);
    await expect(
      deposerVersion(
        technique,
        cgTestId,
        { fichier: texte("docx cg"), nomFichier: "cg.docx", commentaire: "Essai sans visa", dateEffet: aujourdhui(), visa: "", dateDocument: "2025-06-19" },
        null,
      ),
    ).rejects.toThrow("Conditions générales : visa obligatoire");

    const cgSansCode = await obtenirPrisma().modele.upsert({
      where: { code: "" },
      update: {},
      create: { type: "CG", code: "", libelle: "Ancienne CG déposée sans code", creePar: technique.identifiant },
    });
    const listeModeles = await listerModeles(technique);
    expect(listeModeles.find((m) => m.id === cgSansCode.id)?.codeCgManquant).toBe(true);
    await expect(
      deposerVersion(
        technique,
        cgSansCode.id,
        { fichier: texte("docx cg"), nomFichier: "cg.docx", commentaire: "Essai sans code", dateEffet: aujourdhui(), visa: VISA_CG, dateDocument: "2025-06-19" },
        null,
      ),
    ).rejects.toThrow("Conditions générales : code obligatoire");

    // 4. Refus de la composition par un Commercial.
    const cotationId = await creerBrouillon(
      commercial,
      {
        codeProduit: codeSecurpro,
        clientId: null,
        typeContrat: "INDIVIDUEL",
        souscripteur: souscripteurSecurpro,
        dateEffet: aujourdhui(),
        dateEcheance: echeance,
        nombreTranches: 1,
        lignes: [],
        motifForcage: null,
        assures: [],
        beneficiaires: [],
        contactsUrgence: [],
        risque: {},
      },
      null,
    );
    await expect(
      composerLaPrime(
        commercial,
        cotationId,
        [{ libelle: "Incendie", branche: INCENDIE, montantGaranti: "50000000", primeNette: "10000", accessoires: "2500" }],
        "Tentative par un Commercial",
        null,
      ),
    ).rejects.toThrow(ErreurAcces);
  });
});
