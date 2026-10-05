import { dateValide, type DateIso } from "../calcul/dates";

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
};

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

export function problemesSouscripteur(s: Souscripteur): string[] {
  const p: string[] = [];
  if (s.type !== "PHYSIQUE" && s.type !== "MORALE") p.push("Le type de souscripteur doit être PHYSIQUE ou MORALE.");
  if (s.type === "PHYSIQUE" && s.nom.trim() === "") p.push("Le nom du souscripteur est obligatoire.");
  if (s.type === "MORALE" && s.raison_sociale.trim() === "") p.push("La raison sociale du souscripteur est obligatoire.");
  if (s.email.trim() !== "" && !COURRIEL.test(s.email.trim())) p.push("L'adresse e-mail du souscripteur est invalide.");
  for (const [nom, valeur] of Object.entries(s)) {
    if (typeof valeur === "string" && valeur.length > 300) p.push(`Le champ « ${nom} » du souscripteur est trop long.`);
  }
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
