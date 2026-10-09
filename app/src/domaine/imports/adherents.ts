import { dateValide, type DateIso } from "../calcul/dates";
import { normaliserNumeroPolice, numeroCertificatParDefaut, problemesNumeroCertificat } from "../cotation/police";
import { SEXES, type Assure } from "../cotation/saisie";

/**
 * Import en masse des adhérents d'une police mère (CDC §13, session 5a). Règles PURES : lecture d'une ligne de
 * fichier (cellules déjà extraites par le serveur), contrôles ligne par ligne, doublons. Chaque ligne valide devient
 * un adhérent incorporé et un certificat d'adhésion (§10.2). Les noms des colonnes sont ceux du dictionnaire (§6.3.2,
 * `assures[].*`), plus le numéro du certificat : dérivé de la police mère (racine, lettre, numéro personnel sur
 * 5 chiffres), proposé d'après le numéro d'ordre de l'adhérent quand la colonne est vide, modifiable dans le fichier
 * (session 6.0, D27, H60).
 */

export type CleColonne = "numero_certificat" | "nom_prenoms" | "date_naissance" | "sexe" | "lien" | "formule";

export type Colonne = { cle: CleColonne; obligatoire: boolean; libelle: string; format: string; exemple: string };

/** Colonnes du fichier modèle, dans l'ordre (H60, H61). */
export const COLONNES_IMPORT: readonly Colonne[] = [
  { cle: "numero_certificat", obligatoire: false, libelle: "Numéro du certificat d'adhésion (vide : racine de la police mère et numéro d'ordre de l'adhérent)", format: "racine de la police mère, G ou I, puis 5 chiffres (pas 00000), unique", exemple: "SCD-2026-000088-G00001" },
  { cle: "nom_prenoms", obligatoire: true, libelle: "Nom et prénoms de l'adhérent (assures[].nom_prenoms)", format: "texte, 300 caractères au plus", exemple: "KOFFI Ama Inventée" },
  { cle: "date_naissance", obligatoire: true, libelle: "Date de naissance (assures[].date_naissance)", format: "JJ/MM/AAAA, AAAA-MM-JJ ou cellule date d'Excel", exemple: "14/03/1988" },
  { cle: "sexe", obligatoire: false, libelle: "Sexe (assures[].sexe)", format: "M ou F, ou vide", exemple: "F" },
  { cle: "lien", obligatoire: false, libelle: "Lien avec le souscripteur (assures[].lien)", format: "texte (ex. Salarié, Conjoint)", exemple: "Salarié" },
  { cle: "formule", obligatoire: true, libelle: "Code de la formule (assures[].formule)", format: "code d'une formule retenue dans la police", exemple: "SOLO" },
];

export const NOMBRE_MAX_LIGNES_IMPORT = 5000;

/** Valeur d'une cellule, telle que le serveur la lit (texte, nombre, date d'Excel) ; null si vide. */
export type Cellule = string | number | boolean | Date | null;

export type LigneBrute = { numero: number; cellules: Partial<Record<CleColonne, Cellule>> };

export type DonneesLigne = Record<CleColonne, string>;

export type ErreurLigne = { colonne: CleColonne | "ligne"; valeur: string; message: string };

export type LigneControlee = { numero: number; donnees: DonneesLigne; erreurs: ErreurLigne[] };

export type FormuleImport = { ageMin: number | null; ageMax: number | null };

export type ContexteControle = {
  /** Date d'effet de l'incorporation : date d'adhésion, à laquelle l'âge est calculé (H62). */
  dateEffet: DateIso;
  aujourdhui: DateIso;
  /** Formules du produit (version de la police) et leurs âges limites. */
  formulesProduit: ReadonlyMap<string, FormuleImport>;
  /** Formules retenues dans la police : seules celles-ci peuvent être choisies. */
  formulesPolice: readonly string[];
  /** Liste courante des adhérents de la police (doublons). */
  adherents: readonly Assure[];
  /** Numéros déjà pris (police, document émis ou ligne d'un import confirmé), parmi ceux à contrôler. */
  numerosPris: ReadonlySet<string>;
  /** Numéro de la police mère : racine des numéros de certificat. */
  numeroPolice: string;
  /** Numéro d'ordre que recevra le premier adhérent incorporé (le plus grand jamais attribué + 1). */
  prochainOrdre: number;
};

/** En-tête reconnu : nom de la colonne, sans casse ni accents, avec ou sans le préfixe « assures[]. ». */
export function cleDEntete(entete: string): CleColonne | null {
  const nom = sansAccents(entete).trim().toLowerCase().replace(/^assures\[\]\./, "").replace(/\s+/g, "_");
  return COLONNES_IMPORT.find((c) => c.cle === nom)?.cle ?? null;
}

const sansAccents = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Clé d'une personne pour les doublons (H63) : nom et prénoms sans casse, accents ni espaces superflus, et date de naissance. */
export const clePersonne = (nom: string, naissance: string) => `${sansAccents(nom).toUpperCase().replace(/\s+/g, " ").trim()}|${naissance}`;

/** Texte d'une cellule (date d'Excel exclue : voir lireDate). */
function texte(c: Cellule | undefined): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

/** Date de naissance : cellule date d'Excel, JJ/MM/AAAA ou AAAA-MM-JJ ; null si illisible. Un nombre seul est refusé (ambigu). */
export function lireDate(c: Cellule | undefined): DateIso | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c.toISOString().slice(0, 10);
  const t = texte(c);
  let iso: string | null = null;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (fr) iso = `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t;
  return iso && dateValide(iso) ? iso : null;
}

/** Âge en années révolues à une date (anniversaire du 29 février : le 1er mars des années non bissextiles). */
export function ageRevolu(naissance: DateIso, date: DateIso): number {
  const [an, mois, jour] = naissance.split("-").map(Number);
  const [an2, mois2, jour2] = date.split("-").map(Number);
  let age = an2 - an;
  if (mois2 < mois || (mois2 === mois && jour2 < jour)) age -= 1;
  return age;
}

/** Contrôle d'une ligne seule (formats, champs obligatoires, formule, âges, numéro), sans les doublons. */
function controlerLigne(l: LigneBrute, ctx: ContexteControle): LigneControlee {
  const erreurs: ErreurLigne[] = [];
  const valeurs = Object.fromEntries(COLONNES_IMPORT.map((c) => [c.cle, texte(l.cellules[c.cle])])) as DonneesLigne;
  const erreur = (colonne: CleColonne, message: string) => erreurs.push({ colonne, valeur: valeurs[colonne], message });

  for (const c of COLONNES_IMPORT) {
    if (c.obligatoire && valeurs[c.cle] === "") erreur(c.cle, "Champ obligatoire vide.");
  }
  for (const cle of ["nom_prenoms", "lien"] as const) {
    if (valeurs[cle].length > 300) erreur(cle, "Texte trop long (300 caractères au plus).");
  }

  const numero = normaliserNumeroPolice(valeurs.numero_certificat);
  if (numero !== "") {
    const problemes = problemesNumeroCertificat(numero, ctx.numeroPolice);
    for (const m of problemes) erreur("numero_certificat", m);
    if (problemes.length === 0 && ctx.numerosPris.has(numero)) erreur("numero_certificat", `Le numéro « ${numero} » est déjà utilisé par une police, un document ou un import en cours.`);
  }

  let naissance: DateIso | "" = "";
  if (valeurs.date_naissance !== "") {
    const lue = lireDate(l.cellules.date_naissance);
    if (lue === null) erreur("date_naissance", "Date invalide : écrivez JJ/MM/AAAA (ex. 14/03/1988) ou AAAA-MM-JJ.");
    else if (lue < "1900-01-01" || lue > ctx.aujourdhui) erreur("date_naissance", "Date de naissance impossible (avant 1900 ou dans le futur).");
    else naissance = lue;
  }

  const sexe = valeurs.sexe.toUpperCase();
  if (sexe !== "" && !(SEXES as readonly string[]).includes(sexe)) erreur("sexe", "Sexe invalide : M, F ou vide.");

  const formule = valeurs.formule.toUpperCase();
  if (formule !== "") {
    const parametree = ctx.formulesProduit.get(formule);
    if (!parametree) erreur("formule", `Formule « ${formule} » inconnue pour ce produit.`);
    else if (!ctx.formulesPolice.includes(formule)) erreur("formule", `Formule « ${formule} » non retenue dans la police (formules de la police : ${ctx.formulesPolice.join(", ")}).`);
    else if (naissance !== "") {
      const age = ageRevolu(naissance, ctx.dateEffet);
      if (parametree.ageMin !== null && age < parametree.ageMin) erreur("date_naissance", `Âge hors limite : ${age} ans à la date d'adhésion (${ctx.dateEffet}), minimum ${parametree.ageMin} ans pour la formule ${formule}.`);
      if (parametree.ageMax !== null && age > parametree.ageMax) erreur("date_naissance", `Âge hors limite : ${age} ans à la date d'adhésion (${ctx.dateEffet}), maximum ${parametree.ageMax} ans pour la formule ${formule}.`);
    }
  }

  return { numero: l.numero, donnees: { ...valeurs, numero_certificat: numero, date_naissance: naissance || valeurs.date_naissance, sexe, formule }, erreurs };
}

/**
 * Contrôle de toutes les lignes (CDC §13) : chaque ligne seule, puis les doublons (H63) — dans le fichier (la
 * première occurrence VALIDE reste valide, les suivantes sont en erreur ; une ligne déjà en erreur ne compte pas) et
 * avec les adhérents de la liste courante — puis les numéros de certificat.
 *
 * Numéro vide : il est proposé d'après le numéro d'ordre que l'adhérent recevra. Seules les lignes valides sont
 * incorporées, dans l'ordre du fichier : la n-ième ligne valide reçoit `prochainOrdre + n - 1`. Une ligne qui tombe en
 * erreur décale les suivantes ; les numéros proposés sont donc recalculés jusqu'à ce qu'aucune nouvelle erreur
 * n'apparaisse (chaque tour ajoute au moins une erreur : la boucle s'arrête). Le numéro retenu est écrit dans la
 * ligne : c'est celui que l'écran de contrôle montre et que le certificat portera.
 */
export function controlerLignes(lignes: readonly LigneBrute[], ctx: ContexteControle): LigneControlee[] {
  const resultat = lignes.map((l) => controlerLigne(l, ctx));
  const saisis = new Map(resultat.map((l) => [l, l.donnees.numero_certificat]));
  const existants = new Map(ctx.adherents.map((a) => [clePersonne(a.nom_prenoms, a.date_naissance), a.ordre]));
  const personnes = new Map<string, number>();
  for (const l of resultat) {
    if (l.erreurs.length > 0) continue;
    const { nom_prenoms: nom, date_naissance: naissance } = l.donnees;
    if (nom !== "" && dateValide(naissance)) {
      const cle = clePersonne(nom, naissance);
      const ordre = existants.get(cle);
      if (ordre !== undefined) l.erreurs.push({ colonne: "nom_prenoms", valeur: nom, message: `Doublon : déjà adhérent de la police (n° d'ordre ${ordre}, même nom et même date de naissance).` });
      else if (personnes.has(cle)) l.erreurs.push({ colonne: "nom_prenoms", valeur: nom, message: `Doublon de la ligne ${personnes.get(cle)} (même nom et même date de naissance).` });
      else personnes.set(cle, l.numero);
    }
  }

  for (;;) {
    const valides = resultat.filter((l) => l.erreurs.length === 0);
    const numeros = new Map<string, number>();
    let nouvelle = false;
    valides.forEach((l, i) => {
      const saisi = saisis.get(l) ?? "";
      const numero = saisi !== "" ? saisi : (numeroCertificatParDefaut(ctx.numeroPolice, ctx.prochainOrdre + i) ?? "");
      l.donnees.numero_certificat = numero;
      if (saisi === "" && numero === "") {
        l.erreurs.push({ colonne: "numero_certificat", valeur: "", message: problemesNumeroCertificat("", ctx.numeroPolice)[0] ?? "Numéro du certificat impossible à proposer : saisissez-le." });
      } else if (saisi === "" && ctx.numerosPris.has(numero)) {
        l.erreurs.push({ colonne: "numero_certificat", valeur: numero, message: `Le numéro proposé « ${numero} » est déjà utilisé : saisissez un autre numéro dans le fichier.` });
      } else if (numeros.has(numero)) {
        l.erreurs.push({ colonne: "numero_certificat", valeur: numero, message: `Numéro de certificat déjà donné à la ligne ${numeros.get(numero)}.` });
      } else {
        numeros.set(numero, l.numero);
        return;
      }
      nouvelle = true;
    });
    if (!nouvelle) break;
  }
  // Une ligne en erreur garde le numéro du fichier (vide s'il n'y en avait pas) : rien ne lui est proposé.
  for (const l of resultat) if (l.erreurs.length > 0) l.donnees.numero_certificat = saisis.get(l) ?? "";
  return resultat;
}

/** Adhérent à incorporer, à partir d'une ligne valide (noms du dictionnaire). */
export const adherentDeLigne = (d: DonneesLigne): Omit<Assure, "ordre"> => ({
  nom_prenoms: d.nom_prenoms,
  date_naissance: d.date_naissance,
  sexe: d.sexe as Assure["sexe"],
  lien: d.lien,
  formule: d.formule,
});
