import ExcelJS from "exceljs";

import { ErreurExpression, lireOperande, lireTranches, schemaBareme, VERSION_SCHEMA_BAREME, verifierBareme, type Bareme } from "@/domaine/bareme";
import { problemesArchiveXlsx } from "@/domaine/imports/archive";

import { ErreurMetier } from "./types";

/**
 * Lecture d'un classeur de barème (B9, D50) : feuilles Lisez-moi, Blocs, Champs, Valeurs, Intermediaires, Garanties, Composantes,
 * Tables, SousJacents, Essais → document JSON du barème. Seules les VALEURS des cellules sont lues : une cellule contenant une
 * formule est refusée (jamais évaluée). Chaque erreur est nommée par feuille, cellule et règle. Cette lecture ne touche pas la base.
 */

export const TAILLE_MAX_CLASSEUR = 5 * 1024 * 1024;
const LIGNES_MAX = 20_000;
const COLONNES_MAX = 60;
const ERREURS_AFFICHEES = 200;

export const FEUILLE = {
  lisezmoi: "Lisez-moi",
  blocs: "Blocs",
  champs: "Champs",
  valeurs: "Valeurs",
  intermediaires: "Intermediaires",
  garanties: "Garanties",
  composantes: "Composantes",
  tables: "Tables",
  sousJacents: "SousJacents",
  essais: "Essais",
} as const;

/** Étiquettes (colonne A) des paramètres du produit dans la feuille Lisez-moi. */
export const ETIQUETTE = {
  schema: "Version du schéma",
  taxe: "Catégorie de taxe du produit",
  accessoiresMode: "Accessoires du produit : mode",
  accessoiresMontant: "Accessoires du produit : montant",
  empreinte: "Empreinte du barème publié (SHA-256)",
} as const;

export type ErreurCellule = { ref: string; regle: string; message: string };

/** Import refusé : toutes les erreurs trouvées, chacune avec sa feuille, sa cellule et sa règle. Rien n'a été enregistré. */
export class ErreurImportBareme extends ErreurMetier {
  override name = "ErreurImportBareme";
  constructor(readonly erreurs: ErreurCellule[]) {
    super(
      `Import refusé : ${erreurs.length} erreur(s), rien n'est enregistré.`,
      [...erreurs.slice(0, ERREURS_AFFICHEES).map((e) => `${e.ref} : ${e.message} (règle ${e.regle})`), ...(erreurs.length > ERREURS_AFFICHEES ? [`… et ${erreurs.length - ERREURS_AFFICHEES} autre(s) erreur(s).`] : [])],
    );
  }
}

// ---------------------------------------------------------------- Outils

const lettre = (n: number): string => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};
const adresse = (feuille: string, ligne: number, col: number) => `${feuille}!${lettre(col)}${ligne}`;
const normaliser = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, "_");
const nomFeuille = (t: string) => normaliser(t).replace(/[^a-z0-9]/g, "");

/** Chemin du document → cellule d'origine : un message de validation retrouve ainsi sa cellule (plus long préfixe connu). */
class Origine {
  private readonly m = new Map<string, string>();
  noter(chemin: string, ref: string) {
    if (!this.m.has(chemin)) this.m.set(chemin, ref);
  }
  trouver(chemin: string): string | undefined {
    for (let c = chemin; ; ) {
      const r = this.m.get(c);
      if (r) return r;
      const i = c.lastIndexOf(".");
      if (i < 0) return undefined;
      c = c.slice(0, i);
    }
  }
}

type Brute = string | number | boolean | Date;
type Cellule = { ref: string; v: Brute | undefined; brute: boolean };
const VIDE = (ref: string): Cellule => ({ ref, v: undefined, brute: false });

class Lecture {
  readonly erreurs: ErreurCellule[] = [];
  readonly origine = new Origine();
  /** Localisation des entités pour les messages de `verifierBareme` : « champ:x », « table:t », « composante:g.c »… */
  readonly index = new Map<string, string>();
  private readonly vues = new Set<string>();
  erreur(ref: string, regle: string, message: string) {
    const cle = `${ref}|${regle}`;
    if (this.vues.has(cle)) return;
    this.vues.add(cle);
    this.erreurs.push({ ref, regle, message });
  }
  noter(chemin: string, c: Cellule) {
    this.origine.noter(chemin, c.ref);
  }
}

/** Valeur d'une cellule ; une formule, une erreur Excel ou un contenu inconnu est une erreur nommée et la cellule compte comme vide. */
function lireCellule(cell: ExcelJS.Cell, ref: string, lec: Lecture): Cellule {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return VIDE(ref);
  if (typeof v === "string") return { ref, v: v.trim() === "" ? undefined : v.trim(), brute: true };
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return { ref, v, brute: true };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      lec.erreur(ref, "FORMULE_REFUSEE", "cellule de formule refusée : saisissez la valeur elle-même (les formules ne sont jamais évaluées)");
      return { ref, v: undefined, brute: true };
    }
    if (Array.isArray(o.richText)) {
      const t = (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
      return { ref, v: t === "" ? undefined : t, brute: true };
    }
    if (typeof o.text === "string") return { ref, v: o.text.trim() === "" ? undefined : o.text.trim(), brute: true };
    if ("error" in o) {
      lec.erreur(ref, "CELLULE_EN_ERREUR", `cellule en erreur Excel (${String(o.error)})`);
      return { ref, v: undefined, brute: true };
    }
  }
  lec.erreur(ref, "CELLULE_ILLISIBLE", "contenu de cellule non reconnu");
  return { ref, v: undefined, brute: true };
}

const texteDeNombre = (n: number, c: Cellule, lec: Lecture): string | undefined => {
  const t = String(n);
  if (!Number.isFinite(n) || /e/i.test(t)) {
    lec.erreur(c.ref, "NOMBRE_ILLISIBLE", "nombre trop grand ou trop petit : écrivez-le sans notation scientifique, en texte");
    return undefined;
  }
  return t;
};

const lire = {
  texte(c: Cellule, lec: Lecture): string | undefined {
    if (c.v === undefined) return undefined;
    if (typeof c.v === "string") return c.v;
    if (typeof c.v === "number") return texteDeNombre(c.v, c, lec);
    if (c.v instanceof Date) return c.v.toISOString().slice(0, 10);
    lec.erreur(c.ref, "TEXTE_ATTENDU", "texte attendu, pas un booléen");
    return undefined;
  },
  decimal(c: Cellule, lec: Lecture): string | undefined {
    if (c.v === undefined) return undefined;
    if (typeof c.v === "number") return texteDeNombre(c.v, c, lec);
    if (typeof c.v === "string") return /^\d+,\d+$/.test(c.v) ? c.v.replace(",", ".") : c.v;
    lec.erreur(c.ref, "NOMBRE_ATTENDU", "nombre attendu");
    return undefined;
  },
  entier(c: Cellule, lec: Lecture): number | undefined {
    if (c.v === undefined) return undefined;
    const n = typeof c.v === "number" ? c.v : typeof c.v === "string" && /^\d+$/.test(c.v) ? Number(c.v) : NaN;
    if (!Number.isInteger(n)) {
      lec.erreur(c.ref, "ENTIER_ATTENDU", "nombre entier attendu");
      return undefined;
    }
    return n;
  },
  booleen(c: Cellule, lec: Lecture): boolean | undefined {
    if (c.v === undefined) return undefined;
    if (typeof c.v === "boolean") return c.v;
    const t = typeof c.v === "string" ? normaliser(c.v) : "";
    if (["oui", "vrai", "true", "1"].includes(t)) return true;
    if (["non", "faux", "false", "0"].includes(t)) return false;
    lec.erreur(c.ref, "OUI_NON_ATTENDU", "OUI ou NON attendu");
    return undefined;
  },
};

type LigneLue = { numero: number; cellule: (colonne: string) => Cellule; presente: (colonne: string) => boolean };
type Tableau = { lignes: LigneLue[]; entetes: { nom: string; col: number; ref: string }[]; refEntete: string };

/** Trouve une feuille par son nom (sans tenir compte de la casse, des accents ni des espaces). */
function trouverFeuille(classeur: ExcelJS.Workbook, nom: string): ExcelJS.Worksheet | undefined {
  return classeur.worksheets.find((w) => nomFeuille(w.name) === nomFeuille(nom));
}

/** Lit une feuille à en-têtes (ligne 1) : colonnes connues seulement (sauf `libre`), colonnes obligatoires présentes. */
function lireTableau(ws: ExcelJS.Worksheet, nom: string, lec: Lecture, connues: readonly string[], obligatoires: readonly string[], libre = false): Tableau | undefined {
  if (ws.rowCount > LIGNES_MAX || ws.columnCount > COLONNES_MAX) {
    lec.erreur(`${nom}!A1`, "FEUILLE_TROP_GRANDE", `feuille trop grande (au plus ${LIGNES_MAX} lignes et ${COLONNES_MAX} colonnes)`);
    return undefined;
  }
  const entetes: Tableau["entetes"] = [];
  const entete = ws.getRow(1);
  for (let col = 1; col <= ws.columnCount; col++) {
    const c = lireCellule(entete.getCell(col), adresse(nom, 1, col), lec);
    const t = lire.texte(c, lec);
    if (t === undefined) continue;
    const n = normaliser(t);
    if (!libre && !connues.includes(n)) lec.erreur(c.ref, "COLONNE_INCONNUE", `colonne « ${t} » inconnue (colonnes admises : ${connues.join(", ")})`);
    else if (libre && !connues.includes(n) && !/^[a-z][a-z0-9_]*$/.test(n)) lec.erreur(c.ref, "COLONNE_INCONNUE", `nom de colonne « ${t} » invalide (minuscules, chiffres et _)`);
    else entetes.push({ nom: n, col, ref: c.ref });
  }
  for (const o of obligatoires) if (!entetes.some((e) => e.nom === o)) lec.erreur(`${nom}!A1`, "COLONNE_ABSENTE", `colonne « ${o} » absente de la ligne 1`);
  const lignes: LigneLue[] = [];
  for (let numero = 2; numero <= ws.rowCount; numero++) {
    const row = ws.getRow(numero);
    if (!entetes.some((e) => row.getCell(e.col).value !== null && row.getCell(e.col).value !== undefined)) continue;
    lignes.push({
      numero,
      cellule: (colonne) => {
        const e = entetes.find((x) => x.nom === colonne);
        return e ? lireCellule(row.getCell(e.col), adresse(nom, numero, e.col), lec) : VIDE(adresse(nom, numero, 1));
      },
      presente: (colonne) => {
        const e = entetes.find((x) => x.nom === colonne);
        return e ? lireCellule(row.getCell(e.col), adresse(nom, numero, e.col), lec).v !== undefined : false;
      },
    });
  }
  return { lignes, entetes, refEntete: `${nom}!A1` };
}

type Objet = Record<string, unknown>;
const poser = (o: Objet, cle: string, valeur: unknown) => {
  if (valeur !== undefined) o[cle] = valeur;
};

/** Condition d'affichage / contrôle sur un champ : trois colonnes (type, cible, valeur). */
function lireCondition(l: LigneLue, prefixe: string, chemin: string, lec: Lecture): Objet | undefined {
  const type = l.cellule(`${prefixe}_type`);
  const cible = l.cellule(`${prefixe}_cible`);
  const valeur = l.cellule(`${prefixe}_valeur`);
  const t = lire.texte(type, lec);
  const cibleT = lire.texte(cible, lec);
  const valeurT = lire.texte(valeur, lec);
  if (t === undefined && cibleT === undefined && valeurT === undefined) return undefined;
  lec.noter(chemin, type.v !== undefined ? type : cible);
  lec.noter(`${chemin}.champ`, cible);
  lec.noter(`${chemin}.souscrit`, cible);
  lec.noter(`${chemin}.egal`, valeur);
  lec.noter(`${chemin}.different`, valeur);
  const n = t === undefined ? "" : normaliser(t);
  if (n === "champ_egal") return { champ: cibleT, ...(valeurT !== undefined ? { egal: valeurT } : { egal: undefined }) };
  if (n === "champ_different") return { champ: cibleT, ...(valeurT !== undefined ? { different: valeurT } : { different: undefined }) };
  if (n === "souscrit") return { souscrit: cibleT };
  lec.erreur(type.v !== undefined ? type.ref : cible.ref, "CONDITION_INCONNUE", `type de condition « ${t ?? ""} » inconnu (CHAMP_EGAL, CHAMP_DIFFERENT ou SOUSCRIT)`);
  return undefined;
}

function lireExpression(c: Cellule, lec: Lecture): unknown {
  const t = lire.texte(c, lec);
  if (t === undefined) return undefined;
  try {
    return lireOperande(t);
  } catch (e) {
    if (e instanceof ErreurExpression) lec.erreur(c.ref, "EXPRESSION_ILLISIBLE", `expression illisible : ${e.message}`);
    else throw e;
    return undefined;
  }
}

// ---------------------------------------------------------------- Feuilles

const COLONNES_CHAMPS = ["code", "libelle", "aide", "type", "bloc", "obligatoire", "numerique", "min", "max", "si_type", "si_cible", "si_valeur", "sur_documents"] as const;
const COLONNES_GARANTIES = ["code", "nom", "definition", "afficher_sur_documents", "souscription", "si_type", "si_cible", "si_valeur", "taxe", "accessoires_mode", "accessoires_montant"] as const;
const COLONNES_COMPOSANTES = ["garantie", "code", "souscription", "assiette", "taux_unite", "taux_fixe", "taux_source", "minimum", "par_tete"] as const;
const COLONNES_SOUS_JACENTS = ["code", "effet", "table", "cibles", "reduction", "mode", "quand_type", "quand_gauche", "quand_comparateur", "quand_droite", "message"] as const;
const COLONNES_ESSAIS = ["essai", "rubrique", "cle", "valeur", "nette", "acc", "taxe", "ttc"] as const;
const APPLICABLE: Record<string, readonly string[]> = {
  E1: ["table", "cibles"],
  E2: ["table", "cibles", "reduction"],
  E5: ["table", "cibles", "mode"],
  E4: ["quand_type", "quand_gauche", "quand_comparateur", "quand_droite", "message"],
};

/** Accessoires (mode + montant) : un décimal, ou, en mode PAR_TRANCHE, la liste « 1-5: 2500; 6-10: 4000 ». */
function lireAccessoires(modeCellule: Cellule, montantCellule: Cellule, lec: Lecture): Objet | undefined {
  const mode = lire.texte(modeCellule, lec);
  if (mode === "PAR_TRANCHE") {
    const texte = lire.texte(montantCellule, lec);
    if (texte === undefined) return { mode };
    try {
      return { mode, tranches: lireTranches(texte) };
    } catch (e) {
      lec.erreur(montantCellule.ref, "TRANCHES_ILLISIBLES", `tranches illisibles : ${e instanceof Error ? e.message : ""}`);
      return undefined;
    }
  }
  const montant = lire.decimal(montantCellule, lec);
  return mode !== undefined || montant !== undefined ? { ...(mode !== undefined ? { mode } : {}), ...(montant !== undefined ? { montant } : {}) } : undefined;
}

function lireParametres(ws: ExcelJS.Worksheet | undefined, lec: Lecture, doc: Objet) {
  const nom = FEUILLE.lisezmoi;
  if (!ws) {
    lec.erreur(`${nom}!A1`, "FEUILLE_ABSENTE", `feuille « ${nom} » absente : elle porte la catégorie de taxe du produit`);
    return;
  }
  const valeurs = new Map<string, Cellule>();
  for (let r = 1; r <= Math.min(ws.rowCount, 200); r++) {
    const a = ws.getRow(r).getCell(1).value;
    if (typeof a !== "string") continue;
    const etiquette = Object.values(ETIQUETTE).find((e) => normaliser(e) === normaliser(a));
    if (etiquette) valeurs.set(etiquette, lireCellule(ws.getRow(r).getCell(2), adresse(nom, r, 2), lec));
  }
  const cell = (e: string): Cellule => valeurs.get(e) ?? VIDE(`${nom}!B1`);
  const schema = lire.entier(cell(ETIQUETTE.schema), lec);
  if (schema !== undefined && schema !== VERSION_SCHEMA_BAREME) lec.erreur(cell(ETIQUETTE.schema).ref, "SCHEMA_INCONNU", `version du schéma ${schema} non prise en charge (attendu : ${VERSION_SCHEMA_BAREME})`);
  doc.schema = VERSION_SCHEMA_BAREME;
  if (!valeurs.has(ETIQUETTE.taxe)) lec.erreur(`${nom}!A1`, "PARAMETRE_ABSENT", `ligne « ${ETIQUETTE.taxe} » absente de la feuille ${nom}`);
  const produit: Objet = {};
  poser(produit, "taxe", lire.texte(cell(ETIQUETTE.taxe), lec));
  const accessoires = lireAccessoires(cell(ETIQUETTE.accessoiresMode), cell(ETIQUETTE.accessoiresMontant), lec);
  if (accessoires) produit.accessoires = accessoires;
  doc.produit = produit;
  lec.noter("produit", cell(ETIQUETTE.taxe));
  lec.noter("produit.taxe", cell(ETIQUETTE.taxe));
  lec.noter("produit.accessoires", cell(ETIQUETTE.accessoiresMode).v !== undefined ? cell(ETIQUETTE.accessoiresMode) : cell(ETIQUETTE.accessoiresMontant));
  lec.noter("produit.accessoires.mode", cell(ETIQUETTE.accessoiresMode));
  lec.noter("produit.accessoires.montant", cell(ETIQUETTE.accessoiresMontant));
  lec.noter("produit.accessoires.tranches", cell(ETIQUETTE.accessoiresMontant));
}

function lireBlocs(ws: ExcelJS.Worksheet | undefined, lec: Lecture, doc: Objet) {
  doc.blocs = [];
  if (!ws) return;
  const t = lireTableau(ws, FEUILLE.blocs, lec, ["code", "libelle"], ["code", "libelle"]);
  for (const [i, l] of (t?.lignes ?? []).entries()) {
    const o: Objet = {};
    poser(o, "code", lire.texte(l.cellule("code"), lec));
    poser(o, "libelle", lire.texte(l.cellule("libelle"), lec) ?? "");
    lec.noter(`blocs.${i}`, l.cellule("code"));
    lec.noter(`blocs.${i}.code`, l.cellule("code"));
    lec.noter(`blocs.${i}.libelle`, l.cellule("libelle"));
    (doc.blocs as Objet[]).push(o);
  }
}

function lireChamps(classeur: ExcelJS.Workbook, lec: Lecture, doc: Objet) {
  doc.champs = [];
  const ws = trouverFeuille(classeur, FEUILLE.champs);
  if (!ws) return lec.erreur(`${FEUILLE.champs}!A1`, "FEUILLE_ABSENTE", `feuille « ${FEUILLE.champs} » absente`);
  const t = lireTableau(ws, FEUILLE.champs, lec, COLONNES_CHAMPS, ["code", "type"]);
  const parCode = new Map<string, { o: Objet; i: number }>();
  for (const [i, l] of (t?.lignes ?? []).entries()) {
    const base = `champs.${i}`;
    const o: Objet = {};
    for (const [col, cle, genre] of [
      ["code", "code", "texte"],
      ["libelle", "libelle", "texte"],
      ["aide", "aide", "texte"],
      ["type", "type", "texte"],
      ["bloc", "bloc", "texte"],
      ["obligatoire", "obligatoire", "booleen"],
      ["numerique", "numerique", "booleen"],
      ["min", "min", "decimal"],
      ["max", "max", "decimal"],
      ["sur_documents", "surDocuments", "booleen"],
    ] as const) {
      const c = l.cellule(col);
      lec.noter(`${base}.${cle}`, c);
      poser(o, cle, lire[genre](c, lec));
    }
    lec.noter(base, l.cellule("code"));
    const si = lireCondition(l, "si", `${base}.si`, lec);
    if (si) o.si = si;
    if (typeof o.code === "string") {
      lec.index.set(`champ:${o.code}`, l.cellule("code").ref);
      parCode.set(o.code, { o, i });
    }
    (doc.champs as Objet[]).push(o);
  }
  // Valeurs des listes
  const wv = trouverFeuille(classeur, FEUILLE.valeurs);
  if (!wv) return;
  const tv = lireTableau(wv, FEUILLE.valeurs, lec, ["champ", "v", "l"], ["champ", "v"], true);
  const attributs = (tv?.entetes ?? []).filter((e) => !["champ", "v", "l"].includes(e.nom));
  const compte = new Map<string, number>();
  for (const l of tv?.lignes ?? []) {
    const champ = lire.texte(l.cellule("champ"), lec);
    if (champ === undefined) {
      lec.erreur(l.cellule("champ").ref, "CASE_VIDE", "case vide : le code du champ est obligatoire");
      continue;
    }
    const cible = parCode.get(champ);
    if (!cible) {
      lec.erreur(l.cellule("champ").ref, "CHAMP_INCONNU", `le champ « ${champ} » n'existe pas dans la feuille ${FEUILLE.champs}`);
      continue;
    }
    const v = lire.texte(l.cellule("v"), lec);
    if (v === undefined) {
      lec.erreur(l.cellule("v").ref, "CASE_VIDE", `case vide : la valeur de la liste du champ « ${champ} » est obligatoire`);
      continue;
    }
    const libelle = lire.texte(l.cellule("l"), lec);
    const extras: Objet = {};
    for (const a of attributs) {
      const c = l.cellule(a.nom);
      if (c.v === undefined) continue;
      if (typeof c.v === "boolean" || c.v instanceof Date) lec.erreur(c.ref, "TEXTE_OU_NOMBRE_ATTENDU", "texte ou nombre attendu");
      else extras[a.nom] = c.v;
    }
    const entree: unknown = libelle === undefined && Object.keys(extras).length === 0 ? v : { v, ...(libelle !== undefined ? { l: libelle } : {}), ...extras };
    const j = compte.get(champ) ?? 0;
    compte.set(champ, j + 1);
    const liste = (cible.o.valeurs ??= []) as unknown[];
    liste.push(entree);
    lec.noter(`champs.${cible.i}.valeurs.${j}`, l.cellule("v"));
    lec.noter(`champs.${cible.i}.valeurs.${j}.v`, l.cellule("v"));
    lec.noter(`champs.${cible.i}.valeurs.${j}.l`, l.cellule("l"));
  }
}

function lireIntermediaires(ws: ExcelJS.Worksheet | undefined, lec: Lecture, doc: Objet) {
  doc.intermediaires = [];
  if (!ws) return;
  const t = lireTableau(ws, FEUILLE.intermediaires, lec, ["code", "expression"], ["code", "expression"]);
  for (const [i, l] of (t?.lignes ?? []).entries()) {
    const o: Objet = {};
    poser(o, "code", lire.texte(l.cellule("code"), lec));
    poser(o, "op", lireExpression(l.cellule("expression"), lec));
    lec.noter(`intermediaires.${i}`, l.cellule("code"));
    lec.noter(`intermediaires.${i}.code`, l.cellule("code"));
    lec.noter(`intermediaires.${i}.op`, l.cellule("expression"));
    if (typeof o.code === "string") lec.index.set(`inter:${o.code}`, l.cellule("code").ref);
    (doc.intermediaires as Objet[]).push(o);
  }
}

function lireGaranties(classeur: ExcelJS.Workbook, lec: Lecture, doc: Objet) {
  doc.garanties = [];
  const ws = trouverFeuille(classeur, FEUILLE.garanties);
  if (!ws) return lec.erreur(`${FEUILLE.garanties}!A1`, "FEUILLE_ABSENTE", `feuille « ${FEUILLE.garanties} » absente`);
  const t = lireTableau(ws, FEUILLE.garanties, lec, COLONNES_GARANTIES, ["code", "nom", "souscription"]);
  const parCode = new Map<string, { o: Objet; i: number }>();
  for (const [i, l] of (t?.lignes ?? []).entries()) {
    const base = `garanties.${i}`;
    const o: Objet = {};
    for (const [col, cle, genre] of [
      ["code", "code", "texte"],
      ["nom", "nom", "texte"],
      ["definition", "definition", "texte"],
      ["afficher_sur_documents", "afficherSurDocuments", "booleen"],
      ["souscription", "souscription", "texte"],
      ["taxe", "taxe", "texte"],
    ] as const) {
      lec.noter(`${base}.${cle}`, l.cellule(col));
      poser(o, cle, lire[genre](l.cellule(col), lec));
    }
    lec.noter(base, l.cellule("code"));
    lec.noter(`${base}.composantes`, l.cellule("code"));
    const si = lireCondition(l, "si", `${base}.si`, lec);
    if (si) o.si = si;
    const accessoires = lireAccessoires(l.cellule("accessoires_mode"), l.cellule("accessoires_montant"), lec);
    if (accessoires) o.accessoires = accessoires;
    lec.noter(`${base}.accessoires`, l.cellule("accessoires_mode").v !== undefined ? l.cellule("accessoires_mode") : l.cellule("accessoires_montant"));
    lec.noter(`${base}.accessoires.tranches`, l.cellule("accessoires_montant"));
    lec.noter(`${base}.accessoires.mode`, l.cellule("accessoires_mode"));
    lec.noter(`${base}.accessoires.montant`, l.cellule("accessoires_montant"));
    o.composantes = [];
    if (typeof o.code === "string") {
      lec.index.set(`garantie:${o.code}`, l.cellule("code").ref);
      parCode.set(o.code, { o, i });
    }
    (doc.garanties as Objet[]).push(o);
  }
  const wc = trouverFeuille(classeur, FEUILLE.composantes);
  if (!wc) return lec.erreur(`${FEUILLE.composantes}!A1`, "FEUILLE_ABSENTE", `feuille « ${FEUILLE.composantes} » absente`);
  const tc = lireTableau(wc, FEUILLE.composantes, lec, COLONNES_COMPOSANTES, ["garantie", "code", "assiette"]);
  for (const l of tc?.lignes ?? []) {
    const g = lire.texte(l.cellule("garantie"), lec);
    const cible = g === undefined ? undefined : parCode.get(g);
    if (!cible) {
      lec.erreur(l.cellule("garantie").ref, g === undefined ? "CASE_VIDE" : "GARANTIE_INCONNUE", g === undefined ? "case vide : la garantie de la composante est obligatoire" : `la garantie « ${g} » n'existe pas dans la feuille ${FEUILLE.garanties}`);
      continue;
    }
    const liste = cible.o.composantes as Objet[];
    const base = `garanties.${cible.i}.composantes.${liste.length}`;
    const o: Objet = {};
    for (const [col, cle, genre] of [
      ["code", "code", "texte"],
      ["souscription", "souscription", "texte"],
      ["minimum", "minimum", "decimal"],
      ["par_tete", "parTete", "booleen"],
    ] as const) {
      lec.noter(`${base}.${cle}`, l.cellule(col));
      poser(o, cle, lire[genre](l.cellule(col), lec));
    }
    lec.noter(base, l.cellule("code"));
    lec.noter(`${base}.assiette`, l.cellule("assiette"));
    poser(o, "assiette", lireExpression(l.cellule("assiette"), lec));
    const fixe = lire.decimal(l.cellule("taux_fixe"), lec);
    const source = lire.texte(l.cellule("taux_source"), lec);
    if (fixe !== undefined && source !== undefined) lec.erreur(l.cellule("taux_fixe").ref, "TAUX_AMBIGU", "un taux est fixe OU tiré d'un sous-jacent (E1) : remplissez taux_fixe ou taux_source, pas les deux");
    o.taux = { ...(lire.texte(l.cellule("taux_unite"), lec) !== undefined ? { unite: lire.texte(l.cellule("taux_unite"), lec) } : {}), ...(fixe !== undefined ? { fixe } : {}), ...(source !== undefined ? { source } : {}) };
    lec.noter(`${base}.taux`, l.cellule("taux_unite"));
    lec.noter(`${base}.taux.unite`, l.cellule("taux_unite"));
    lec.noter(`${base}.taux.fixe`, l.cellule("taux_fixe"));
    lec.noter(`${base}.taux.source`, l.cellule("taux_source"));
    if (typeof o.code === "string") lec.index.set(`composante:${g}.${o.code}`, l.cellule("code").ref);
    liste.push(o);
  }
}

function lireTables(ws: ExcelJS.Worksheet | undefined, lec: Lecture, doc: Objet) {
  doc.tables = [];
  if (!ws) return;
  const nom = FEUILLE.tables;
  if (ws.rowCount > LIGNES_MAX || ws.columnCount > COLONNES_MAX) return lec.erreur(`${nom}!A1`, "FEUILLE_TROP_GRANDE", `feuille trop grande (au plus ${LIGNES_MAX} lignes et ${COLONNES_MAX} colonnes)`);
  const cel = (r: number, c: number) => lireCellule(ws.getRow(r).getCell(c), adresse(nom, r, c), lec);
  const brute = (r: number, c: number) => {
    const v = ws.getRow(r).getCell(c).value;
    return v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
  };
  const ligneVide = (r: number) => {
    for (let c = 1; c <= ws.columnCount; c++) if (brute(r, c)) return false;
    return true;
  };
  let r = 1;
  while (r <= ws.rowCount) {
    if (ligneVide(r)) {
      r++;
      continue;
    }
    const marque = lire.texte(cel(r, 1), lec);
    if (marque === undefined || normaliser(marque) !== "table") {
      lec.erreur(adresse(nom, r, 1), "LIGNE_HORS_TABLE", "ligne hors d'une table : chaque table commence par une ligne « TABLE » (colonne A), son code (B), sa clé en lignes (C) et sa clé en colonnes (D)");
      r++;
      continue;
    }
    const i = (doc.tables as Objet[]).length;
    const base = `tables.${i}`;
    const code = lire.texte(cel(r, 2), lec);
    const cles = [lire.texte(cel(r, 3), lec), lire.texte(cel(r, 4), lec)].filter((x): x is string => x !== undefined);
    const o: Objet = {};
    poser(o, "code", code);
    o.cles = cles;
    lec.noter(base, cel(r, 2));
    lec.noter(`${base}.code`, cel(r, 2));
    lec.noter(`${base}.cles`, cel(r, 3));
    lec.noter(`${base}.lignes`, cel(r, 2));
    if (code) lec.index.set(`table:${code}`, adresse(nom, r, 2));
    const lignes: Record<string, string> = {};
    o.lignes = lignes;
    (doc.tables as Objet[]).push(o);
    r++;
    // Ligne des clés en colonnes (colonne A vide), puis une ligne par valeur de la clé en lignes.
    const entetes: { col: number; cle: string }[] = [];
    if (r <= ws.rowCount && !ligneVide(r)) {
      if (cles.length === 2) {
        for (let c = 2; c <= ws.columnCount && brute(r, c); c++) {
          const cle = lire.texte(cel(r, c), lec);
          if (cle !== undefined) entetes.push({ col: c, cle });
        }
      } else {
        entetes.push({ col: 2, cle: "" });
      }
      r++;
    } else {
      lec.erreur(adresse(nom, r - 1, 1), "GRILLE_ABSENTE", `la table « ${code ?? ""} » n'a pas de grille sous sa ligne TABLE`);
    }
    for (; r <= ws.rowCount && !ligneVide(r); r++) {
      const cleLigne = lire.texte(cel(r, 1), lec);
      if (cleLigne === undefined) {
        if (brute(r, 1)) continue;
        lec.erreur(adresse(nom, r, 1), "CASE_VIDE", `case vide : la clé en lignes est obligatoire dans la table ${code ?? ""}`);
        continue;
      }
      if (normaliser(cleLigne) === "table") break; // bloc suivant sans ligne vide entre les deux
      for (const e of entetes) {
        const c = cel(r, e.col);
        const cle = cles.length === 2 ? `${cleLigne}|${e.cle}` : cleLigne;
        if (!brute(r, e.col)) {
          lec.erreur(c.ref, "CASE_VIDE", `case vide dans la table ${code ?? "?"}`);
          continue;
        }
        if (cle in lignes) lec.erreur(c.ref, "CLE_EN_DOUBLE", `la ligne « ${cle} » est écrite deux fois dans la table ${code ?? "?"}`);
        const valeur = lire.decimal(c, lec);
        if (valeur !== undefined) lignes[cle] = valeur;
        lec.noter(`${base}.lignes.${cle}`, c);
      }
    }
  }
}

function lireSousJacents(ws: ExcelJS.Worksheet | undefined, lec: Lecture, doc: Objet) {
  doc.sousJacents = [];
  if (!ws) return;
  const t = lireTableau(ws, FEUILLE.sousJacents, lec, COLONNES_SOUS_JACENTS, ["code", "effet"]);
  for (const [i, l] of (t?.lignes ?? []).entries()) {
    const base = `sousJacents.${i}`;
    const o: Objet = {};
    poser(o, "code", lire.texte(l.cellule("code"), lec));
    const effet = lire.texte(l.cellule("effet"), lec);
    poser(o, "effet", effet);
    lec.noter(base, l.cellule("code"));
    lec.noter(`${base}.code`, l.cellule("code"));
    lec.noter(`${base}.effet`, l.cellule("effet"));
    const applicables = effet !== undefined ? APPLICABLE[effet] : undefined;
    for (const col of COLONNES_SOUS_JACENTS.filter((c) => !["code", "effet"].includes(c))) {
      if (applicables && !applicables.includes(col) && l.presente(col)) lec.erreur(l.cellule(col).ref, "COLONNE_NON_APPLICABLE", `la colonne « ${col} » ne s'applique pas à l'effet ${effet}`);
    }
    if (applicables?.includes("table")) {
      lec.noter(`${base}.table`, l.cellule("table"));
      poser(o, "table", lire.texte(l.cellule("table"), lec));
    }
    if (applicables?.includes("cibles")) {
      lec.noter(`${base}.cibles`, l.cellule("cibles"));
      const t2 = lire.texte(l.cellule("cibles"), lec);
      o.cibles = t2 === undefined ? [] : t2.split(/[;,]/).map((x) => x.trim()).filter((x) => x !== "");
    }
    if (effet === "E2" && l.presente("reduction")) {
      lec.noter(`${base}.reduction`, l.cellule("reduction"));
      poser(o, "reduction", lire.booleen(l.cellule("reduction"), lec));
    }
    if (effet === "E5") {
      lec.noter(`${base}.mode`, l.cellule("mode"));
      poser(o, "mode", lire.texte(l.cellule("mode"), lec));
    }
    if (effet === "E4") {
      lec.noter(`${base}.message`, l.cellule("message"));
      poser(o, "message", lire.texte(l.cellule("message"), lec));
      lec.noter(`${base}.quand`, l.cellule("quand_type"));
      const type = lire.texte(l.cellule("quand_type"), lec);
      const n = type === undefined ? "" : normaliser(type);
      const gauche = l.cellule("quand_gauche");
      const droite = l.cellule("quand_droite");
      if (n === "comparaison") {
        const g = lireExpression(gauche, lec);
        const d = lireExpression(droite, lec);
        const cmp = lire.texte(l.cellule("quand_comparateur"), lec);
        o.quand = [cmp, g, d];
        lec.noter(`${base}.quand.0`, l.cellule("quand_comparateur"));
        lec.noter(`${base}.quand.1`, gauche);
        lec.noter(`${base}.quand.2`, droite);
      } else if (n === "champ_egal" || n === "champ_different") {
        const champ = lire.texte(gauche, lec);
        const valeur = lire.texte(droite, lec);
        o.quand = { champ, [n === "champ_egal" ? "egal" : "different"]: valeur };
        lec.noter(`${base}.quand.champ`, gauche);
        lec.noter(`${base}.quand.egal`, droite);
        lec.noter(`${base}.quand.different`, droite);
      } else {
        lec.erreur(l.cellule("quand_type").v !== undefined ? l.cellule("quand_type").ref : l.cellule("code").ref, "CONDITION_INCONNUE", `type de contrôle « ${type ?? ""} » inconnu (COMPARAISON, CHAMP_EGAL ou CHAMP_DIFFERENT)`);
      }
    }
    if (typeof o.code === "string") lec.index.set(`sj:${o.code}`, l.cellule("code").ref);
    (doc.sousJacents as Objet[]).push(o);
  }
}

function lireEssais(ws: ExcelJS.Worksheet | undefined, lec: Lecture, doc: Objet) {
  doc.jeuxEssai = [];
  if (!ws) return;
  const t = lireTableau(ws, FEUILLE.essais, lec, COLONNES_ESSAIS, ["essai", "rubrique"]);
  const jeux = new Map<string, { o: Objet; k: number; lignes: number; souscrit: number }>();
  for (const l of t?.lignes ?? []) {
    const nom = lire.texte(l.cellule("essai"), lec);
    const rubrique = lire.texte(l.cellule("rubrique"), lec);
    if (nom === undefined || rubrique === undefined) {
      lec.erreur(nom === undefined ? l.cellule("essai").ref : l.cellule("rubrique").ref, "CASE_VIDE", "case vide : le nom de l'essai et la rubrique sont obligatoires");
      continue;
    }
    const rub = normaliser(rubrique);
    if (rub === "essai") {
      if (jeux.has(nom)) {
        lec.erreur(l.cellule("essai").ref, "ESSAI_EN_DOUBLE", `l'essai « ${nom} » est déclaré deux fois`);
        continue;
      }
      const k = (doc.jeuxEssai as Objet[]).length;
      const o: Objet = { nom, entrees: { champs: {}, souscrit: [] }, attendu: {} };
      (doc.jeuxEssai as Objet[]).push(o);
      jeux.set(nom, { o, k, lignes: 0, souscrit: 0 });
      lec.noter(`jeuxEssai.${k}`, l.cellule("essai"));
      lec.noter(`jeuxEssai.${k}.nom`, l.cellule("essai"));
      continue;
    }
    const jeu = jeux.get(nom);
    if (!jeu) {
      lec.erreur(l.cellule("essai").ref, "ESSAI_INCONNU", `l'essai « ${nom} » n'est pas déclaré : une ligne de rubrique ESSAI doit précéder ses lignes`);
      continue;
    }
    const entrees = jeu.o.entrees as { champs: Record<string, unknown>; souscrit: unknown[]; effectif?: number };
    const attendu = jeu.o.attendu as Objet;
    const base = `jeuxEssai.${jeu.k}`;
    const cle = lire.texte(l.cellule("cle"), lec);
    const valeur = l.cellule("valeur");
    const exigerCle = () => {
      if (cle === undefined) lec.erreur(l.cellule("cle").ref, "CASE_VIDE", `case vide : la colonne « cle » est obligatoire pour la rubrique ${rubrique}`);
      return cle;
    };
    if (rub === "champ") {
      const c = exigerCle();
      if (c === undefined) continue;
      lec.noter(`${base}.entrees.champs.${c}`, valeur);
      if (valeur.v === undefined) lec.erreur(valeur.ref, "CASE_VIDE", `case vide : la valeur du champ « ${c} » est obligatoire`);
      else if (typeof valeur.v === "boolean") entrees.champs[c] = valeur.v;
      else poser(entrees.champs, c, lire.texte(valeur, lec));
    } else if (rub === "choix") {
      const c = exigerCle();
      if (c === undefined) continue;
      lec.noter(`${base}.entrees.champs.${c}`, valeur);
      const texte = lire.texte(valeur, lec);
      entrees.champs[c] = texte === undefined ? [] : texte.split(";").map((x) => x.trim()).filter((x) => x !== "");
    } else if (rub === "souscrit") {
      lec.noter(`${base}.entrees.souscrit.${jeu.souscrit}`, valeur);
      jeu.souscrit++;
      const texte = lire.texte(valeur, lec);
      if (texte === undefined) lec.erreur(valeur.ref, "CASE_VIDE", "case vide : la garantie ou composante souscrite est obligatoire");
      else entrees.souscrit.push(texte);
    } else if (rub === "effectif") {
      lec.noter(`${base}.entrees.effectif`, valeur);
      poser(entrees as Objet, "effectif", lire.entier(valeur, lec));
    } else if (rub === "attendu_ttc") {
      lec.noter(`${base}.attendu.ttc`, valeur);
      poser(attendu, "ttc", lire.decimal(valeur, lec));
    } else if (rub === "attendu_refus") {
      lec.noter(`${base}.attendu.refus`, valeur);
      poser(attendu, "refus", lire.texte(valeur, lec));
    } else if (rub === "attendu_ligne") {
      const g = exigerCle();
      if (g === undefined) continue;
      const liste = (attendu.lignes ??= []) as Objet[];
      const chemin = `${base}.attendu.lignes.${jeu.lignes}`;
      jeu.lignes++;
      const o: Objet = { g };
      lec.noter(chemin, l.cellule("cle"));
      lec.noter(`${chemin}.g`, l.cellule("cle"));
      for (const col of ["nette", "acc", "taxe", "ttc"] as const) {
        lec.noter(`${chemin}.${col}`, l.cellule(col));
        poser(o, col, lire.decimal(l.cellule(col), lec));
      }
      liste.push(o);
    } else {
      lec.erreur(l.cellule("rubrique").ref, "RUBRIQUE_INCONNUE", `rubrique « ${rubrique} » inconnue (ESSAI, CHAMP, CHOIX, SOUSCRIT, EFFECTIF, ATTENDU_LIGNE, ATTENDU_TTC, ATTENDU_REFUS)`);
    }
  }
}

// ---------------------------------------------------------------- Validation du document lu

type IssueZod = { code: string; path: PropertyKey[]; message: string; values?: unknown[]; minimum?: unknown; keys?: string[]; expected?: string };

const valeurAu = (doc: unknown, chemin: PropertyKey[]): unknown => chemin.reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as Record<PropertyKey, unknown>)[k] : undefined), doc);
const montrer = (v: unknown): string => (typeof v === "string" ? `« ${v} »` : v === undefined ? "(vide)" : JSON.stringify(v));

/** Message en français d'une erreur du schéma zod, avec la valeur lue dans la cellule. */
function messageZod(i: IssueZod, doc: unknown): { regle: string; message: string } {
  const lu = valeurAu(doc, i.path);
  if (i.code === "invalid_value") return { regle: "VALEUR_NON_ADMISE", message: `valeur ${montrer(lu)} non admise${i.values ? ` (attendu : ${i.values.map(String).join(", ")})` : ""}` };
  if (i.code === "invalid_type") return lu === undefined ? { regle: "CASE_VIDE", message: "case vide : une valeur est obligatoire ici" } : { regle: "TYPE_INATTENDU", message: `valeur ${montrer(lu)} d'un type inattendu (${i.expected ?? "autre type"} attendu)` };
  if (i.code === "too_small") return { regle: "TROP_PETIT", message: lu === undefined || (Array.isArray(lu) && lu.length === 0) ? "au moins un élément est obligatoire ici" : `valeur ${montrer(lu)} trop courte ou trop petite` };
  if (i.code === "invalid_union") return { regle: "COMBINAISON_NON_RECONNUE", message: `valeur ${montrer(lu)} ou combinaison de colonnes non reconnue pour ce champ` };
  if (i.code === "unrecognized_keys") return { regle: "COLONNE_NON_APPLICABLE", message: `élément(s) non admis ici : ${(i.keys ?? []).join(", ")}` };
  return { regle: "VALEUR_INVALIDE", message: `${lu === undefined ? "" : `valeur ${montrer(lu)} : `}${i.message}` };
}

/** Cellule la plus proche d'un problème de `verifierBareme`, d'après les codes cités dans son message. */
function localiser(message: string, lec: Lecture): string {
  const cites = [...message.matchAll(/« ([a-z0-9_.→ ]+?) »/gi)].map((m) => m[1]);
  const deb = (re: RegExp, genre: string) => {
    const m = re.exec(message);
    return m ? lec.index.get(`${genre}:${m[1]}`) : undefined;
  };
  const composante = /^Garantie « (\w+) », composante « (\w+) »/.exec(message);
  if (composante) return lec.index.get(`composante:${composante[1]}.${composante[2]}`) ?? lec.index.get(`garantie:${composante[1]}`) ?? "(barème)";
  const direct = deb(/^Champ « (\w+) »/, "champ") ?? deb(/^Table « (\w+) »/, "table") ?? deb(/^Garantie « (\w+) »/, "garantie") ?? deb(/^Sous-jacent « (\w+) »/, "sj") ?? deb(/^Valeur intermédiaire « (\w+) »/, "inter");
  if (direct) return direct;
  const taux = /^La composante « (\w+\.\w+) »/.exec(message);
  if (taux) return lec.index.get(`composante:${taux[1]}`) ?? "(barème)";
  for (const c of cites) {
    const t = c.split(/ → /)[0];
    for (const genre of ["champ", "table", "garantie", "sj", "inter"]) {
      const ref = lec.index.get(`${genre}:${t}`);
      if (ref) return ref;
    }
  }
  if (message.includes("jeu d'essai")) return `${FEUILLE.essais}!A1`;
  return "(barème)";
}

export type ResultatLecture = { document: unknown; bareme?: Bareme; erreurs: ErreurCellule[] };

/**
 * Lit et valide un classeur de barème : contrôle de l'archive AVANT tout chargement (taille décompressée, nombre de parties : audit B2),
 * lecture des cellules, puis — s'il n'y a aucune erreur de cellule — schéma zod et `verifierBareme` (les mêmes que le service de
 * stockage), dont chaque message est rattaché à sa cellule. `bareme` n'est rendu que si tout est valide.
 */
export async function analyserClasseur(octets: Uint8Array): Promise<ResultatLecture> {
  if (octets.byteLength === 0) throw new ErreurMetier("Le fichier est vide.");
  if (octets.byteLength > TAILLE_MAX_CLASSEUR) throw new ErreurMetier(`Le fichier dépasse ${TAILLE_MAX_CLASSEUR / 1024 / 1024} Mo.`);
  const problemes = await problemesArchiveXlsx(octets);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const classeur = new ExcelJS.Workbook();
  try {
    await classeur.xlsx.load(Buffer.from(octets) as unknown as ArrayBuffer);
  } catch {
    throw new ErreurMetier("Fichier Excel illisible : enregistrez-le au format .xlsx (classeur Excel) et recommencez.");
  }
  const lec = new Lecture();
  const doc: Objet = {};
  lireParametres(trouverFeuille(classeur, FEUILLE.lisezmoi), lec, doc);
  lireBlocs(trouverFeuille(classeur, FEUILLE.blocs), lec, doc);
  lireChamps(classeur, lec, doc);
  lireIntermediaires(trouverFeuille(classeur, FEUILLE.intermediaires), lec, doc);
  lireGaranties(classeur, lec, doc);
  lireTables(trouverFeuille(classeur, FEUILLE.tables), lec, doc);
  lireSousJacents(trouverFeuille(classeur, FEUILLE.sousJacents), lec, doc);
  lireEssais(trouverFeuille(classeur, FEUILLE.essais), lec, doc);
  if (lec.erreurs.length > 0) return { document: doc, erreurs: lec.erreurs };

  const lu = schemaBareme.safeParse(doc);
  if (!lu.success) {
    const erreurs = lu.error.issues.map((i) => {
      const { regle, message } = messageZod(i as unknown as IssueZod, doc);
      return { ref: lec.origine.trouver(i.path.join(".")) ?? "(barème)", regle, message };
    });
    return { document: doc, erreurs };
  }
  const verif = verifierBareme(lu.data);
  if (verif.length > 0) return { document: doc, erreurs: verif.map((p) => ({ ref: localiser(p.message, lec), regle: p.code, message: p.message })) };
  return { document: doc, bareme: lu.data, erreurs: [] };
}
