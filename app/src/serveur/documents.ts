import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

import { calculer, type EntreeCalcul } from "@/domaine/calcul/calcul";
import type { DateIso } from "@/domaine/calcul/dates";
import type { Assure, Risque, Souscripteur } from "@/domaine/cotation/saisie";
import { statutEffectif, type StatutCotation } from "@/domaine/cotation/statuts";
import { donneesDocument, type FormuleSource, type SourceDocument } from "@/domaine/documents/donnees";
import {
  DOCUMENTS,
  cheminStockage,
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
import { obtenirConfig } from "./config";
import { niveauDuProfil } from "./droits";
import { generateur, type ImagePng } from "./generateur";
import { fichiersAssocies, lireSeuilListe, modelesAssocies, versionPublieeEnVigueur, type VersionsAssociees } from "./modeles";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { lireImageSociete, lireParametresSociete } from "./societe";
import { stockage } from "./stockage";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

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
const nouveauJeton = () => randomBytes(32).toString("base64url");

// ---------------------------------------------------------------- Droits (CDC §4)

/** Action dont le niveau ouvre la lecture et l'émission de chaque type de document (hypothèse H21). */
const ACTION_DU_TYPE: Record<TypeDocument, CodeAction> = {
  COTATION: "CREER_COTATION",
  CP: "EMETTRE_CONTRAT",
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

type ContexteProduit = {
  produit: { id: number; code: string; libelle: string; gamme: string; branche: string };
  versionDateEffet: DateIso;
  formules: Map<string, { libelle: string; tauxCouverture: string | null }>;
  references: { cgModeleCode: string | null; cgVisa: string | null; csModeleCode: string | null; csVisa: string | null };
};

async function contexteProduit(produitId: number, versionDateEffet: Date): Promise<ContexteProduit> {
  const version = await obtenirPrisma().produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId, dateEffet: versionDateEffet } },
    include: { formules: true, produit: true },
  });
  return {
    produit: { id: version.produit.id, code: version.produit.code, libelle: version.produit.libelle, gamme: version.produit.gamme, branche: version.produit.branche },
    versionDateEffet: depuisDate(versionDateEffet),
    formules: new Map(version.formules.map((f) => [f.code, { libelle: f.libelle, tauxCouverture: f.tauxCouverture ? f.tauxCouverture.toFixed() : null }])),
    references: { cgModeleCode: version.cgModeleCode, cgVisa: version.cgVisa, csModeleCode: version.csModeleCode, csVisa: version.csVisa },
  };
}

/** Montants du moteur (recalculés à l'identique depuis l'entrée figée), formule par formule. */
function montantsDu(entree: EntreeCalcul, contexte: ContexteProduit) {
  const resultat = calculer(entree);
  const t = (m: { toFixed(): string }) => m.toFixed();
  const formules: FormuleSource[] = resultat.lignes.map((l, i) => ({
    code: l.code,
    libelle: contexte.formules.get(l.code)?.libelle ?? l.code,
    tauxCouverture: contexte.formules.get(l.code)?.tauxCouverture ?? null,
    effectif: l.effectif,
    primeUnitaire: String(entree.lignes[i].primeUnitaire),
    nette: t(l.arrondi.nette),
    accessoires: t(l.arrondi.accessoires),
    taxe: t(l.arrondi.taxe),
    ttc: t(l.arrondi.ttc),
  }));
  const a = resultat.totaux.arrondi;
  return {
    resultat,
    formules,
    totaux: { nette: t(a.nette), accessoires: t(a.accessoires), taxe: t(a.taxe), ttc: t(a.ttc) },
    taxe: { tauxPourcent: String(entree.parametres.taxe.tauxPourcent), assiette: entree.parametres.taxe.assiette },
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

function urlPublique(): string {
  const url = obtenirConfig().URL_PUBLIQUE;
  if (!url) {
    throw new ErreurMetier("Adresse publique de l'application non configurée (variable URL_PUBLIQUE) : les QR codes de vérification ne peuvent pas être produits. Prévenez l'administrateur.");
  }
  return url.replace(/\/+$/, "");
}

async function images(champs: string[]): Promise<Record<string, ImagePng>> {
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
  });

  const empreinte = sha256(pdf);
  const chemin = cheminStockage({ produitCode: p.produitCode, type: p.type, numero: p.numero, dateEmission: aujourdhui(), version });
  const ecrit = await stockage().ecrire(chemin, pdf);
  if (ecrit.empreinte !== empreinte) throw new Error(`Stockage : empreinte différente pour ${chemin}`);

  const versionsAssociees = { ...p.associes.ids, cs: p.pieces.cs?.versionId ?? null, cg: p.pieces.cg?.versionId ?? null };
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
    return ligne;
  });
  return versLu(cree);
}

type LigneDocument = Prisma.DocumentEmisGetPayload<object>;

function versLu(d: LigneDocument): DocumentLu {
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

async function modeleEnVigueur(type: "COTATION" | "CP", produitId: number, produitCode: string, date: DateIso) {
  const retenu = await versionPublieeEnVigueur({ type, produitId }, date);
  if (!retenu) {
    throw new ErreurMetier(`Aucun modèle de ${type === "COTATION" ? "cotation" : "conditions particulières"} publié et en vigueur pour le produit ${produitCode} : déposez-le et faites-le publier (Modèles Word).`);
  }
  const v = await obtenirPrisma().modeleVersion.findUniqueOrThrow({ where: { id: retenu.version.id }, select: { id: true, fichier: true, analyse: true } });
  return { versionId: v.id, fichier: v.fichier, champs: ((v.analyse as { champs?: string[] }).champs ?? []) as string[] };
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
  return { produit: { code: contexte.produit.code, libelle: contexte.produit.libelle, gamme: contexte.produit.gamme, branche: contexte.produit.branche }, ...(await lireParametresSociete(date)) };
}

// ---------------------------------------------------------------- Cotation (CDC §9)

async function chargerCotation(id: number) {
  const c = await obtenirPrisma().cotation.findUnique({ where: { id }, include: { produit: true } });
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
  const m = montantsDu(c.donneesCalcul as unknown as EntreeCalcul, contexte);
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
    risque: c.risque as unknown as Risque,
    dateEffet: depuisDate(c.dateEffet),
    dateEcheance: depuisDate(c.dateEcheance),
    joursCouverts: m.resultat.joursCouverts,
    formules: m.formules,
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
  const modele = await modeleEnVigueur("COTATION", c.produitId, c.produit.code, date);
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
  const modele = await modeleEnVigueur("COTATION", c.produitId, c.produit.code, date);
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

/** Émission des CP d'une police (cotation acceptée) : CP → annexes → CS → CG, visas vérifiés (§6.8). */
export async function emettreCp(acteur: UtilisateurCourant, cotationId: number, adresseIp: string | null): Promise<DocumentLu> {
  await exigerSurType(acteur, "CP", true);
  const c = await chargerCotation(cotationId);
  const police = await obtenirPrisma().police.findUnique({ where: { cotationId } });
  if (!police) throw new ErreurMetier("Pas de police : les conditions particulières s'émettent après l'acceptation de la cotation.");
  if (await obtenirPrisma().documentEmis.findFirst({ where: { policeId: police.id, type: "CP" } })) {
    throw new ErreurMetier("Les conditions particulières de cette police sont déjà émises : utilisez « Rééditer ».");
  }
  const date = aujourdhui();
  const contexte = await contexteProduit(c.produitId, c.versionDateEffet);
  const modele = await modeleEnVigueur("CP", c.produitId, c.produit.code, date);
  const associes = await modelesAssocies(c.produitId, date, false);
  const commun = await sourceCommune(contexte, date);
  const pieces = await piecesContractuelles(contexte, date, true);
  const m = montantsDu(police.donneesCalcul as unknown as EntreeCalcul, contexte);
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
    risque: police.risque as unknown as Risque,
    dateEffet: depuisDate(police.dateEffet),
    dateEcheance: depuisDate(police.dateEcheance),
    joursCouverts: m.resultat.joursCouverts,
    formules: m.formules,
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
  return produire(
    acteur,
    {
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
  const origine = d.origineId ? await prisma.documentEmis.findUniqueOrThrow({ where: { id: d.origineId } }) : d;
  const ids = origine.versionsAssociees as unknown as VersionsAssociees & { cs: number | null; cg: number | null };
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
      souscripteur: (donneesOrigine.souscripteur ?? { type: "PHYSIQUE", nom: origine.souscripteurNom }) as Souscripteur,
      cotationId: origine.cotationId,
      policeId: origine.policeId,
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

/** Lit un document stocké et vérifie son intégrité (empreinte, CDC §14.3). */
async function lireVerifie(d: LigneDocument): Promise<Uint8Array> {
  const contenu = await stockage().lire(d.chemin);
  if (sha256(contenu) !== d.empreinte) {
    console.error(`[documents] empreinte différente pour ${d.chemin}`);
    throw new ErreurMetier(`Le fichier stocké du document ${d.numero} (v${d.version}) ne correspond plus à son empreinte : prévenez l'administrateur.`);
  }
  return contenu;
}

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
  const contenu = await stockage().zip(lignes.map((d) => ({ chemin: d.chemin, nom: nomFichier(d) })));
  await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_TELECHARGE", objetType: "documents", objetId: lignes.map((d) => d.id).join(","), apres: { zip: lignes.map((d) => `${d.numero} v${d.version}`) }, adresseIp });
  return { nom: `documents_${aujourdhui()}.zip`, contenu };
}
