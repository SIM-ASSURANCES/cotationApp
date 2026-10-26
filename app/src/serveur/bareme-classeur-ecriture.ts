import ExcelJS from "exceljs";

import { formaterOperande, formaterTranches, type Bareme, type Champ, type ConditionAffichage, type Garantie, type Operande } from "@/domaine/bareme";
import { COMPARATEURS, OPERATIONS, TYPES_CHAMP } from "@/domaine/bareme/schema";

import { ETIQUETTE, FEUILLE } from "./bareme-classeur-lecture";

/**
 * Écriture d'un barème en classeur Excel (B9, D50) : le modèle (SECURPRO inventé en exemple) et l'export d'un barème publié. Les
 * mêmes colonnes que la lecture ; les nombres décimaux exacts sont écrits en nombres, les autres (« 0.80 ») en texte, pour que la
 * relecture redonne exactement le même document, donc la même empreinte.
 */

const ENTETE = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A68" } } } as const;
const LIGNES_LISTES = 1000;

/** Décimal en cellule : un nombre quand son écriture est exacte, sinon le texte tel quel. */
const decimal = (t: string | undefined): string | number | undefined => {
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && String(n) === t ? n : t;
};
/** Cellule « montant » des accessoires : un décimal, ou, par tranche d'effectif, « 1-5: 2500; 6-10: 4000 ». */
const montantAccessoires = (acc: Bareme["produit"]["accessoires"]): string | number | undefined => (acc === undefined ? undefined : acc.mode === "PAR_TRANCHE" ? formaterTranches(acc.tranches) : decimal(acc.montant));
const ouiNon = (b: boolean | undefined): string | undefined => (b === undefined ? undefined : b ? "OUI" : "NON");

function feuilleAvecEntetes(classeur: ExcelJS.Workbook, nom: string, colonnes: readonly string[], largeurs: Record<string, number> = {}): ExcelJS.Worksheet {
  const ws = classeur.addWorksheet(nom);
  ws.columns = colonnes.map((c) => ({ header: c, key: c, width: largeurs[c] ?? Math.max(14, c.length + 4) }));
  ws.getRow(1).eachCell((cell) => Object.assign(cell, { font: ENTETE.font, fill: ENTETE.fill }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

/** Liste déroulante Excel sur une colonne (lignes 2 à 1000). */
function listeDeroulante(ws: ExcelJS.Worksheet, colonne: string, valeurs: readonly string[]) {
  const col = ws.getRow(1).values as unknown[];
  const numero = col.findIndex((v) => v === colonne);
  if (numero < 1) return;
  for (let ligne = 2; ligne <= LIGNES_LISTES; ligne++) {
    ws.getRow(ligne).getCell(numero).dataValidation = { type: "list", allowBlank: true, formulae: [`"${valeurs.join(",")}"`] };
  }
}

const condition = (si: ConditionAffichage | undefined): [string | undefined, string | undefined, string | undefined] => {
  if (!si) return [undefined, undefined, undefined];
  if ("souscrit" in si) return ["SOUSCRIT", si.souscrit, undefined];
  if ("egal" in si) return ["CHAMP_EGAL", si.champ, si.egal];
  return ["CHAMP_DIFFERENT", si.champ, si.different];
};

function ecrireChamps(classeur: ExcelJS.Workbook, b: Bareme) {
  const ws = feuilleAvecEntetes(classeur, FEUILLE.champs, ["code", "libelle", "aide", "type", "bloc", "obligatoire", "numerique", "min", "max", "si_type", "si_cible", "si_valeur", "sur_documents"], { aide: 30, libelle: 24 });
  for (const c of b.champs as Champ[]) {
    const [t, cible, valeur] = condition(c.si);
    ws.addRow({ code: c.code, libelle: c.libelle, aide: c.aide, type: c.type, bloc: c.bloc, obligatoire: ouiNon(c.obligatoire), numerique: ouiNon(c.numerique), min: decimal(c.min), max: decimal(c.max), si_type: t, si_cible: cible, si_valeur: valeur, sur_documents: ouiNon(c.surDocuments) });
  }
  listeDeroulante(ws, "type", TYPES_CHAMP);
  for (const col of ["obligatoire", "numerique", "sur_documents"]) listeDeroulante(ws, col, ["OUI", "NON"]);
  listeDeroulante(ws, "si_type", ["CHAMP_EGAL", "CHAMP_DIFFERENT", "SOUSCRIT"]);

  const attributs: string[] = [];
  for (const c of b.champs) for (const v of c.valeurs ?? []) if (typeof v !== "string") for (const k of Object.keys(v)) if (!["v", "l"].includes(k) && !attributs.includes(k)) attributs.push(k);
  const wv = feuilleAvecEntetes(classeur, FEUILLE.valeurs, ["champ", "v", "l", ...attributs], { l: 24 });
  for (const c of b.champs) {
    for (const v of c.valeurs ?? []) {
      if (typeof v === "string") wv.addRow({ champ: c.code, v: decimal(v) });
      else wv.addRow({ champ: c.code, v: decimal(v.v), l: v.l, ...Object.fromEntries(attributs.filter((a) => a in v).map((a) => [a, v[a]])) });
    }
  }
}

function ecrireGaranties(classeur: ExcelJS.Workbook, b: Bareme) {
  const wg = feuilleAvecEntetes(classeur, FEUILLE.garanties, ["code", "nom", "definition", "afficher_sur_documents", "souscription", "si_type", "si_cible", "si_valeur", "taxe", "accessoires_mode", "accessoires_montant"], { nom: 28, definition: 30 });
  const wc = feuilleAvecEntetes(classeur, FEUILLE.composantes, ["garantie", "code", "souscription", "assiette", "taux_unite", "taux_fixe", "taux_source", "minimum", "par_tete"], { assiette: 44 });
  for (const g of b.garanties as Garantie[]) {
    const [t, cible, valeur] = condition(g.si);
    wg.addRow({ code: g.code, nom: g.nom, definition: g.definition, afficher_sur_documents: ouiNon(g.afficherSurDocuments), souscription: g.souscription, si_type: t, si_cible: cible, si_valeur: valeur, taxe: g.taxe, accessoires_mode: g.accessoires?.mode, accessoires_montant: montantAccessoires(g.accessoires) });
    for (const c of g.composantes) {
      wc.addRow({
        garantie: g.code,
        code: c.code,
        souscription: c.souscription,
        assiette: formaterOperande(c.assiette),
        taux_unite: c.taux.unite,
        taux_fixe: "fixe" in c.taux ? decimal(c.taux.fixe) : undefined,
        taux_source: "source" in c.taux ? c.taux.source : undefined,
        minimum: decimal(c.minimum),
        par_tete: ouiNon(c.parTete),
      });
    }
  }
  listeDeroulante(wg, "souscription", ["OBLIGATOIRE", "OPTIONNELLE", "CONDITION"]);
  listeDeroulante(wg, "afficher_sur_documents", ["OUI", "NON"]);
  listeDeroulante(wg, "si_type", ["CHAMP_EGAL", "CHAMP_DIFFERENT", "SOUSCRIT"]);
  listeDeroulante(wg, "accessoires_mode", ["PAR_GARANTIE", "PAR_CONTRAT", "PAR_TETE", "PAR_TRANCHE"]);
  listeDeroulante(wc, "souscription", ["OBLIGATOIRE", "OPTIONNELLE"]);
  listeDeroulante(wc, "taux_unite", ["PERMILLE", "POURCENT"]);
  listeDeroulante(wc, "taux_source", ["E1"]);
  listeDeroulante(wc, "par_tete", ["OUI", "NON"]);
}

/** Tables : un bloc par table (TABLE | code | clé en lignes | clé en colonnes), puis la grille. */
function ecrireTables(classeur: ExcelJS.Workbook, b: Bareme) {
  const ws = classeur.addWorksheet(FEUILLE.tables);
  ws.getColumn(1).width = 22;
  let ligne = 1;
  for (const t of b.tables) {
    const entete = ws.getRow(ligne++);
    entete.values = ["TABLE", t.code, t.cles[0], t.cles[1]];
    entete.eachCell((cell) => Object.assign(cell, { font: ENTETE.font, fill: ENTETE.fill }));
    const cles = Object.keys(t.lignes).map((k) => k.split("|"));
    const lignes = [...new Set(cles.map((k) => k[0]))];
    if (t.cles.length === 2) {
      const colonnes = [...new Set(cles.map((k) => k[1]))];
      ws.getRow(ligne++).values = ["", ...colonnes];
      for (const l of lignes) ws.getRow(ligne++).values = [l, ...colonnes.map((c) => decimal(t.lignes[`${l}|${c}`]))];
    } else {
      ws.getRow(ligne++).values = ["", "valeur"];
      for (const l of lignes) ws.getRow(ligne++).values = [l, decimal(t.lignes[l])];
    }
    ligne++; // ligne vide entre deux tables
  }
}

function ecrireSousJacents(classeur: ExcelJS.Workbook, b: Bareme) {
  const ws = feuilleAvecEntetes(classeur, FEUILLE.sousJacents, ["code", "effet", "table", "cibles", "reduction", "mode", "quand_type", "quand_gauche", "quand_comparateur", "quand_droite", "message"], { cibles: 28, quand_gauche: 28, quand_droite: 28, message: 50 });
  for (const s of b.sousJacents) {
    if (s.effet === "E4") {
      const q = s.quand;
      if (Array.isArray(q)) ws.addRow({ code: s.code, effet: s.effet, quand_type: "COMPARAISON", quand_gauche: formaterOperande(q[1] as Operande), quand_comparateur: q[0], quand_droite: formaterOperande(q[2] as Operande), message: s.message });
      else ws.addRow({ code: s.code, effet: s.effet, quand_type: "egal" in q ? "CHAMP_EGAL" : "CHAMP_DIFFERENT", quand_gauche: q.champ, quand_droite: "egal" in q ? q.egal : q.different, message: s.message });
    } else {
      ws.addRow({ code: s.code, effet: s.effet, table: s.table, cibles: s.cibles.join("; "), reduction: s.effet === "E2" ? ouiNon(s.reduction) : undefined, mode: s.effet === "E5" ? s.mode : undefined });
    }
  }
  listeDeroulante(ws, "effet", ["E1", "E2", "E4", "E5"]);
  listeDeroulante(ws, "reduction", ["OUI", "NON"]);
  listeDeroulante(ws, "mode", ["MINIMUM", "PLAFOND", "AJOUT"]);
  listeDeroulante(ws, "quand_type", ["COMPARAISON", "CHAMP_EGAL", "CHAMP_DIFFERENT"]);
  listeDeroulante(ws, "quand_comparateur", COMPARATEURS);
}

function ecrireEssais(classeur: ExcelJS.Workbook, b: Bareme) {
  const ws = feuilleAvecEntetes(classeur, FEUILLE.essais, ["essai", "rubrique", "cle", "valeur", "nette", "acc", "taxe", "ttc"], { essai: 40, rubrique: 16, cle: 24, valeur: 30 });
  for (const j of b.jeuxEssai) {
    ws.addRow({ essai: j.nom, rubrique: "ESSAI" });
    for (const [cle, valeur] of Object.entries(j.entrees.champs)) {
      if (Array.isArray(valeur)) ws.addRow({ essai: j.nom, rubrique: "CHOIX", cle, valeur: valeur.join("; ") });
      else ws.addRow({ essai: j.nom, rubrique: "CHAMP", cle, valeur: typeof valeur === "boolean" ? valeur : decimal(valeur) });
    }
    for (const s of j.entrees.souscrit) ws.addRow({ essai: j.nom, rubrique: "SOUSCRIT", valeur: s });
    if (j.entrees.effectif !== undefined) ws.addRow({ essai: j.nom, rubrique: "EFFECTIF", valeur: j.entrees.effectif });
    for (const l of j.attendu.lignes ?? []) ws.addRow({ essai: j.nom, rubrique: "ATTENDU_LIGNE", cle: l.g, nette: decimal(l.nette), acc: decimal(l.acc), taxe: decimal(l.taxe), ttc: decimal(l.ttc) });
    if (j.attendu.ttc !== undefined) ws.addRow({ essai: j.nom, rubrique: "ATTENDU_TTC", valeur: decimal(j.attendu.ttc) });
    if (j.attendu.refus !== undefined) ws.addRow({ essai: j.nom, rubrique: "ATTENDU_REFUS", valeur: j.attendu.refus });
  }
  listeDeroulante(ws, "rubrique", ["ESSAI", "CHAMP", "CHOIX", "SOUSCRIT", "EFFECTIF", "ATTENDU_LIGNE", "ATTENDU_TTC", "ATTENDU_REFUS"]);
}

const AIDE = [
  "Ce classeur décrit le barème d'une version de produit. Il se remplit, se dépose sur la fiche du produit (« Importer »), et devient un BROUILLON.",
  "Rien n'est enregistré si une seule erreur est trouvée : chaque erreur est nommée par feuille, cellule et règle. Un brouillon se publie ensuite, après rejeu des jeux d'essai.",
  "",
  "Règles communes",
  "• Codes : minuscules, chiffres et _, commençant par une lettre (ex. type_commerce). Catégories de taxe : majuscules (ex. IARD).",
  "• Nombres décimaux : avec un point (0.864) ou une virgule ; jamais de signe, d'espace ni de notation scientifique. Une table exige TOUTES ses cases.",
  "• Seules les valeurs sont lues : une cellule de FORMULE est refusée. Les listes déroulantes proposent les types, effets et unités admis.",
  "• Taille maximale : 5 Mo. Les feuilles Lisez-moi, Champs, Garanties et Composantes sont obligatoires ; les autres, vides si inutiles.",
  "",
  "Feuilles",
  "• Blocs : regroupements d'affichage des champs (code, libelle).",
  "• Champs : une ligne par champ saisi par le Commercial (type, bloc, obligatoire, bornes min/max, condition d'affichage si_type / si_cible / si_valeur).",
  "• Valeurs : les valeurs des champs LISTE (champ, v, l = libellé) ; toute colonne ajoutée (ex. classe) est un attribut tarifaire de la valeur.",
  "• Intermediaires : valeurs calculées nommées (code, expression).",
  "• Accessoires (produit, dans ce Lisez-moi, ou garantie) : PAR_GARANTIE, PAR_CONTRAT, PAR_TETE ou PAR_TRANCHE. En PAR_TRANCHE le montant dépend de l'effectif assuré : écrivez « 1-5: 2500; 6-10: 4000 » (tranches bornées, à partir de 1, sans trou ni chevauchement).",
  "• Garanties : une ligne par garantie ; Composantes : une ligne par composante (garantie = code de la garantie). Un taux est fixe (taux_fixe) OU tiré d'un sous-jacent E1 (taux_source = E1).",
  "• Tables : un bloc par table — ligne « TABLE | code | clé en lignes | clé en colonnes », puis la grille (clés en colonnes sur la 1re ligne, clés en lignes dans la colonne A).",
  "• SousJacents : effets E1 (taux), E2 (coefficient ou réduction en %), E4 (contrôle qui refuse, avec son message), E5 (minimum, plafond, ajout).",
  "• Essais : une ligne ESSAI par jeu, puis ses lignes CHAMP, CHOIX (valeurs séparées par ;), SOUSCRIT, EFFECTIF, ATTENDU_LIGNE, ATTENDU_TTC ou ATTENDU_REFUS.",
  "",
  `Expressions (assiettes, valeurs intermédiaires, contrôles) : un champ ou une valeur intermédiaire (loyer_mensuel), un nombre (120), un texte entre guillemets, ou une opération ${OPERATIONS.join(", ")} avec ses arguments séparés par ; — par exemple PREMIER(FOIS(loyer_mensuel; 120); valeur_batiment) ou TABLE(limites).`,
];

export type OptionsClasseur = {
  /** Texte d'introduction (produit, version). */
  titre: string;
  /** Exemple : le classeur est le modèle (SECURPRO inventé), à adapter. */
  modele?: boolean;
  /** Barème publié exporté : son empreinte, écrite dans le Lisez-moi. */
  empreinte?: string;
};

/** Classeur d'un barème : Lisez-moi (paramètres du produit, empreinte, aide), puis une feuille par famille. */
export async function construireClasseur(b: Bareme, options: OptionsClasseur): Promise<Uint8Array> {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = "SIM Documents";
  const lm = classeur.addWorksheet(FEUILLE.lisezmoi);
  lm.getColumn(1).width = 42;
  lm.getColumn(2).width = 80;
  lm.addRow([options.titre]).font = { bold: true, size: 13 };
  if (options.modele) lm.addRow(["MODÈLE : l'exemple contenu dans ce classeur (SECURPRO) est INVENTÉ ; remplacez-le par le barème du produit."]);
  lm.addRow([]);
  for (const [etiquette, valeur] of [
    [ETIQUETTE.schema, 1],
    [ETIQUETTE.taxe, b.produit.taxe],
    [ETIQUETTE.accessoiresMode, b.produit.accessoires?.mode],
    [ETIQUETTE.accessoiresMontant, montantAccessoires(b.produit.accessoires)],
    ...(options.empreinte ? [[ETIQUETTE.empreinte, options.empreinte] as const] : []),
  ] as const) {
    const r = lm.addRow([etiquette, valeur]);
    r.getCell(1).font = { bold: true };
  }
  lm.addRow([]);
  for (const ligne of AIDE) {
    const r = lm.addRow([ligne]);
    if (["Règles communes", "Feuilles"].includes(ligne)) r.font = { bold: true };
  }
  for (let i = 1; i <= lm.rowCount; i++) lm.getRow(i).getCell(1).alignment = { wrapText: false, vertical: "top" };

  const wb = feuilleAvecEntetes(classeur, FEUILLE.blocs, ["code", "libelle"], { libelle: 30 });
  for (const x of b.blocs) wb.addRow(x);
  ecrireChamps(classeur, b);
  const wi = feuilleAvecEntetes(classeur, FEUILLE.intermediaires, ["code", "expression"], { expression: 60 });
  for (const i of b.intermediaires) wi.addRow({ code: i.code, expression: formaterOperande(i.op) });
  ecrireGaranties(classeur, b);
  ecrireTables(classeur, b);
  ecrireSousJacents(classeur, b);
  ecrireEssais(classeur, b);
  return new Uint8Array(await classeur.xlsx.writeBuffer());
}
