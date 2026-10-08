import { dateValide, type DateIso } from "../calcul/dates";
import { analyserMontant, ErreurCalcul, montant } from "../calcul/montant";

/**
 * Données saisies à la cotation. Les noms suivent EXACTEMENT le dictionnaire du CDC §6.3
 * (souscripteur.*, assures[].*, risque.*) : les modèles Word n'utiliseront que ces noms.
 */

export type Souscripteur = {
  type: "PHYSIQUE" | "MORALE";
  nom: string;
  prenoms: string;
  raison_sociale: string;
  telephone: string;
  email: string;
  adresse: string;
} & SouscripteurComplements;

/**
 * Champs du souscripteur du dictionnaire (CDC §6.3.2) saisis depuis la session 4a (D19, D22). Tous
 * facultatifs À LA SAISIE : un champ saisi mais laissé vide s'écrit vide dans le document. Ils sont
 * ABSENTS (undefined) d'une cotation ou d'un client enregistrés avant la 4a : « jamais fournis », ce
 * qui bloque la génération d'un modèle qui les utilise (option b de H19).
 */
export type SouscripteurComplements = {
  num_identification?: string;
  date_naissance?: DateIso | "";
  lieu_naissance?: string;
  profession?: string;
  activite?: string;
  employeur?: string;
  bp?: string;
  localite?: string;
  sous_prefecture?: string;
  whatsapp?: string;
  mobile_money?: string;
  situation_matrimoniale?: string;
  /** Entier ; null si non renseigné. */
  nb_enfants?: number | null;
  groupe_sanguin?: string;
};

/** Champs texte des compléments, dans l'ordre du dictionnaire (formulaires, copie client → cotation). */
export const CHAMPS_TEXTE_COMPLEMENTS = [
  "num_identification",
  "lieu_naissance",
  "profession",
  "activite",
  "employeur",
  "bp",
  "localite",
  "sous_prefecture",
  "whatsapp",
  "mobile_money",
  "situation_matrimoniale",
  "groupe_sanguin",
] as const;

export const GROUPES_SANGUINS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const NOMBRE_MAX_ENFANTS = 30;

/** Compléments tous vides, pour un souscripteur saisi par un formulaire qui les propose. */
export const complementsVides = (): Required<SouscripteurComplements> => ({
  num_identification: "",
  date_naissance: "",
  lieu_naissance: "",
  profession: "",
  activite: "",
  employeur: "",
  bp: "",
  localite: "",
  sous_prefecture: "",
  whatsapp: "",
  mobile_money: "",
  situation_matrimoniale: "",
  nb_enfants: null,
  groupe_sanguin: "",
});

/** Bénéficiaire (SECURVIE, RELAXACCIDENT) : noms du dictionnaire §6.3.2. `quote_part` : pourcentage, en texte. */
export type Beneficiaire = {
  ordre: number;
  nom_prenoms: string;
  lien: string;
  contact: string;
  quote_part: string;
};

/** Contact d'urgence (RELAXVOYAGE). */
export type ContactUrgence = {
  nom_prenoms: string;
  contact: string;
};

export const NOMBRE_MAX_BENEFICIAIRES = 50;
export const NOMBRE_MAX_CONTACTS_URGENCE = 10;

/** Assuré. `sexe` : ajouté au dictionnaire (décision du 05/10/2026), « M », « F » ou vide si inconnu. */
export type Assure = {
  ordre: number;
  nom_prenoms: string;
  date_naissance: DateIso | "";
  sexe: "M" | "F" | "";
  lien: string;
  /** Code de la formule de l'assuré, ou vide. */
  formule: string;
};

/** Champs propres au produit (risque.*) : nom en minuscules et valeur en texte. */
export type Risque = Record<string, string>;

export const SEXES = ["M", "F"] as const;
export const NOMBRE_MAX_ASSURES = 5000;
const NOMBRE_MAX_CHAMPS_RISQUE = 60;

const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function problemesSouscripteur(s: Souscripteur, aujourdhui?: DateIso): string[] {
  const p: string[] = [];
  if (s.type !== "PHYSIQUE" && s.type !== "MORALE") p.push("Le type de souscripteur doit être PHYSIQUE ou MORALE.");
  if (s.type === "PHYSIQUE" && s.nom.trim() === "") p.push("Le nom du souscripteur est obligatoire.");
  if (s.type === "MORALE" && s.raison_sociale.trim() === "") p.push("La raison sociale du souscripteur est obligatoire.");
  if (s.email.trim() !== "" && !COURRIEL.test(s.email.trim())) p.push("L'adresse e-mail du souscripteur est invalide.");
  for (const [nom, valeur] of Object.entries(s)) {
    if (typeof valeur === "string" && valeur.length > 300) p.push(`Le champ « ${nom} » du souscripteur est trop long.`);
  }
  const naissance = s.date_naissance ?? "";
  if (naissance !== "" && (!dateValide(naissance) || naissance < "1900-01-01" || (aujourdhui !== undefined && naissance > aujourdhui))) {
    p.push("La date de naissance du souscripteur est invalide.");
  }
  const enfants = s.nb_enfants ?? null;
  if (enfants !== null && (!Number.isInteger(enfants) || enfants < 0 || enfants > NOMBRE_MAX_ENFANTS)) {
    p.push(`Le nombre d'enfants du souscripteur doit être un entier de 0 à ${NOMBRE_MAX_ENFANTS}.`);
  }
  const sang = s.groupe_sanguin ?? "";
  if (sang !== "" && !(GROUPES_SANGUINS as readonly string[]).includes(sang)) {
    p.push(`Le groupe sanguin du souscripteur doit être l'un de : ${GROUPES_SANGUINS.join(", ")}.`);
  }
  return p;
}

/** Quote-part en nombre exact, ou null si elle est illisible (message de l'analyseur unique des montants). */
function lireQuotePart(texte: string): { valeur: ReturnType<typeof montant> } | { erreur: string } {
  try {
    return { valeur: montant(analyserMontant(texte)) };
  } catch (erreur) {
    if (erreur instanceof ErreurCalcul) return { erreur: erreur.message };
    throw erreur;
  }
}

/**
 * Bénéficiaires (D19, 4a) : nom obligatoire ; dès qu'il y en a, chaque quote-part est obligatoire,
 * strictement positive et au plus 100 %, et la somme fait EXACTEMENT 100 % (calcul décimal exact).
 * Une liste vide est permise : un champ saisi mais laissé vide s'écrit vide.
 */
export function problemesBeneficiaires(liste: Beneficiaire[]): string[] {
  const p: string[] = [];
  if (liste.length > NOMBRE_MAX_BENEFICIAIRES) p.push(`Au plus ${NOMBRE_MAX_BENEFICIAIRES} bénéficiaires.`);
  let somme = montant("0");
  let sommable = true;
  liste.forEach((b, i) => {
    const ligne = `Bénéficiaire n° ${i + 1}`;
    if (b.nom_prenoms.trim() === "") p.push(`${ligne} : nom et prénoms obligatoires.`);
    for (const [nom, valeur] of [["lien", b.lien], ["contact", b.contact], ["nom", b.nom_prenoms]] as const) {
      if (valeur.length > 300) p.push(`${ligne} : le champ « ${nom} » est trop long.`);
    }
    if (b.quote_part.trim() === "") {
      p.push(`${ligne} : quote-part obligatoire (la somme des quotes-parts fait 100 %).`);
      sommable = false;
      return;
    }
    const lue = lireQuotePart(b.quote_part);
    if ("erreur" in lue) {
      p.push(`${ligne} : quote-part illisible. ${lue.erreur}`);
      sommable = false;
    } else if (lue.valeur.lte(0) || lue.valeur.gt(100)) {
      p.push(`${ligne} : la quote-part doit être supérieure à 0 et au plus 100 %.`);
      sommable = false;
    } else {
      somme = somme.plus(lue.valeur);
    }
  });
  if (liste.length > 0 && sommable && !somme.eq(100)) {
    p.push(`La somme des quotes-parts des bénéficiaires est de ${somme.toString().replace(".", ",")} % : elle doit faire exactement 100 %.`);
  }
  return p;
}

/** Contacts d'urgence : nom et moyen de joindre la personne obligatoires pour chaque ligne saisie. */
export function problemesContactsUrgence(liste: ContactUrgence[]): string[] {
  const p: string[] = [];
  if (liste.length > NOMBRE_MAX_CONTACTS_URGENCE) p.push(`Au plus ${NOMBRE_MAX_CONTACTS_URGENCE} contacts d'urgence.`);
  liste.forEach((c, i) => {
    const ligne = `Contact d'urgence n° ${i + 1}`;
    if (c.nom_prenoms.trim() === "") p.push(`${ligne} : nom et prénoms obligatoires.`);
    if (c.contact.trim() === "") p.push(`${ligne} : le contact (téléphone) est obligatoire pour pouvoir joindre la personne.`);
    if (c.nom_prenoms.length > 300 || c.contact.length > 300) p.push(`${ligne} : texte trop long.`);
  });
  return p;
}

export function problemesAssures(assures: Assure[], codesFormules: readonly string[], aujourdhui: DateIso): string[] {
  const p: string[] = [];
  if (assures.length > NOMBRE_MAX_ASSURES) p.push(`Au plus ${NOMBRE_MAX_ASSURES} assurés par cotation.`);
  assures.forEach((a, i) => {
    const ligne = `Assuré n° ${i + 1}`;
    if (a.nom_prenoms.trim() === "") p.push(`${ligne} : nom et prénoms obligatoires.`);
    if (a.date_naissance !== "" && (!dateValide(a.date_naissance) || a.date_naissance > aujourdhui || a.date_naissance < "1900-01-01")) {
      p.push(`${ligne} : date de naissance invalide.`);
    }
    if (a.sexe !== "" && !(SEXES as readonly string[]).includes(a.sexe)) p.push(`${ligne} : sexe invalide (M ou F).`);
    if (a.formule !== "" && !codesFormules.includes(a.formule)) p.push(`${ligne} : formule « ${a.formule} » inconnue.`);
  });
  return p;
}

export function problemesRisque(risque: Risque): string[] {
  const p: string[] = [];
  const cles = Object.keys(risque);
  if (cles.length > NOMBRE_MAX_CHAMPS_RISQUE) p.push(`Au plus ${NOMBRE_MAX_CHAMPS_RISQUE} champs de risque.`);
  for (const cle of cles) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(cle)) p.push(`Nom de champ de risque invalide : « ${cle} » (minuscules, chiffres et _).`);
    if (risque[cle].length > 500) p.push(`Valeur trop longue pour « risque.${cle} ».`);
  }
  return p;
}

/** Choix de 1 à N formules distinctes, chacune avec un effectif entier d'au moins 1. */
export function problemesLignes(lignes: { codeFormule: string; effectif: number }[], formulesMax: number): string[] {
  const p: string[] = [];
  if (lignes.length < 1) p.push("Choisissez au moins une formule.");
  if (lignes.length > formulesMax) p.push(`Ce produit permet de comparer ${formulesMax} formule(s) au plus.`);
  if (new Set(lignes.map((l) => l.codeFormule)).size !== lignes.length) p.push("Une formule ne peut être choisie qu'une fois.");
  if (lignes.some((l) => !Number.isInteger(l.effectif) || l.effectif < 1)) p.push("Chaque effectif doit être un entier d'au moins 1.");
  return p;
}
