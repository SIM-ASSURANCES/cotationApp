import { dateValide, type DateIso } from "../calcul/dates";

/**
 * Bibliothèque de modèles Word (CDC §6.1, §6.6) : types, saisie, cycle de vie. Règles pures.
 *
 * Cycle d'une version : Brouillon (dépôt réussi, aperçu possible) → Soumis (par son auteur) →
 * Publié (par un AUTRE profil, qui a le droit « Publier un modèle » : la Technique dépose, la
 * Direction Générale publie, CDC §4). Un Soumis peut être renvoyé en brouillon. Une version
 * publiée n'est jamais modifiée ni supprimée (déclencheur PostgreSQL) : la régénération d'un
 * document émis retrouve exactement le modèle de l'époque (T10).
 *
 * « Archivé » (§6.6) n'est pas stocké : une version publiée est « remplacée » dès qu'une version
 * publiée plus récente est entrée en vigueur. Le calcul suit la date, sans tâche planifiée.
 */

export const TYPES_MODELE = ["CP", "CERTIFICAT", "COTATION", "FACTURE", "AVOIR", "RECU", "AVIS_ECHEANCE", "RELANCE", "ANNEXE", "SOUS_MODELE", "CG", "CS"] as const;
export type TypeModele = (typeof TYPES_MODELE)[number];

export const LISTES_ANNEXE = ["assures", "beneficiaires", "formules", "echeances"] as const;
export type ListeAnnexe = (typeof LISTES_ANNEXE)[number];

type RegleType = {
  libelle: string;
  /** Document produit par fusion : il doit contenir au moins une balise. */
  genere: boolean;
  /** Document fixe (CG, CS) : converti UNE fois en PDF à la publication, avec son visa. */
  fixe: boolean;
  produit: "obligatoire" | "facultatif" | "aucun";
  /**
   * Champs que tout modèle de ce type doit contenir (CDC §6.7), sinon le dépôt est refusé. Une liste
   * imbriquée se lit « l'un de » : le souscripteur est une personne physique (nom) ou morale
   * (raison sociale).
   */
  obligatoires: readonly (string | readonly string[])[];
  /** Filtres que le modèle doit employer (facture : le TTC en lettres, filtre « lettres »). */
  filtres?: readonly string[];
  /** Mentions de texte fixe que le modèle doit contenir (facture : rappel de l'article 13 du code CIMA). */
  textes?: readonly { motif: RegExp; libelle: string }[];
};

const SOUSCRIPTEUR = ["souscripteur.nom", "souscripteur.raison_sociale"] as const;
/** Socle commun des CP, cotations et reçus (décision du 06/10/2026, correction de H15). */
const SOCLE = (numero: string) => [numero, SOUSCRIPTEUR, "police.date_effet", "police.date_echeance", "prime.ttc"] as const;

/**
 * Contenu obligatoire des conditions particulières (CDC §10.1, session 4a) : le socle, plus la durée en toutes
 * lettres, le bloc des primes COMPLET, la clause citant les CG et leur visa, la clause de réclamation, le lieu,
 * la date d'émission et la signature scannée de SIM. Assurés, bénéficiaires, contacts d'urgence, intermédiaires et
 * garanties (bloc()) dépendent du produit : ils ne sont pas exigés de tout modèle (H35).
 */
const CONTENU_CP = [
  ...SOCLE("police.numero"),
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
] as const;

/**
 * Contenu obligatoire de la facture (CDC §11.2, session 4b, H57) : en-tête (numéro, date, police, dates d'effet et de fin,
 * RCCM, NCC), « Facturé à » avec l'adresse, taux de taxe, taxe et TTC (en lettres : filtre « lettres »), RIB, Mobile Money,
 * signature, QR code et rappel de l'art. 13 CIMA. « Envoyé à », les blocs d'échéancier et de paiements sont conditionnels :
 * ils ne sont pas exigés.
 */
const CONTENU_FACTURE = [
  "doc.numero",
  "doc.date_emission",
  "police.numero",
  "police.date_effet",
  "police.date_echeance",
  SOUSCRIPTEUR,
  "souscripteur.adresse",
  "prime.taux_taxe",
  "prime.taxe",
  "prime.ttc",
  "societe.rccm",
  "societe.ncc",
  ["societe.rib", "societe.rib[].numero"],
  ["societe.mobile_money", "societe.mobile_money[].numero_marchand"],
  "signature_sim",
  "qr_code",
] as const;
const RAPPEL_CIMA = [{ motif: /CIMA/i, libelle: "le rappel de l'article 13 du code CIMA (la prise d'effet est subordonnée au paiement de la prime)" }] as const;

export const REGLES: Record<TypeModele, RegleType> = {
  CP: { libelle: "Conditions particulières", genere: true, fixe: false, produit: "obligatoire", obligatoires: CONTENU_CP },
  // Certificat d'adhésion unitaire (CDC §10.2) : son numéro, la police mère, l'adhérent, la date d'effet de l'adhésion. Pas de prime (H36).
  CERTIFICAT: {
    libelle: "Certificat d'adhésion",
    genere: true,
    fixe: false,
    produit: "obligatoire",
    obligatoires: ["police.numero", "police.police_mere", SOUSCRIPTEUR, "police.date_effet", "doc.date_emission"],
  },
  // Une cotation n'a pas encore de numéro de police : son numéro est celui du document (COT-…), H18.
  COTATION: { libelle: "Cotation", genere: true, fixe: false, produit: "obligatoire", obligatoires: SOCLE("doc.numero") },
  FACTURE: { libelle: "Facture", genere: true, fixe: false, produit: "facultatif", obligatoires: CONTENU_FACTURE, filtres: ["lettres"], textes: RAPPEL_CIMA },
  // Avoir (CDC §11.3) : son numéro, la facture qu'il annule, la police, le souscripteur et les montants (négatifs).
  AVOIR: { libelle: "Avoir", genere: true, fixe: false, produit: "facultatif", obligatoires: ["doc.numero", "doc.date_emission", "doc.facture_origine", "police.numero", SOUSCRIPTEUR, "prime.ttc", "qr_code"] },
  // Reçu : montant payé et facture réglée (H18).
  RECU: { libelle: "Reçu", genere: true, fixe: false, produit: "facultatif", obligatoires: [...SOCLE("police.numero"), "paiements[].montant", "doc.facture_origine"] },
  AVIS_ECHEANCE: { libelle: "Avis d'échéance", genere: true, fixe: false, produit: "facultatif", obligatoires: [] },
  RELANCE: { libelle: "Relance", genere: true, fixe: false, produit: "facultatif", obligatoires: [] },
  ANNEXE: { libelle: "Annexe (liste longue)", genere: true, fixe: false, produit: "facultatif", obligatoires: [] },
  SOUS_MODELE: { libelle: "Sous-modèle (bloc)", genere: false, fixe: false, produit: "facultatif", obligatoires: [] },
  CG: { libelle: "Conditions générales", genere: false, fixe: true, produit: "aucun", obligatoires: [] },
  CS: { libelle: "Conventions spéciales", genere: false, fixe: true, produit: "aucun", obligatoires: [] },
};

/** Seules balises permises dans des CG ou des CS : leur visa (CDC §6.1). */
export const BALISES_FIXES: Record<"CG" | "CS", readonly string[]> = {
  CG: ["produit.cg_libelle", "produit.cg_visa", "produit.cg_date"],
  CS: ["produit.cs_libelle", "produit.cs_visa"],
};

export const estTypeModele = (valeur: string): valeur is TypeModele => (TYPES_MODELE as readonly string[]).includes(valeur);

// ------------------------------------------------------------------ Saisie

export type SaisieModele = {
  type: TypeModele;
  code: string;
  libelle: string;
  produitCode: string | null;
  /** RELANCE : 1, 2, 3… (un modèle par niveau). */
  niveauRelance: number | null;
  /** ANNEXE : la liste qu'elle reprend en entier. */
  listeAnnexe: ListeAnnexe | null;
  /** SOUS_MODELE : bloc("nom", clé). */
  blocNom: string | null;
  blocCle: string | null;
};

export function problemesSaisieModele(s: SaisieModele): string[] {
  const p: string[] = [];
  const regle = REGLES[s.type];
  if (!regle) return ["Type de modèle inconnu."];
  if (!/^[A-Z0-9_-]{2,60}$/.test(s.code)) p.push("Code du modèle : 2 à 60 caractères parmi A-Z, 0-9, _ et -.");
  if (s.libelle.trim().length < 3 || s.libelle.length > 200) p.push("Libellé du modèle : 3 à 200 caractères.");
  if (regle.produit === "obligatoire" && !s.produitCode) p.push(`Un modèle de ${regle.libelle.toLowerCase()} est propre à un produit : choisissez-le.`);
  if (regle.produit === "aucun" && s.produitCode) p.push(`${regle.libelle} : pas de produit (les produits y renvoient par leur visa).`);
  if (s.type === "RELANCE" ? !(Number.isInteger(s.niveauRelance) && (s.niveauRelance ?? 0) >= 1 && (s.niveauRelance ?? 0) <= 9) : s.niveauRelance !== null) {
    p.push(s.type === "RELANCE" ? "Relance : niveau de 1 à 9." : "Le niveau ne concerne que les relances.");
  }
  if (s.type === "ANNEXE" ? !s.listeAnnexe || !(LISTES_ANNEXE as readonly string[]).includes(s.listeAnnexe) : s.listeAnnexe !== null) {
    p.push(s.type === "ANNEXE" ? `Annexe : liste parmi ${LISTES_ANNEXE.join(", ")}.` : "La liste ne concerne que les annexes.");
  }
  if (s.type === "SOUS_MODELE") {
    if (!s.blocNom || !/^[a-z][a-z0-9_]{1,40}$/.test(s.blocNom)) p.push('Sous-modèle : nom du bloc en minuscules (ex. « garanties »), tel qu\'écrit dans bloc("garanties", …).');
    if (!s.blocCle || !/^[A-Za-z0-9_.-]{1,60}$/.test(s.blocCle)) p.push("Sous-modèle : clé obligatoire (ex. le code de la formule : SOLO, 80…).");
  } else if (s.blocNom !== null || s.blocCle !== null) {
    p.push("Le nom et la clé de bloc ne concernent que les sous-modèles.");
  }
  return p;
}

export type SaisieVersion = {
  nomFichier: string;
  taille: number;
  commentaire: string;
  dateEffet: DateIso;
  /** CG et CS : visa, et date des CG. */
  visa: string | null;
  dateDocument: DateIso | null;
};

export const TAILLE_MAX_MODELE = 15 * 1024 * 1024;

export function problemesSaisieVersion(type: TypeModele, s: SaisieVersion): string[] {
  const p: string[] = [];
  if (!/\.docx$/i.test(s.nomFichier)) p.push("Le fichier doit être un document Word .docx (pas .doc, ni .docm).");
  if (s.taille <= 0) p.push("Le fichier est vide.");
  if (s.taille > TAILLE_MAX_MODELE) p.push("Le fichier dépasse 15 Mo.");
  if (s.commentaire.trim().length < 3 || s.commentaire.length > 1000) p.push("Commentaire de modification obligatoire (3 à 1 000 caractères).");
  if (!dateValide(s.dateEffet)) p.push("Date d'effet invalide (AAAA-MM-JJ).");
  if (REGLES[type].fixe) {
    if (!s.visa || s.visa.trim().length < 3 || s.visa.length > 120) p.push(`${REGLES[type].libelle} : visa obligatoire (ex. MFB/DGTCP/DA/N° 01498).`);
    if (type === "CG" && (!s.dateDocument || !dateValide(s.dateDocument))) p.push("Conditions générales : date du document obligatoire (AAAA-MM-JJ).");
    if (type === "CS" && s.dateDocument !== null && !dateValide(s.dateDocument)) p.push("Date du document invalide.");
  } else if (s.visa !== null || s.dateDocument !== null) {
    p.push("Le visa ne concerne que les conditions générales et spéciales.");
  }
  return p;
}

/** Données des seules balises permises dans des CG ou CS, rendues une fois à la publication. */
export function donneesFixes(type: "CG" | "CS", libelle: string, visa: string, dateDocument: DateIso | null): Record<string, unknown> {
  return type === "CG"
    ? { produit: { cg_libelle: libelle, cg_visa: visa, cg_date: dateDocument } }
    : { produit: { cs_libelle: libelle, cs_visa: visa } };
}

// ------------------------------------------------------------------ Cycle de vie

export const STATUTS_VERSION = ["BROUILLON", "SOUMIS", "PUBLIE"] as const;
export type StatutVersion = (typeof STATUTS_VERSION)[number];
export type StatutAffiche = "BROUILLON" | "SOUMIS" | "EN_VIGUEUR" | "PROGRAMMEE" | "REMPLACEE";

export const LIBELLE_STATUT_VERSION: Record<StatutAffiche, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis (à publier)",
  EN_VIGUEUR: "Publié, en vigueur",
  PROGRAMMEE: "Publié, en vigueur à sa date d'effet",
  REMPLACEE: "Archivé (remplacé)",
};

export type VersionCycle = { id: number; numero: number; statut: StatutVersion; dateEffet: DateIso; auteurId: number };

/** Version publiée en vigueur à une date : date d'effet la plus récente qui n'est pas après `date`. */
export function versionEnVigueur<V extends VersionCycle>(versions: readonly V[], date: DateIso): V | null {
  let retenue: V | null = null;
  for (const v of versions) {
    if (v.statut !== "PUBLIE" || v.dateEffet > date) continue;
    if (!retenue || v.dateEffet > retenue.dateEffet || (v.dateEffet === retenue.dateEffet && v.numero > retenue.numero)) retenue = v;
  }
  return retenue;
}

export function statutAffiche(v: VersionCycle, versions: readonly VersionCycle[], aujourdhui: DateIso): StatutAffiche {
  if (v.statut !== "PUBLIE") return v.statut;
  if (v.dateEffet > aujourdhui) return "PROGRAMMEE";
  return versionEnVigueur(versions, aujourdhui)?.id === v.id ? "EN_VIGUEUR" : "REMPLACEE";
}

/** Seul l'auteur soumet sa version. */
export const peutSoumettre = (v: VersionCycle, acteurId: number): boolean => v.statut === "BROUILLON" && v.auteurId === acteurId;

/** Le valideur n'est jamais l'auteur (CDC §4.1, §6.6). */
export const peutPublier = (v: VersionCycle, acteurId: number): boolean => v.statut === "SOUMIS" && v.auteurId !== acteurId;
export const peutRenvoyer = (v: VersionCycle, acteurId: number): boolean => v.statut === "SOUMIS" && v.auteurId !== acteurId;

/** Une publication n'est jamais rétroactive, et deux versions publiées ne partagent pas une date. */
export function problemesPublication(v: VersionCycle, dateEffet: DateIso, aujourdhui: DateIso, versions: readonly VersionCycle[]): string[] {
  const p: string[] = [];
  if (!dateValide(dateEffet)) return ["Date d'effet invalide (AAAA-MM-JJ)."];
  if (dateEffet < aujourdhui) p.push("La date d'effet ne peut pas être passée : une publication n'est jamais rétroactive.");
  if (versions.some((autre) => autre.id !== v.id && autre.statut === "PUBLIE" && autre.dateEffet === dateEffet)) {
    p.push("Une version de ce modèle est déjà publiée avec cette date d'effet.");
  }
  return p;
}

// ------------------------------------------------------------------ Listes longues

/** Seuil au-delà duquel une liste passe en annexe (CDC §6.5), paramétrable. */
export const CLE_SEUIL_LISTE = "documents.seuil_liste_annexe";
export const SEUIL_LISTE_DEFAUT = 10;

export function problemesSeuil(valeur: number): string[] {
  return Number.isInteger(valeur) && valeur >= 1 && valeur <= 500 ? [] : ["Seuil des listes longues : nombre entier de 1 à 500."];
}
