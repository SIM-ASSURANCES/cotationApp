import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

import { calculer } from "@/domaine/calcul/calcul";
import { composer, estComposition, tauxUnique, type DonneesCalcul } from "@/domaine/calcul/composition";
import { ZERO as ZERO_MONTANT } from "@/domaine/calcul/montant";
import { libelleBranchePrincipale } from "@/domaine/calcul/parametrage";
import type { DateIso } from "@/domaine/calcul/dates";
import { dateAdhesion, estContratDeGroupe, type VersionAdherents } from "@/domaine/cotation/adherents";
import { normaliserNumeroPolice, numeroCertificatParDefaut, problemesNumeroCertificat } from "@/domaine/cotation/police";
import type { Assure, Beneficiaire, ContactUrgence, Risque, Souscripteur } from "@/domaine/cotation/saisie";
import { ecartEnJours } from "@/domaine/calcul/dates";
import { statutEffectif, type StatutCotation } from "@/domaine/cotation/statuts";
import { donneesDocument, type FormuleSource, type GarantieSource, type SourceDocument } from "@/domaine/documents/donnees";
import {
  DOCUMENTS,
  estTypeDocument,
  masquerSouscripteur,
  nomSouscripteur,
  problemesVisas,
  statutPublic,
  type StatutPublic,
  type TypeDocument,
} from "@/domaine/documents/emission";
import { IMAGES_SOCIETE } from "@/domaine/documents/societe";
import { peutAgir, peutLire, type CodeAction } from "@/domaine/droits";

import { journaliser, type ActeurAudit } from "./audit";
import { versIntermediairesDocument } from "./intermediaires";
import { obtenirConfig } from "./config";
import { niveauDuProfil } from "./droits";
import { generateur, type ImagePng } from "./generateur";
import { exigerDetailDesGaranties, fichiersAssocies, lireSeuilListe, modelesAssocies, versionPublieeEnVigueur, type VersionsAssociees } from "./modeles";
import { aujourdhui, exigerCalculAutomatique, exigerComposition, MESSAGE_NON_COMPOSEE } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { lireImageSociete, lireParametresSociete } from "./societe";
import { differerEcriture, ecrituresDifferees, lireDocumentEmis, programmerReprise, stockage, tenterEcriture } from "./stockage";
import { fermerTachesAutomatiquement } from "./taches-police";
import { calculerCheminStockage } from "./stockage-arborescence";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { cloreValidationContrat, controlerSeuilContrat, demanderValidationContrat, exigerAutreQueLeDemandeur } from "./validation-contrat";

/**
 * Documents émis (CDC §6.8, §14) : émission (fusion, assemblage, QR code, empreinte, stockage en
 * ajout seul), réédition à l'identique (T10) avec filigrane (T11), vérification publique (T12),
 * recherche et téléchargement.
 */

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const sha256 = (octets: Uint8Array) => createHash("sha256").update(octets).digest("hex");

/** Jeton du QR code : 256 bits aléatoires (CDC §14.1 : non devinable, jamais un identifiant). */
export const nouveauJeton = () => randomBytes(32).toString("base64url");

// ---------------------------------------------------------------- Droits (CDC §4)

/** Action dont le niveau ouvre la lecture et l'émission de chaque type de document (hypothèse H21). */
const ACTION_DU_TYPE: Record<TypeDocument, CodeAction> = {
  COTATION: "CREER_COTATION",
  CP: "EMETTRE_CONTRAT",
  CERTIFICAT: "EMETTRE_CONTRAT",
  FACTURE: "EMETTRE_FACTURE",
  AVOIR: "EMETTRE_AVOIR",
  RECU: "ENREGISTRER_PAIEMENT",
  AVIS_ECHEANCE: "EMETTRE_FACTURE",
  RELANCE: "EMETTRE_FACTURE",
};

async function typesLisibles(acteur: UtilisateurCourant): Promise<TypeDocument[]> {
  const lisibles: TypeDocument[] = [];
  for (const [type, action] of Object.entries(ACTION_DU_TYPE) as [TypeDocument, CodeAction][]) {
    if (peutLire(await niveauDuProfil(acteur.profil, action))) lisibles.push(type);
  }
  return lisibles;
}

async function exigerSurType(acteur: UtilisateurCourant, type: TypeDocument, ecriture: boolean): Promise<void> {
  const niveau = await niveauDuProfil(acteur.profil, ACTION_DU_TYPE[type]);
  if (!(ecriture ? peutAgir(niveau) : peutLire(niveau))) {
    throw new ErreurAcces(`Droit insuffisant : ${DOCUMENTS[type].libelle.toLowerCase()}.`);
  }
}

// ---------------------------------------------------------------- Sources : cotation et police

export type ContexteProduit = {
  produit: { id: number; code: string; libelle: string; gamme: string; branche: string; branche_libelle: string | null };
  versionDateEffet: DateIso;
  /** Mode de tarification de la version figée : seul FORMULE a des montants issus du moteur (session 6.2a). */
  modeTarification: string;
  formules: Map<string, { libelle: string; tauxCouverture: string | null }>;
  references: { cgModeleCode: string | null; cgVisa: string | null; csModeleCode: string | null; csVisa: string | null };
};

export async function contexteProduit(produitId: number, versionDateEffet: Date): Promise<ContexteProduit> {
  const version = await obtenirPrisma().produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId, dateEffet: versionDateEffet } },
    include: { formules: true, produit: { include: { branchePrincipaleRef: true } } },
  });
  return {
    produit: {
      id: version.produit.id,
      code: version.produit.code,
      libelle: version.produit.libelle,
      gamme: version.produit.gamme,
      branche: version.produit.branche,
      branche_libelle: version.produit.branchePrincipaleRef?.libelle ?? libelleBranchePrincipale(version.produit.branchePrincipale),
    },
    versionDateEffet: depuisDate(versionDateEffet),
    modeTarification: version.modeTarification,
    formules: new Map(version.formules.map((f) => [f.code, { libelle: f.libelle, tauxCouverture: f.tauxCouverture ? f.tauxCouverture.toFixed() : null }])),
    references: { cgModeleCode: version.cgModeleCode, cgVisa: version.cgVisa, csModeleCode: version.csModeleCode, csVisa: version.csVisa },
  };
}

/**
 * Montants d'un calcul figé (recalculés à l'identique depuis l'entrée figée) : formule par formule pour un calcul automatique, garantie par
 * garantie pour une composition manuelle (session 6.2b). Passage de la création des factures d'affaire nouvelle, de renouvellement et
 * d'avenant, des CP et du PDF de cotation. La nature du calcul doit correspondre au mode de la version (sessions 6.2a et 6.2b).
 */
export function montantsDu(donnees: DonneesCalcul, contexte: ContexteProduit) {
  const t = (m: { toFixed(): string }) => m.toFixed();
  if (estComposition(donnees)) {
    exigerComposition(contexte.modeTarification);
    if (donnees.lignes.length === 0) throw new ErreurMetier(MESSAGE_NON_COMPOSEE);
    const resultat = composer(donnees);
    let base = ZERO_MONTANT;
    const garanties: GarantieSource[] = resultat.lignes.map((l, i) => {
      const ligne = donnees.lignes[i];
      const baseLigne = ligne.assiette === "NETTE_ACCESSOIRES" ? l.arrondi.nette.plus(l.arrondi.accessoires) : l.arrondi.nette;
      base = base.plus(baseLigne);
      return {
        libelle: ligne.libelle,
        branche: ligne.branche,
        ...(ligne.montantGaranti !== undefined ? { montantGaranti: ligne.montantGaranti } : {}),
        nette: t(l.arrondi.nette),
        accessoires: t(l.arrondi.accessoires),
        tauxTaxe: ligne.tauxPourcent,
        taxe: t(l.arrondi.taxe),
        ttc: t(l.arrondi.ttc),
        baseTaxe: t(baseLigne),
      };
    });
    const a = resultat.totaux.arrondi;
    const assiettes = new Set(donnees.lignes.map((l) => l.assiette));
    return {
      resultat,
      formules: [] as FormuleSource[],
      garanties,
      totaux: { nette: t(a.nette), accessoires: t(a.accessoires), taxe: t(a.taxe), ttc: t(a.ttc), baseTaxe: t(base) },
      // `prime.taux_taxe` : rempli quand un seul taux s'applique, vide (null) quand il y en a plusieurs.
      taxe: { tauxPourcent: tauxUnique(donnees.lignes), assiette: assiettes.size === 1 ? [...assiettes][0] : "NETTE_ACCESSOIRES" },
    };
  }
  // Aucun document, aucune facture ne reprend des montants du moteur pour un produit tarifé par garanties (session 6.2a).
  exigerCalculAutomatique(contexte.modeTarification);
  const entree = donnees;
  const resultat = calculer(entree);
  const formules: FormuleSource[] = resultat.lignes.map((l, i) => ({
    code: l.code,
    libelle: contexte.formules.get(l.code)?.libelle ?? l.code,
    tauxCouverture: contexte.formules.get(l.code)?.tauxCouverture ?? null,
    effectif: l.effectif,
    primeUnitaire: String(entree.lignes[i].primeUnitaire),
    // H45 (décision de Thierry du 08/10/2026) : TTC d'une unité de la formule, comme le « TTC/personne » de T1.
    primeParAssure: t(l.ttcParUnite),
    nette: t(l.arrondi.nette),
    accessoires: t(l.arrondi.accessoires),
    taxe: t(l.arrondi.taxe),
    ttc: t(l.arrondi.ttc),
  }));
  const a = resultat.totaux.arrondi;
  return {
    resultat,
    formules,
    garanties: [] as GarantieSource[],
    totaux: { nette: t(a.nette), accessoires: t(a.accessoires), taxe: t(a.taxe), ttc: t(a.ttc) } as { nette: string; accessoires: string; taxe: string; ttc: string; baseTaxe?: string },
    taxe: { tauxPourcent: String(entree.parametres.taxe.tauxPourcent) as string | null, assiette: entree.parametres.taxe.assiette as string },
  };
}

const echeances = (json: unknown) => (Array.isArray(json) ? (json as { numero: number; date: string; montant: string }[]) : []);

// ---------------------------------------------------------------- Production d'un document

type Production = {
  type: TypeDocument;
  numero: string;
  produitCode: string;
  policeNumero: string | null;
  souscripteur: Souscripteur;
  cotationId: number | null;
  policeId: number | null;
  dateEmission: DateIso;
  dateValidite: DateIso | null;
  parametresDate: DateIso;
  modele: { versionId: number; fichier: Uint8Array; champs: string[] };
  associes: { annexes: Record<string, Uint8Array>; sousModeles: Record<string, Record<string, Uint8Array>>; ids: VersionsAssociees };
  pieces: { cs: { versionId: number; pdf: Uint8Array } | null; cg: { versionId: number; pdf: Uint8Array } | null };
  /** Données complètes (réédition), ou à construire avec le jeton et le numéro de version. */
  donnees: (version: number, url: string) => Record<string, unknown>;
  filigrane: string | null;
  origine: { id: number } | null;
  /** Listes toujours renvoyées en annexe (police mère d'un contrat de groupe) ; conservées pour la réédition. */
  listesEnAnnexe?: string[];
  /** Certificat d'adhésion : numéro d'ordre de l'adhérent dans la police mère. */
  adherentOrdre?: number | null;
  /** Conditions particulières d'un contrat de groupe : version de la liste des adhérents utilisée. */
  versionAdherents?: number | null;
};

export type DocumentLu = {
  id: number;
  type: TypeDocument;
  libelleType: string;
  numero: string;
  version: number;
  dateEmission: DateIso;
  emisLe: Date;
  emisPar: string;
  produitCode: string;
  policeNumero: string | null;
  souscripteur: string;
  empreinte: string;
  taille: number;
  filigrane: string | null;
  statut: StatutPublic;
  urlVerification: string | null;
};

export function urlPublique(): string {
  const url = obtenirConfig().URL_PUBLIQUE;
  if (!url) {
    throw new ErreurMetier("Adresse publique de l'application non configurée (variable URL_PUBLIQUE) : les QR codes de vérification ne peuvent pas être produits. Prévenez l'administrateur.");
  }
  return url.replace(/\/+$/, "");
}

export async function images(champs: string[]): Promise<Record<string, ImagePng>> {
  const resultat: Record<string, ImagePng> = {};
  for (const nom of IMAGES_SOCIETE) {
    if (!champs.includes(nom)) continue;
    const png = await lireImageSociete(nom);
    if (!png) throw new ErreurMetier(`Le modèle utilise {{ ${nom} }}, mais cette image n'est pas paramétrée (écran « Société »).`);
    resultat[nom] = { png, largeurMm: nom === "signature_sim" ? 40 : 35 };
  }
  return resultat;
}

async function produire(acteur: UtilisateurCourant, p: Production, adresseIp: string | null): Promise<DocumentLu> {
  const prisma = obtenirPrisma();
  const base = urlPublique();
  const precedente = await prisma.documentEmis.aggregate({ where: { numero: p.numero }, _max: { version: true } });
  const version = (precedente._max.version ?? 0) + 1;
  const jeton = nouveauJeton();
  const url = `${base}/verif/${jeton}`;
  const donnees = p.donnees(version, url);

  const pdf = await generateur().genererPdf({
    modele: p.modele.fichier,
    donnees,
    seuilListe: await lireSeuilListe(p.dateEmission),
    annexes: p.associes.annexes,
    sousModeles: p.associes.sousModeles,
    images: await images(p.modele.champs),
    qr: { url },
    // Ordre du contrat (CDC §6.8) : CP, annexes (ajoutées par le générateur), CS, CG.
    piecesJointes: [p.pieces.cs?.pdf, p.pieces.cg?.pdf].filter((x): x is Uint8Array => x !== undefined),
    filigrane: p.filigrane ?? undefined,
    listesEnAnnexe: p.listesEnAnnexe,
  });

  const empreinte = sha256(pdf);
  const chemin = await calculerCheminStockage(prisma, {
    type: p.type,
    numero: p.numero,
    version,
    produitCode: p.produitCode,
    policeNumero: p.policeNumero,
    cotationId: p.cotationId,
    policeId: p.policeId,
    versionAdherents: p.versionAdherents,
    adherentOrdre: p.adherentOrdre,
  });
  // Stockage indisponible (T14) : le document est émis quand même, son fichier attend en base (écriture différée).
  const ecriture = await tenterEcriture(chemin, pdf, empreinte);

  const versionsAssociees = {
    ...p.associes.ids,
    cs: p.pieces.cs?.versionId ?? null,
    cg: p.pieces.cg?.versionId ?? null,
    listesEnAnnexe: p.listesEnAnnexe ?? [],
    versionAdherents: p.versionAdherents ?? null,
  };
  const cree = await prisma.$transaction(async (tx) => {
    const ligne = await tx.documentEmis.create({
      data: {
        type: p.type,
        numero: p.numero,
        version,
        origineId: p.origine?.id ?? null,
        jeton,
        chemin,
        empreinte,
        taille: pdf.byteLength,
        produitCode: p.produitCode,
        policeNumero: p.policeNumero,
        souscripteurNom: nomSouscripteur(p.souscripteur),
        souscripteurMasque: masquerSouscripteur(p.souscripteur),
        cotationId: p.cotationId,
        policeId: p.policeId,
        adherentOrdre: p.adherentOrdre ?? null,
        dateEmission: versDate(p.dateEmission),
        dateValidite: p.dateValidite ? versDate(p.dateValidite) : null,
        modeleVersionId: p.modele.versionId,
        versionsAssociees: versionsAssociees as unknown as Prisma.InputJsonValue,
        parametresDate: versDate(p.parametresDate),
        donnees: donnees as Prisma.InputJsonValue,
        filigrane: p.filigrane,
        emisPar: acteur.identifiant,
      },
    });
    await journaliser(
      {
        acteur: auteur(acteur),
        action: version === 1 ? "DOCUMENT_EMIS" : "DOCUMENT_REEDITE",
        objetType: "document",
        objetId: ligne.id,
        apres: { type: p.type, numero: p.numero, version, empreinte, chemin, modeleVersionId: p.modele.versionId, filigrane: p.filigrane },
        adresseIp,
      },
      tx,
    );
    if (!ecriture.ecrit) await differerEcriture(tx, { documentId: ligne.id, numero: p.numero, version, chemin, empreinte, contenu: pdf, erreur: ecriture.erreur }, auteur(acteur), adresseIp);
    // H66 : une version des CP émise ferme les tâches « Nouvelle version des CP à émettre » qu'elle satisfait.
    if (p.type === "CP" && p.policeId !== null) await fermerTachesAutomatiquement(tx, p.policeId, auteur(acteur), adresseIp);
    return ligne;
  });
  if (!ecriture.ecrit) await programmerReprise(cree.id);
  return versLu(cree);
}

type LigneDocument = Prisma.DocumentEmisGetPayload<object>;

export function versLu(d: LigneDocument): DocumentLu {
  const type = d.type as TypeDocument;
  return {
    id: d.id,
    type,
    libelleType: DOCUMENTS[type]?.libelle ?? d.type,
    numero: d.numero,
    version: d.version,
    dateEmission: depuisDate(d.dateEmission),
    emisLe: d.emisLe,
    emisPar: d.emisPar,
    produitCode: d.produitCode,
    policeNumero: d.policeNumero,
    souscripteur: d.souscripteurNom,
    empreinte: d.empreinte,
    taille: d.taille,
    filigrane: d.filigrane,
    statut: statutPublic({ type, annuleParNumero: d.annuleParNumero, dateValidite: d.dateValidite ? depuisDate(d.dateValidite) : null }, aujourdhui()),
    urlVerification: ((d.donnees as { doc?: { url_verification?: string } }).doc?.url_verification ?? null) as string | null,
  };
}

async function modeleEnVigueur(type: "COTATION" | "CP" | "CERTIFICAT", produitId: number, produitCode: string, date: DateIso, donnees: DonneesCalcul | null = null) {
  const retenu = await versionPublieeEnVigueur({ type, produitId }, date);
  if (!retenu) {
    throw new ErreurMetier(`Aucun modèle de ${{ COTATION: "cotation", CP: "conditions particulières", CERTIFICAT: "certificat d'adhésion" }[type]} publié et en vigueur pour le produit ${produitCode} : déposez-le et faites-le publier (Modèles Word).`);
  }
  const v = await obtenirPrisma().modeleVersion.findUniqueOrThrow({ where: { id: retenu.version.id }, select: { id: true, fichier: true, analyse: true } });
  const champs = ((v.analyse as { champs?: string[] }).champs ?? []) as string[];
  // Produit par garanties (6.2b) : cotation et CP détaillent les garanties ; le certificat d'adhésion n'a pas de prime (H36).
  if (type !== "CERTIFICAT" && donnees !== null) exigerDetailDesGaranties(type === "CP" ? "conditions particulières" : "cotation", champs, estComposition(donnees) && donnees.lignes.length > 0);
  return { versionId: v.id, fichier: v.fichier, champs };
}

/** CG et CS du produit, publiées et en vigueur ; visas vérifiés (contrôle bloquant, §6.8). */
async function piecesContractuelles(contexte: ContexteProduit, date: DateIso, obligatoire: boolean) {
  const r = contexte.references;
  if (obligatoire && !r.cgModeleCode) {
    throw new ErreurMetier(`Le produit ${contexte.produit.code} n'a pas de conditions générales dans son paramétrage (version du ${contexte.versionDateEffet}) : renseignez-les avant d'émettre le contrat.`);
  }
  const charger = async (code: string | null, quoi: string) => {
    if (!code) return null;
    const retenu = await versionPublieeEnVigueur({ code }, date);
    if (!retenu) throw new ErreurMetier(`${quoi} « ${code} » : aucune version publiée en vigueur.`);
    const v = await obtenirPrisma().modeleVersion.findUniqueOrThrow({ where: { id: retenu.version.id }, select: { id: true, pdf: true } });
    if (!v.pdf) throw new ErreurMetier(`${quoi} « ${code} » : PDF absent (il est produit à la publication).`);
    return { versionId: v.id, pdf: v.pdf, code, libelle: retenu.modele.libelle, visa: retenu.version.visa, date: retenu.version.dateDocument };
  };
  const cg = await charger(r.cgModeleCode, "Conditions générales");
  const cs = await charger(r.csModeleCode, "Conventions spéciales");
  const problemes = problemesVisas({ cgVisa: r.cgVisa, csVisa: r.csVisa }, { cg, cs });
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  return { cg, cs };
}

async function sourceCommune(contexte: ContexteProduit, date: DateIso) {
  return {
    produit: {
      code: contexte.produit.code,
      libelle: contexte.produit.libelle,
      gamme: contexte.produit.gamme,
      branche: contexte.produit.branche,
      branche_libelle: contexte.produit.branche_libelle,
    },
    ...(await lireParametresSociete(date)),
  };
}

// ---------------------------------------------------------------- Cotation (CDC §9)

export async function chargerCotation(id: number) {
  const c = await obtenirPrisma().cotation.findUnique({ where: { id }, include: { produit: true, intermediaires: true } });
  if (!c) throw new ErreurMetier("Cotation introuvable.");
  // doc.auteur_nom (D20) : nom de l'utilisateur qui a créé la cotation.
  const auteur = await obtenirPrisma().utilisateur.findUnique({ where: { id: c.auteurId }, select: { nom: true } });
  return { ...c, auteurNom: auteur?.nom ?? c.auteurIdentifiant };
}

function sourceDeCotation(
  c: Awaited<ReturnType<typeof chargerCotation>>,
  contexte: ContexteProduit,
  commun: Awaited<ReturnType<typeof sourceCommune>>,
  pieces: { cg: { libelle: string; visa: string | null; date: DateIso | null } | null; cs: { libelle: string; visa: string | null } | null },
  numero: string,
  version: number,
  url: string | null,
): SourceDocument {
  const m = montantsDu(c.donneesCalcul as unknown as DonneesCalcul, contexte);
  return {
    type: "COTATION",
    numero,
    version,
    dateEmission: c.dateEtablissement ? depuisDate(c.dateEtablissement) : aujourdhui(),
    dateValidite: c.dateValidite ? depuisDate(c.dateValidite) : null,
    policeNumero: null,
    produit: commun.produit,
    cg: pieces.cg ? { libelle: pieces.cg.libelle, visa: contexte.references.cgVisa ?? pieces.cg.visa ?? "", date: pieces.cg.date } : null,
    cs: pieces.cs ? { libelle: pieces.cs.libelle, visa: contexte.references.csVisa ?? pieces.cs.visa ?? "" } : null,
    souscripteur: c.souscripteur as unknown as Souscripteur,
    assures: c.assures as unknown as Assure[],
    ordresSansPrime: [],
    beneficiaires: (c.beneficiaires as unknown as Beneficiaire[] | null) ?? null,
    contactsUrgence: (c.contactsUrgence as unknown as ContactUrgence[] | null) ?? null,
    intermediaires: versIntermediairesDocument(c.intermediaires),
    policeMere: null,
    risque: c.risque as unknown as Risque,
    dateEffet: depuisDate(c.dateEffet),
    dateEcheance: depuisDate(c.dateEcheance),
    joursCouverts: m.resultat.joursCouverts,
    formules: m.formules,
    garanties: m.garanties,
    totaux: m.totaux,
    taxe: m.taxe,
    echeances: echeances(c.echeancier),
    forcee: c.motifForcage !== null,
    motifForcage: c.motifForcage,
    societe: commun.societe,
    mentions: commun.document,
    urlVerification: url,
    typeContrat: c.typeContrat,
    auteurNom: c.auteurNom,
  };
}

/** Une cotation cite ses CG si elles sont paramétrées et publiées, sans les joindre ni bloquer. */
async function citationsCotation(contexte: ContexteProduit, date: DateIso) {
  try {
    const { cg, cs } = await piecesContractuelles(contexte, date, false);
    return { cg, cs };
  } catch {
    return { cg: null, cs: null };
  }
}

/** Émission du PDF d'une cotation émise (numéro définitif, QR code, stockage) : une seule fois. */
export async function emettreCotation(acteur: UtilisateurCourant, cotationId: number, adresseIp: string | null): Promise<DocumentLu> {
  await exigerSurType(acteur, "COTATION", true);
  const c = await chargerCotation(cotationId);
  if (!c.numero || c.statut === "BROUILLON" || c.statut === "A_VALIDER") throw new ErreurMetier("Seule une cotation émise a un PDF définitif : utilisez l'aperçu.");
  if (await obtenirPrisma().documentEmis.findFirst({ where: { cotationId, type: "COTATION" } })) {
    throw new ErreurMetier("Le PDF de cette cotation est déjà émis : utilisez « Rééditer ».");
  }
  const date = c.dateEtablissement ? depuisDate(c.dateEtablissement) : aujourdhui();
  const contexte = await contexteProduit(c.produitId, c.versionDateEffet);
  const modele = await modeleEnVigueur("COTATION", c.produitId, c.produit.code, date, c.donneesCalcul as unknown as DonneesCalcul);
  const associes = await modelesAssocies(c.produitId, date, false);
  const commun = await sourceCommune(contexte, date);
  const citees = await citationsCotation(contexte, date);
  const numero = c.numero;
  return produire(
    acteur,
    {
      type: "COTATION",
      numero,
      produitCode: c.produit.code,
      policeNumero: null,
      souscripteur: c.souscripteur as unknown as Souscripteur,
      cotationId: c.id,
      policeId: null,
      dateEmission: date,
      dateValidite: c.dateValidite ? depuisDate(c.dateValidite) : null,
      parametresDate: contexte.versionDateEffet,
      modele,
      associes,
      pieces: { cg: null, cs: null },
      donnees: (version, url) => donneesDocument(sourceDeCotation(c, contexte, commun, citees, numero, version, url)),
      filigrane: null,
      origine: null,
    },
    adresseIp,
  );
}

/** Aperçu PDF d'une cotation (brouillon compris) : modèle publié, filigrane « APERÇU », rien n'est stocké. */
export async function apercuCotation(acteur: UtilisateurCourant, cotationId: number): Promise<{ nom: string; contenu: Uint8Array }> {
  await exigerSurType(acteur, "COTATION", false);
  const c = await chargerCotation(cotationId);
  const date = aujourdhui();
  const contexte = await contexteProduit(c.produitId, c.versionDateEffet);
  const modele = await modeleEnVigueur("COTATION", c.produitId, c.produit.code, date, c.donneesCalcul as unknown as DonneesCalcul);
  const associes = await modelesAssocies(c.produitId, date, false);
  const commun = await sourceCommune(contexte, date);
  const citees = await citationsCotation(contexte, date);
  const donnees = donneesDocument(sourceDeCotation(c, contexte, commun, citees, c.numero ?? "APERÇU", 1, null));
  const contenu = await generateur().genererPdf({
    modele: modele.fichier,
    donnees,
    seuilListe: await lireSeuilListe(date),
    annexes: associes.annexes,
    sousModeles: associes.sousModeles,
    images: await images(modele.champs),
    // Le QR code d'un aperçu ne renvoie vers aucun document : adresse sans jeton valide.
    qr: { url: `${obtenirConfig().URL_PUBLIQUE ?? "https://apercu.invalide"}/verif/apercu` },
    filigrane: "APERÇU",
  });
  return { nom: `apercu_${c.numero ?? `brouillon_${c.id}`}.pdf`, contenu };
}

// ---------------------------------------------------------------- Contrat : conditions particulières

type PoliceChargee = Prisma.PoliceGetPayload<{ include: { adherents: true } }>;
type CotationChargee = Awaited<ReturnType<typeof chargerCotation>>;

/** Versions de la liste des adhérents d'une police de groupe, au format du domaine. */
export const versionsAdherentsDe = (police: PoliceChargee): VersionAdherents[] =>
  police.adherents.map((v) => ({
    numero: v.numero,
    motif: v.motif as VersionAdherents["motif"],
    dateEffet: depuisDate(v.dateEffet),
    adherents: v.adherents as unknown as Assure[],
    concernes: v.concernes as unknown as number[],
  }));

/** Adhérents ajoutés après la liste initiale : leur prime n'est pas dans le calcul de la police (assures[].prime reste vide). */
const ordresIncorpores = (police: PoliceChargee): number[] => {
  const initiale = police.adherents.find((v) => v.motif === "INITIALE");
  if (!initiale) return [];
  const dansLeCalcul = new Set((initiale.adherents as unknown as Assure[]).map((a) => a.ordre));
  return (police.assures as unknown as Assure[]).filter((a) => !dansLeCalcul.has(a.ordre)).map((a) => a.ordre);
};

const derniereVersionAdherents = (police: PoliceChargee): number | null => (police.adherents.length === 0 ? null : Math.max(...police.adherents.map((v) => v.numero)));

/**
 * Production des conditions particulières d'une police : CP → annexes → CS → CG, visas vérifiés (§6.8).
 * Contrat de groupe (§10.2) : c'est la police MÈRE ; la liste des adhérents (la liste courante) est
 * TOUJOURS renvoyée en annexe, même courte, et la version de cette liste est conservée avec le document.
 */
async function productionCp(c: CotationChargee, police: PoliceChargee): Promise<Production> {
  const date = aujourdhui();
  const contexte = await contexteProduit(c.produitId, c.versionDateEffet);
  const modele = await modeleEnVigueur("CP", c.produitId, c.produit.code, date, police.donneesCalcul as unknown as DonneesCalcul);
  const associes = await modelesAssocies(c.produitId, date, false);
  const commun = await sourceCommune(contexte, date);
  const pieces = await piecesContractuelles(contexte, date, true);
  const m = montantsDu(police.donneesCalcul as unknown as DonneesCalcul, contexte);
  const groupe = estContratDeGroupe(police.typeContrat);
  const source = (version: number, url: string): SourceDocument => ({
    type: "CP",
    numero: police.numero,
    version,
    dateEmission: date,
    dateValidite: null,
    policeNumero: police.numero,
    produit: commun.produit,
    cg: pieces.cg ? { libelle: pieces.cg.libelle, visa: contexte.references.cgVisa ?? "", date: pieces.cg.date } : null,
    cs: pieces.cs ? { libelle: pieces.cs.libelle, visa: contexte.references.csVisa ?? "" } : null,
    souscripteur: police.souscripteur as unknown as Souscripteur,
    assures: police.assures as unknown as Assure[],
    ordresSansPrime: ordresIncorpores(police),
    beneficiaires: (police.beneficiaires as unknown as Beneficiaire[] | null) ?? null,
    contactsUrgence: (police.contactsUrgence as unknown as ContactUrgence[] | null) ?? null,
    intermediaires: versIntermediairesDocument(c.intermediaires),
    policeMere: null,
    risque: police.risque as unknown as Risque,
    dateEffet: depuisDate(police.dateEffet),
    dateEcheance: depuisDate(police.dateEcheance),
    joursCouverts: m.resultat.joursCouverts,
    formules: m.formules,
    garanties: m.garanties,
    totaux: m.totaux,
    taxe: m.taxe,
    echeances: echeances(police.echeancier),
    forcee: c.motifForcage !== null,
    motifForcage: c.motifForcage,
    societe: commun.societe,
    mentions: commun.document,
    urlVerification: url,
    typeContrat: police.typeContrat,
    auteurNom: c.auteurNom,
  });
  return {
    type: "CP",
    numero: police.numero,
    produitCode: c.produit.code,
    policeNumero: police.numero,
    souscripteur: police.souscripteur as unknown as Souscripteur,
    cotationId: c.id,
    policeId: police.id,
    dateEmission: date,
    dateValidite: null,
    parametresDate: contexte.versionDateEffet,
    modele,
    associes,
    pieces: { cs: pieces.cs ? { versionId: pieces.cs.versionId, pdf: pieces.cs.pdf } : null, cg: pieces.cg ? { versionId: pieces.cg.versionId, pdf: pieces.cg.pdf } : null },
    donnees: (version, url) => donneesDocument(source(version, url)),
    filigrane: null,
    origine: null,
    listesEnAnnexe: groupe ? ["assures"] : [],
    versionAdherents: groupe ? derniereVersionAdherents(police) : null,
  };
}

/** Vérifications communes à la demande et à l'émission des CP d'une police : droit, police, pas déjà émises, seuil. */
async function preparerCp(acteur: UtilisateurCourant, cotationId: number) {
  await exigerSurType(acteur, "CP", true);
  const c = await chargerCotation(cotationId);
  const police = await obtenirPrisma().police.findUnique({ where: { cotationId }, include: { adherents: true } });
  if (!police) throw new ErreurMetier("Pas de police : les conditions particulières s'émettent après l'acceptation de la cotation.");
  if (await obtenirPrisma().documentEmis.findFirst({ where: { policeId: police.id, type: "CP" } })) {
    throw new ErreurMetier("Les conditions particulières de cette police sont déjà émises : utilisez « Rééditer ».");
  }
  return { c, police, seuil: await controlerSeuilContrat(acteur, police, c) };
}

const messageSeuil = (ttc: string, seuil: string | null) =>
  `Le TTC du contrat (${ttc} F) dépasse le seuil de validation du produit (${seuil ?? "?"} F) : le contrat doit être validé, puis émis, par un profil habilité (CDC §4.1).`;

/**
 * Émission des CP d'une police (cotation acceptée) : CP → annexes → CS → CG, visas vérifiés (§6.8).
 * Un profil « Oui (sous seuil) » ne peut pas émettre au-dessus du seuil du produit : il passe par `soumettreCp`, qui
 * met le contrat en validation. Un profil « Oui » qui émet clôt la demande de validation qui existerait (D22).
 */
export async function emettreCp(acteur: UtilisateurCourant, cotationId: number, adresseIp: string | null): Promise<DocumentLu> {
  const { c, police, seuil } = await preparerCp(acteur, cotationId);
  if (seuil.requise) throw new ErreurMetier(messageSeuil(seuil.ttc, seuil.seuil));
  await exigerAutreQueLeDemandeur(acteur, police.id);
  const document = await produire(acteur, await productionCp(c, police), adresseIp);
  await cloreValidationContrat(acteur, police.id, police.numero, adresseIp);
  return document;
}

/** Résultat de la demande d'émission des CP : émises, ou passées en validation (au-dessus du seuil du produit). */
export type ResultatCp = { statut: "EMISE"; document: DocumentLu } | { statut: "A_VALIDER"; ttc: string; seuil: string | null; demandeePar: string };

/**
 * Point d'entrée des écrans : émet les CP, ou, pour un profil « Oui (sous seuil) » dont le contrat dépasse le seuil du
 * produit, enregistre la demande de validation (« À valider ») sans rien émettre. CDC §4 et §4.1, D22.
 */
export async function soumettreCp(acteur: UtilisateurCourant, cotationId: number, adresseIp: string | null): Promise<ResultatCp> {
  const { police, seuil } = await preparerCp(acteur, cotationId);
  if (!seuil.requise) return { statut: "EMISE", document: await emettreCp(acteur, cotationId, adresseIp) };
  const demande = await demanderValidationContrat(acteur, police.id, police.numero, seuil, adresseIp);
  return { statut: "A_VALIDER", ttc: seuil.ttc, seuil: seuil.seuil, demandeePar: demande.demandeePar };
}

/**
 * Contrat de groupe : après une incorporation ou un retrait d'adhérents, nouvelle VERSION des conditions
 * particulières (même numéro, version + 1), dont l'annexe reprend la liste à jour (§10.2). Refusée tant
 * que les CP n'ont pas été émises, ou si la liste n'a pas changé depuis la dernière édition.
 */
export async function mettreAJourCp(acteur: UtilisateurCourant, policeId: number, adresseIp: string | null): Promise<DocumentLu> {
  await exigerSurType(acteur, "CP", true);
  const police = await obtenirPrisma().police.findUnique({ where: { id: policeId }, include: { adherents: true } });
  if (!police) throw new ErreurMetier("Police introuvable.");
  if (!estContratDeGroupe(police.typeContrat)) throw new ErreurMetier("Seul un contrat de groupe a une liste d'adhérents qui évolue.");
  const derniere = await obtenirPrisma().documentEmis.findFirst({ where: { policeId, type: "CP" }, orderBy: { version: "desc" } });
  if (!derniere) throw new ErreurMetier("Les conditions particulières de cette police ne sont pas encore émises : émettez-les d'abord.");
  const editee = (derniere.versionsAssociees as { versionAdherents?: number | null }).versionAdherents ?? null;
  if (editee !== null && editee === derniereVersionAdherents(police)) {
    throw new ErreurMetier("La liste des adhérents n'a pas changé depuis la dernière édition des conditions particulières.");
  }
  return produire(acteur, await productionCp(await chargerCotation(police.cotationId), police), adresseIp);
}

// ---------------------------------------------------------------- Contrat de groupe : certificat d'adhésion (§10.2)

/** Numéro donné, dans un import confirmé, à un AUTRE adhérent dont le certificat n'est pas encore produit. */
async function numeroReserveParImport(policeId: number, adherentOrdre: number, numero: string): Promise<boolean> {
  const lignes = await obtenirPrisma().ligneImport.findMany({
    where: { documentId: null, adherentOrdre: { not: adherentOrdre }, lot: { policeId, statut: { in: ["EN_COURS", "TERMINE"] } }, donnees: { path: ["numero_certificat"], equals: numero } },
    select: { id: true },
    take: 1,
  });
  return lignes.length > 0;
}

/**
 * Certificat d'adhésion UNITAIRE d'un adhérent de la police mère : son propre numéro (dérivé de la police mère :
 * même racine, même lettre, numéro personnel sur 5 chiffres, unique ; D27), son propre QR code, et `police.police_mere`. Un certificat par adhérent ; une réédition
 * garde le même numéro (version + 1). Pas de prime (H36). La génération en masse reste en phase 5.
 */
export async function emettreCertificat(acteur: UtilisateurCourant, policeId: number, adherentOrdre: number, numeroSaisi: string, adresseIp: string | null): Promise<DocumentLu> {
  await exigerSurType(acteur, "CERTIFICAT", true);
  const police = await obtenirPrisma().police.findUnique({ where: { id: policeId }, include: { adherents: true } });
  if (!police) throw new ErreurMetier("Police introuvable.");
  if (!estContratDeGroupe(police.typeContrat)) throw new ErreurMetier("Un certificat d'adhésion n'existe que pour un contrat de groupe.");
  const adherent = (police.assures as unknown as Assure[]).find((a) => a.ordre === adherentOrdre);
  if (!adherent) throw new ErreurMetier(`L'adhérent n° ${adherentOrdre} ne fait pas partie de la liste courante de la police ${police.numero}.`);
  if (await obtenirPrisma().documentEmis.findFirst({ where: { policeId, type: "CERTIFICAT", adherentOrdre } })) {
    throw new ErreurMetier(`Le certificat de l'adhérent n° ${adherentOrdre} est déjà émis : utilisez « Rééditer ».`);
  }
  // Session 6.0 (D27) : racine et lettre de la police mère, puis le numéro personnel ; vide = numéro d'ordre proposé.
  const numero = normaliserNumeroPolice(numeroSaisi) || (numeroCertificatParDefaut(police.numero, adherentOrdre) ?? "");
  const problemes = problemesNumeroCertificat(numero, police.numero);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  if ((await obtenirPrisma().police.findUnique({ where: { numero }, select: { id: true } })) || (await obtenirPrisma().documentEmis.findFirst({ where: { numero }, select: { id: true } }))) {
    throw new ErreurMetier(`Le numéro « ${numero} » est déjà utilisé par une police ou un document.`);
  }
  if (await numeroReserveParImport(policeId, adherentOrdre, numero)) {
    throw new ErreurMetier(`Le numéro « ${numero} » est réservé à un autre adhérent par un import en cours : choisissez-en un autre.`);
  }

  const c = await chargerCotation(police.cotationId);
  const date = aujourdhui();
  const contexte = await contexteProduit(c.produitId, c.versionDateEffet);
  const modele = await modeleEnVigueur("CERTIFICAT", c.produitId, c.produit.code, date);
  const associes = await modelesAssocies(c.produitId, date, false);
  const commun = await sourceCommune(contexte, date);
  const citees = await citationsCotation(contexte, date);
  const adhesion = dateAdhesion(versionsAdherentsDe(police), adherentOrdre, depuisDate(police.dateEffet)) ?? depuisDate(police.dateEffet);
  const formule = contexte.formules.get(adherent.formule);
  // Les montants du certificat ne sont pas fournis (H36) : ces zéros ne sont jamais lus (donnees.ts).
  const zero = { nette: "0", accessoires: "0", taxe: "0", ttc: "0" };
  const source = (version: number, url: string): SourceDocument => ({
    type: "CERTIFICAT",
    numero,
    version,
    dateEmission: date,
    dateValidite: null,
    policeNumero: numero,
    produit: commun.produit,
    cg: citees.cg ? { libelle: citees.cg.libelle, visa: contexte.references.cgVisa ?? citees.cg.visa ?? "", date: citees.cg.date } : null,
    cs: citees.cs ? { libelle: citees.cs.libelle, visa: contexte.references.csVisa ?? citees.cs.visa ?? "" } : null,
    souscripteur: police.souscripteur as unknown as Souscripteur,
    assures: [adherent],
    ordresSansPrime: [],
    beneficiaires: null,
    contactsUrgence: null,
    intermediaires: versIntermediairesDocument(c.intermediaires),
    policeMere: police.numero,
    risque: police.risque as unknown as Risque,
    dateEffet: adhesion,
    dateEcheance: depuisDate(police.dateEcheance),
    joursCouverts: ecartEnJours(adhesion, depuisDate(police.dateEcheance)) + 1,
    formules: formule ? [{ code: adherent.formule, libelle: formule.libelle, tauxCouverture: formule.tauxCouverture, effectif: 1, primeUnitaire: "0", primeParAssure: "0", ...zero }] : [],
    totaux: zero,
    taxe: { tauxPourcent: "0", assiette: "NETTE" },
    echeances: [],
    forcee: false,
    motifForcage: null,
    societe: commun.societe,
    mentions: commun.document,
    urlVerification: url,
    typeContrat: police.typeContrat,
    auteurNom: c.auteurNom,
  });
  return produire(
    acteur,
    {
      type: "CERTIFICAT",
      numero,
      produitCode: c.produit.code,
      // Le numéro de la police mère : retrouver les certificats d'une police par son numéro (recherche des documents).
      policeNumero: police.numero,
      // La page publique de vérification n'affiche que l'adhérent, masqué.
      souscripteur: { type: "PHYSIQUE", nom: adherent.nom_prenoms, prenoms: "", raison_sociale: "", telephone: "", email: "", adresse: "" },
      cotationId: c.id,
      policeId: police.id,
      adherentOrdre,
      dateEmission: date,
      dateValidite: null,
      parametresDate: contexte.versionDateEffet,
      modele,
      associes,
      pieces: { cs: null, cg: null },
      donnees: (version, url) => donneesDocument(source(version, url)),
      filigrane: null,
      origine: null,
    },
    adresseIp,
  );
}

// ---------------------------------------------------------------- Réédition à l'identique (T10, T11)

/**
 * Réédite un document : MÊMES versions de modèles (principal, annexes, sous-modèles, CS, CG) et
 * MÊMES données que l'émission d'origine, même si une nouvelle version a été publiée depuis (T10).
 * Nouveau fichier (version + 1), nouveau jeton. Filigrane « EXPIRÉE » si la cotation a expiré (T11),
 * « ANNULÉ » si le document a été annulé par un avoir.
 */
export async function reediter(acteur: UtilisateurCourant, documentId: number, adresseIp: string | null): Promise<DocumentLu> {
  const prisma = obtenirPrisma();
  const d = await prisma.documentEmis.findUnique({ where: { id: documentId } });
  if (!d || !estTypeDocument(d.type)) throw new ErreurMetier("Document introuvable.");
  await exigerSurType(acteur, d.type, true);
  // Session 4b (H55) : une facture se réédite à chaque paiement (version + 1, restant dû à jour) ; un avoir et un reçu ne
  // changent pas. Leur PDF en attente se relance depuis la fiche de la facture, à l'identique.
  if (d.type === "FACTURE" || d.type === "AVOIR" || d.type === "RECU") {
    throw new ErreurMetier("Une facture, un avoir ou un reçu ne se réédite pas ici : la facture est rééditée à chaque paiement, et un PDF en attente se relance depuis la fiche de la facture.");
  }
  const origine = d.origineId ? await prisma.documentEmis.findUniqueOrThrow({ where: { id: d.origineId } }) : d;
  const ids = origine.versionsAssociees as unknown as VersionsAssociees & { cs: number | null; cg: number | null; listesEnAnnexe?: string[]; versionAdherents?: number | null };
  const modele = await prisma.modeleVersion.findUniqueOrThrow({ where: { id: origine.modeleVersionId }, select: { id: true, fichier: true, analyse: true } });
  const associes = { ...(await fichiersAssocies(ids)), ids: { annexes: ids.annexes, sousModeles: ids.sousModeles } };
  const piece = async (id: number | null) => {
    if (id === null) return null;
    const v = await prisma.modeleVersion.findUniqueOrThrow({ where: { id }, select: { id: true, pdf: true } });
    if (!v.pdf) throw new ErreurMetier("PDF des conditions générales ou spéciales absent.");
    return { versionId: v.id, pdf: v.pdf };
  };

  let filigrane: string | null = null;
  const annule = await prisma.documentEmis.findFirst({ where: { numero: d.numero, annuleParNumero: { not: null } } });
  if (annule) filigrane = "ANNULÉ";
  else if (d.type === "COTATION" && origine.cotationId) {
    const c = await prisma.cotation.findUniqueOrThrow({ where: { id: origine.cotationId } });
    const effectif = statutEffectif(c.statut as StatutCotation, c.dateValidite ? depuisDate(c.dateValidite) : null, aujourdhui());
    if (effectif === "EXPIREE") filigrane = "EXPIRÉE";
  }

  const donneesOrigine = origine.donnees as Record<string, unknown> & { doc: Record<string, unknown> };
  return produire(
    acteur,
    {
      type: d.type,
      numero: d.numero,
      produitCode: origine.produitCode,
      policeNumero: origine.policeNumero,
      // Certificat : la personne visée par le document est l'adhérent (page publique de vérification), pas le souscripteur de la police mère.
      souscripteur: (d.type === "CERTIFICAT"
        ? { type: "PHYSIQUE", nom: (donneesOrigine.assures as { nom_prenoms: string }[] | undefined)?.[0]?.nom_prenoms ?? origine.souscripteurNom, prenoms: "" }
        : (donneesOrigine.souscripteur ?? { type: "PHYSIQUE", nom: origine.souscripteurNom })) as Souscripteur,
      cotationId: origine.cotationId,
      policeId: origine.policeId,
      adherentOrdre: origine.adherentOrdre,
      listesEnAnnexe: ids.listesEnAnnexe ?? [],
      versionAdherents: ids.versionAdherents ?? null,
      dateEmission: depuisDate(origine.dateEmission),
      dateValidite: origine.dateValidite ? depuisDate(origine.dateValidite) : null,
      parametresDate: depuisDate(origine.parametresDate),
      modele: { versionId: modele.id, fichier: modele.fichier, champs: ((modele.analyse as { champs?: string[] }).champs ?? []) as string[] },
      associes,
      pieces: { cs: await piece(ids.cs), cg: await piece(ids.cg) },
      donnees: (version, url) => ({ ...donneesOrigine, doc: { ...donneesOrigine.doc, version: `v${version}`, url_verification: url } }),
      filigrane,
      origine: { id: origine.id },
    },
    adresseIp,
  );
}

// ---------------------------------------------------------------- Annulation par avoir (T12)

/** Marque toutes les versions d'un document comme annulées par un avoir (émis par la phase 4). */
export async function annulerParAvoir(acteur: UtilisateurCourant, numero: string, numeroAvoir: string, adresseIp: string | null): Promise<void> {
  await exigerSurType(acteur, "AVOIR", true);
  await obtenirPrisma().$transaction(async (tx) => {
    const fait = await tx.documentEmis.updateMany({ where: { numero, annuleParNumero: null }, data: { annuleParNumero: numeroAvoir, annuleLe: new Date() } });
    if (fait.count === 0) throw new ErreurMetier("Document introuvable ou déjà annulé.");
    await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_ANNULE", objetType: "document", objetId: numero, apres: { avoir: numeroAvoir, versions: fait.count }, adresseIp }, tx);
  });
}

// ---------------------------------------------------------------- Vérification publique (§14.1)

export type VuePublique = {
  type: string;
  numero: string;
  version: number;
  dateEmission: DateIso;
  statut: StatutPublic;
  produit: string;
  souscripteur: string;
  empreinte: string;
};

/** Page publique /verif/{jeton} : jamais d'autre donnée personnelle que le souscripteur masqué. */
export async function verifierJeton(jeton: string): Promise<VuePublique | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(jeton)) return null;
  const d = await obtenirPrisma().documentEmis.findUnique({ where: { jeton } });
  if (!d || !estTypeDocument(d.type)) return null;
  const annule = await obtenirPrisma().documentEmis.findFirst({ where: { numero: d.numero, annuleParNumero: { not: null } }, select: { annuleParNumero: true } });
  const produit = await obtenirPrisma().produit.findUnique({ where: { code: d.produitCode }, select: { libelle: true } });
  return {
    type: DOCUMENTS[d.type].libelle,
    numero: d.numero,
    version: d.version,
    dateEmission: depuisDate(d.dateEmission),
    statut: statutPublic({ type: d.type, annuleParNumero: annule?.annuleParNumero ?? null, dateValidite: d.dateValidite ? depuisDate(d.dateValidite) : null }, aujourdhui()),
    produit: produit?.libelle ?? d.produitCode,
    souscripteur: d.souscripteurMasque,
    empreinte: d.empreinte,
  };
}

// ---------------------------------------------------------------- Recherche et téléchargement

export type Filtres = { policeNumero?: string; client?: string; type?: string; du?: DateIso; au?: DateIso; numero?: string };

export async function rechercherDocuments(acteur: UtilisateurCourant, f: Filtres): Promise<DocumentLu[]> {
  const lisibles = await typesLisibles(acteur);
  if (lisibles.length === 0) throw new ErreurAcces("Droit insuffisant : documents émis.");
  const types = f.type ? lisibles.filter((t) => t === f.type) : lisibles;
  const lignes = await obtenirPrisma().documentEmis.findMany({
    where: {
      type: { in: types },
      ...(f.policeNumero ? { policeNumero: { contains: f.policeNumero.trim(), mode: "insensitive" } } : {}),
      ...(f.numero ? { numero: { contains: f.numero.trim(), mode: "insensitive" } } : {}),
      ...(f.client ? { souscripteurNom: { contains: f.client.trim(), mode: "insensitive" } } : {}),
      ...(f.du || f.au ? { dateEmission: { ...(f.du ? { gte: versDate(f.du) } : {}), ...(f.au ? { lte: versDate(f.au) } : {}) } } : {}),
    },
    orderBy: [{ emisLe: "desc" }],
    take: 200,
  });
  return lignes.map(versLu);
}

export async function documentsDe(acteur: UtilisateurCourant, critere: { cotationId: number }): Promise<DocumentLu[]> {
  const lisibles = await typesLisibles(acteur);
  const lignes = await obtenirPrisma().documentEmis.findMany({ where: { cotationId: critere.cotationId, type: { in: lisibles } }, orderBy: [{ type: "asc" }, { version: "desc" }] });
  return lignes.map(versLu);
}

/** Lit un document émis et vérifie son intégrité (empreinte, CDC §14.3) ; en attente d'écriture (T14) : depuis la base. */
const lireVerifie = (d: LigneDocument): Promise<Uint8Array> => lireDocumentEmis(d);

const nomFichier = (d: { numero: string; version: number; type: string }) => `${d.numero.replace(/[^A-Za-z0-9_-]/g, "_")}_${d.type}_v${d.version}.pdf`;

export async function telechargerDocument(acteur: UtilisateurCourant, id: number, adresseIp: string | null): Promise<{ nom: string; contenu: Uint8Array }> {
  const d = await obtenirPrisma().documentEmis.findUnique({ where: { id } });
  if (!d || !estTypeDocument(d.type)) throw new ErreurMetier("Document introuvable.");
  await exigerSurType(acteur, d.type, false);
  const contenu = await lireVerifie(d);
  await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_TELECHARGE", objetType: "document", objetId: d.id, apres: { numero: d.numero, version: d.version }, adresseIp });
  return { nom: nomFichier(d), contenu };
}

export async function zipDocuments(acteur: UtilisateurCourant, ids: number[], adresseIp: string | null): Promise<{ nom: string; contenu: Uint8Array }> {
  const uniques = [...new Set(ids)].filter(Number.isInteger);
  if (uniques.length === 0 || uniques.length > 100) throw new ErreurMetier("Sélectionnez de 1 à 100 documents.");
  const lignes = await obtenirPrisma().documentEmis.findMany({ where: { id: { in: uniques } } });
  if (lignes.length !== uniques.length) throw new ErreurMetier("Document introuvable.");
  for (const d of lignes) {
    if (!estTypeDocument(d.type)) throw new ErreurMetier("Document introuvable.");
    await exigerSurType(acteur, d.type, false);
  }
  const differes = await ecrituresDifferees(lignes.map((d) => d.id));
  if (differes.size > 0) {
    const noms = lignes.filter((d) => differes.has(d.id)).map((d) => `${d.numero} v${d.version}`);
    throw new ErreurMetier(`Fichier en attente d'écriture dans le stockage : ${noms.join(", ")}. Téléchargez ce document seul, ou réessayez l'archive après la reprise automatique.`);
  }
  // L'export ZIP reprend la même arborescence que le stockage (Étape 5, D41)
  const contenu = await stockage().zip(lignes.map((d) => ({ chemin: d.chemin, nom: d.chemin })));
  await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_TELECHARGE", objetType: "documents", objetId: lignes.map((d) => d.id).join(","), apres: { zip: lignes.map((d) => `${d.numero} v${d.version}`) }, adresseIp });
  return { nom: `documents_${aujourdhui()}.zip`, contenu };
}
