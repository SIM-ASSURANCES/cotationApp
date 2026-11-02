import { codeValeur } from "./contexte";

export { codeValeur };
import { DECIMAL, type Bareme, type Champ, type ConditionAffichage, type Garantie, type Operande } from "./schema";

/**
 * Édition d'un barème à l'écran (session B4, D58). Fonctions PURES sur le MÊME document que l'import : rien ici ne valide à la place
 * du schéma zod et de `verifierBareme` (une seule vérité) ; ce module ne fait que construire des documents, proposer des codes et
 * refuser en NOMMANT qui lit encore un élément qu'on supprime ou renomme.
 */

export type Resultat = { ok: true; bareme: Bareme } | { ok: false; refus: string[] };
const ok = (bareme: Bareme): Resultat => ({ ok: true, bareme });
const refus = (...messages: string[]): Resultat => ({ ok: false, refus: messages });

export const PROFONDEUR_MAX = 2;
export const MESSAGE_PROFONDEUR = `Trop d'opérations imbriquées (${PROFONDEUR_MAX} au plus) : nommez une valeur intermédiaire pour le calcul intermédiaire, puis utilisez-la ici.`;

// ---------------------------------------------------------------- Codes

const CODE_VALIDE = /^[a-z][a-z0-9_]{0,39}$/;
export const codeValide = (code: string): boolean => CODE_VALIDE.test(code);

/**
 * Code proposé depuis un libellé : minuscules, sans accent, tirets bas (« Type de commerce » → `type_de_commerce`). Commence toujours
 * par une lettre, 40 caractères au plus, unique parmi `pris` (suffixe `_2`, `_3`…).
 */
export function proposerCode(libelle: string, pris: Iterable<string> = [], repli = "element"): string {
  const base = libelle
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const net = base === "" ? repli : /^[a-z]/.test(base) ? base : `c_${base}`;
  const deja = new Set(pris);
  const tronque = (texte: string, reserve = 0) => texte.slice(0, 40 - reserve).replace(/_+$/, "");
  if (!deja.has(tronque(net))) return tronque(net);
  for (let n = 2; ; n++) {
    const suffixe = `_${n}`;
    const candidat = `${tronque(net, suffixe.length)}${suffixe}`;
    if (!deja.has(candidat)) return candidat;
  }
}

/** Tous les codes déjà pris dans l'espace des champs et des valeurs intermédiaires (un seul espace de noms, `CODE_EN_DOUBLE`). */
export const codesChampsEtIntermediaires = (b: Bareme): string[] => [...b.champs.map((c) => c.code), ...b.intermediaires.map((i) => i.code)];

// ---------------------------------------------------------------- Opérandes

export type GenreOperande = "CHAMP" | "INTERMEDIAIRE" | "CONSTANTE" | "SOMME" | "FOIS" | "PCT_PLAFOND" | "TABLE" | "PREMIER";

export const GENRES_OPERATION = ["SOMME", "FOIS", "PCT_PLAFOND", "TABLE", "PREMIER"] as const satisfies readonly GenreOperande[];

/** Les 7 façons de donner un montant (propositions-bareme.md §6) : libellés montrés à la Technique, sans syntaxe à taper. */
export const LIBELLE_GENRE: Record<GenreOperande, string> = {
  CHAMP: "Un champ du formulaire",
  INTERMEDIAIRE: "Une valeur intermédiaire",
  CONSTANTE: "Un nombre fixe",
  SOMME: "La somme de",
  FOIS: "Le produit de deux valeurs",
  PCT_PLAFOND: "Un pourcentage, plafonné",
  TABLE: "Une valeur lue dans une table",
  PREMIER: "La première valeur renseignée parmi",
};

/** Nombre d'opérandes permis et libellé de chaque emplacement, par opération (même arité que `verifierBareme`). */
export const FORME_OPERATION: Record<(typeof GENRES_OPERATION)[number], { min: number; max: number; emplacements: string[] }> = {
  SOMME: { min: 1, max: 99, emplacements: [] },
  FOIS: { min: 2, max: 2, emplacements: ["Valeur", "Multiplié par"] },
  PCT_PLAFOND: { min: 3, max: 3, emplacements: ["Valeur de base", "Pourcentage (%)", "Plafond"] },
  TABLE: { min: 1, max: 1, emplacements: ["Table"] },
  PREMIER: { min: 1, max: 99, emplacements: [] },
};

export const estOperation = (op: Operande): op is Operande[] => Array.isArray(op);

/** Profondeur d'imbrication comme `verifierBareme` : une opération sans opération dedans vaut 1, `TABLE` vaut 1 (jamais de fils). */
export function profondeur(op: Operande): number {
  if (!Array.isArray(op)) return 0;
  const [tete, ...args] = op;
  if (tete === "TABLE") return 1;
  return 1 + Math.max(0, ...args.map(profondeur));
}

/** Une opération peut-elle prendre place à ce niveau (0 = la racine, 1 = dans une opération de la racine…) sans dépasser 2 ? */
export const peutPlacerOperation = (niveau: number): boolean => niveau + 1 <= PROFONDEUR_MAX;

/** Noms (champs ou valeurs intermédiaires) lus par une assiette. Le premier argument de `TABLE` est une table, pas un champ. */
export function feuilles(op: Operande): string[] {
  if (typeof op === "string") return DECIMAL.test(op) ? [] : [op];
  if (!Array.isArray(op)) return [];
  const [tete, ...args] = op;
  if (tete === "TABLE") return [];
  return args.flatMap(feuilles);
}

/** Tables lues par une assiette. */
export function tablesLues(op: Operande): string[] {
  if (!Array.isArray(op)) return [];
  const [tete, ...args] = op;
  if (tete === "TABLE") return typeof args[0] === "string" ? [args[0]] : [];
  return args.flatMap(tablesLues);
}

export const estNumerique = (c: Champ): boolean => c.type === "MONTANT" || c.type === "NOMBRE" || (c.type === "LISTE" && c.numerique === true);

/** Genre d'un opérande, tel que l'écran l'affiche. `null` : opérande que l'écran ne sait pas lire (reste visible, jamais effacé). */
export function genreDe(op: Operande, b: Bareme): GenreOperande | null {
  if (typeof op === "string") {
    if (DECIMAL.test(op)) return "CONSTANTE";
    if (b.intermediaires.some((i) => i.code === op)) return "INTERMEDIAIRE";
    return "CHAMP";
  }
  if (!Array.isArray(op)) return "CONSTANTE";
  const tete = op[0];
  return (GENRES_OPERATION as readonly unknown[]).includes(tete) ? (tete as GenreOperande) : null;
}

/** Texte d'une constante (`"120"` ou `{ k: "120" }`). */
export const texteConstante = (op: Operande): string => (typeof op === "string" ? op : !Array.isArray(op) ? op.k : "");

/** Opérande neuf d'un genre donné, toujours lisible par le schéma. Les champs et valeurs proposés sont ceux que l'appelant autorise. */
export function operandeNouveau(genre: GenreOperande, options: { champs?: string[]; intermediaires?: string[]; tables?: string[] } = {}): Operande {
  switch (genre) {
    case "CHAMP":
      return options.champs?.[0] ?? "0";
    case "INTERMEDIAIRE":
      return options.intermediaires?.[0] ?? "0";
    case "CONSTANTE":
      return "0";
    case "SOMME":
      return ["SOMME", "0", "0"];
    case "FOIS":
      return ["FOIS", "0", "1"];
    case "PCT_PLAFOND":
      return ["PCT_PLAFOND", "0", "0", "0"];
    case "TABLE":
      return ["TABLE", options.tables?.[0] ?? ""];
    case "PREMIER":
      return ["PREMIER", "0", "0"];
  }
}

/** Passe un opérande à un autre genre ; entre deux opérations, les opérandes en commun sont gardés (complétés par « 0 », coupés au maximum). */
export function changerGenre(op: Operande, genre: GenreOperande, options: Parameters<typeof operandeNouveau>[1] = {}): Operande {
  const neuf = operandeNouveau(genre, options);
  if (!Array.isArray(op) || !Array.isArray(neuf) || genre === "TABLE" || op[0] === "TABLE") return neuf;
  const forme = FORME_OPERATION[genre as keyof typeof FORME_OPERATION];
  const gardes = op.slice(1).slice(0, forme.max);
  while (gardes.length < Math.max(forme.min, 2)) gardes.push(genre === "FOIS" ? "1" : "0");
  return [genre, ...gardes];
}

/** Opérande à un chemin (suite d'indices de `args`, 0 = premier opérande). */
export function operandeA(op: Operande, chemin: number[]): Operande | undefined {
  let courant: Operande | undefined = op;
  for (const i of chemin) {
    if (!Array.isArray(courant)) return undefined;
    courant = courant[i + 1];
  }
  return courant;
}

/** Remplace l'opérande d'un chemin. Refuse si l'assiette dépasse la profondeur permise (message clair, rien n'est modifié). */
export function remplacerOperande(op: Operande, chemin: number[], nouveau: Operande): { ok: true; op: Operande } | { ok: false; refus: string } {
  const remplace = (courant: Operande, reste: number[]): Operande => {
    if (reste.length === 0) return nouveau;
    if (!Array.isArray(courant)) return courant;
    const [i, ...suite] = reste;
    return courant.map((x, k) => (k === i + 1 ? remplace(x, suite) : x));
  };
  const resultat = remplace(op, chemin);
  return profondeur(resultat) > PROFONDEUR_MAX ? { ok: false, refus: MESSAGE_PROFONDEUR } : { ok: true, op: resultat };
}

/** Ajoute un opérande (« 0 ») à une opération à nombre variable (SOMME, PREMIER) ; retire le dernier ; refuse sous le minimum. */
export function ajouterOperande(op: Operande, chemin: number[]): Operande {
  const cible = operandeA(op, chemin);
  if (!Array.isArray(cible) || !["SOMME", "PREMIER"].includes(String(cible[0]))) return op;
  const r = remplacerOperande(op, chemin, [...cible, "0"]);
  return r.ok ? r.op : op;
}

export function retirerOperande(op: Operande, chemin: number[], indice: number): Operande {
  const cible = operandeA(op, chemin);
  if (!Array.isArray(cible) || !["SOMME", "PREMIER"].includes(String(cible[0])) || cible.length - 1 <= 1) return op;
  const r = remplacerOperande(op, chemin, cible.filter((_, k) => k !== indice + 1));
  return r.ok ? r.op : op;
}

// ---------------------------------------------------------------- Conditions d'affichage

/** Valeurs qu'une condition peut comparer : une liste ou un oui/non (jamais un texte libre). */
export function valeursPourCondition(c: Champ): { code: string; libelle: string }[] {
  if (c.type === "OUI_NON") return [{ code: "OUI", libelle: "Oui" }, { code: "NON", libelle: "Non" }];
  if (c.type !== "LISTE") return [];
  return (c.valeurs ?? []).map((v) => ({ code: codeValeur(v), libelle: typeof v === "string" ? v : (v.l ?? v.v) }));
}

export const champsPourCondition = (b: Bareme, sauf?: string): Champ[] => b.champs.filter((c) => c.code !== sauf && (c.type === "LISTE" || c.type === "OUI_NON"));

/** Condition par défaut sur un champ : « égal à » sa première valeur. */
export function conditionParDefaut(b: Bareme, sauf?: string): ConditionAffichage | undefined {
  const c = champsPourCondition(b, sauf)[0];
  const valeur = c ? valeursPourCondition(c)[0]?.code : undefined;
  return c && valeur !== undefined ? { champ: c.code, egal: valeur } : undefined;
}

// ---------------------------------------------------------------- Qui lit quoi

const decrit = {
  champ: (c: string) => `le champ « ${c} » (condition d'affichage)`,
  garantieCondition: (g: string) => `la garantie « ${g} » (condition « selon une condition »)`,
  intermediaire: (i: string) => `la valeur intermédiaire « ${i} »`,
  composante: (g: string, c: string) => `la composante « ${g}.${c} » (assiette)`,
  table: (t: string) => `la table « ${t} » (clé de lecture)`,
  sousJacent: (s: string) => `le sous-jacent « ${s} »`,
  essai: (n: string) => `le jeu d'essai « ${n} »`,
};

type Si = ConditionAffichage | undefined;
const litChamp = (si: Si, code: string, valeur?: string): boolean => {
  if (!si || "souscrit" in si) return false;
  if (si.champ !== code) return false;
  if (valeur === undefined) return true;
  return ("egal" in si ? si.egal : si.different) === valeur;
};
const litSouscription = (si: Si, ref: string): boolean => !!si && "souscrit" in si && (si.souscrit === ref || (!ref.includes(".") && si.souscrit.startsWith(`${ref}.`)));
const lectureOperandesE4 = (s: Bareme["sousJacents"][number]): Operande[] => (s.effet === "E4" && Array.isArray(s.quand) ? [s.quand[1], s.quand[2]] : []);

/** Ce qui lit un champ (ou l'une de ses valeurs si `valeur` est donné). Liste vide : on peut le supprimer. */
export function lecteursDuChamp(b: Bareme, code: string, valeur?: string): string[] {
  const l: string[] = [];
  for (const c of b.champs) if (c.code !== code && litChamp(c.si, code, valeur)) l.push(decrit.champ(c.code));
  for (const g of b.garanties) if (litChamp(g.si, code, valeur)) l.push(decrit.garantieCondition(g.code));
  if (valeur === undefined) {
    for (const i of b.intermediaires) if (feuilles(i.op).includes(code)) l.push(decrit.intermediaire(i.code));
    for (const g of b.garanties) for (const c of g.composantes) if (feuilles(c.assiette).includes(code)) l.push(decrit.composante(g.code, c.code));
  }
  for (const t of b.tables) if (t.cles.some((k) => k.split(".")[0] === code && (valeur === undefined || !k.includes(".")))) l.push(decrit.table(t.code));
  for (const s of b.sousJacents) {
    if (s.effet !== "E4") continue;
    if (!Array.isArray(s.quand)) {
      if (litChamp(s.quand as Si, code, valeur)) l.push(decrit.sousJacent(s.code));
    } else if (valeur === undefined && lectureOperandesE4(s).some((o) => feuilles(o).includes(code))) l.push(decrit.sousJacent(s.code));
  }
  for (const e of b.jeuxEssai) {
    const v = e.entrees.champs[code];
    if (v !== undefined && (valeur === undefined || v === valeur || (Array.isArray(v) && v.includes(valeur)))) l.push(decrit.essai(e.nom));
  }
  return l;
}

export function lecteursDeIntermediaire(b: Bareme, code: string): string[] {
  const l: string[] = [];
  for (const i of b.intermediaires) if (i.code !== code && feuilles(i.op).includes(code)) l.push(decrit.intermediaire(i.code));
  for (const g of b.garanties) for (const c of g.composantes) if (feuilles(c.assiette).includes(code)) l.push(decrit.composante(g.code, c.code));
  for (const s of b.sousJacents) if (lectureOperandesE4(s).some((o) => feuilles(o).includes(code))) l.push(decrit.sousJacent(s.code));
  return l;
}

/** Ce qui lit une garantie (`vol`) ou une composante (`vol.caisse`). */
export function lecteursDeSouscription(b: Bareme, ref: string): string[] {
  const l: string[] = [];
  for (const c of b.champs) if (litSouscription(c.si, ref)) l.push(`le champ « ${c.code} » (condition d'affichage)`);
  for (const g of b.garanties) if (litSouscription(g.si, ref)) l.push(decrit.garantieCondition(g.code));
  for (const s of b.sousJacents) {
    if (s.effet === "E4") {
      if (!Array.isArray(s.quand) && litSouscription(s.quand as Si, ref)) l.push(decrit.sousJacent(s.code));
    } else if (s.cibles.some((c) => c === ref || (!ref.includes(".") && c.startsWith(`${ref}.`)))) l.push(decrit.sousJacent(s.code));
  }
  for (const e of b.jeuxEssai) {
    const souscrit = e.entrees.souscrit.some((s) => s === ref || (!ref.includes(".") && s.startsWith(`${ref}.`)));
    // Une ligne attendue porte le code d'une garantie : la supprimer ou la renommer ferait échouer l'essai.
    const attendue = !ref.includes(".") && (e.attendu.lignes ?? []).some((x) => x.g === ref);
    if (souscrit || attendue) l.push(decrit.essai(e.nom));
  }
  return l;
}

export function lecteursDuBloc(b: Bareme, code: string): string[] {
  return b.champs.filter((c) => c.bloc === code).map((c) => `le champ « ${c.code} » (rangé dans ce bloc)`);
}

// ---------------------------------------------------------------- Suppressions et renommages

function refusSiLu(genre: string, code: string, lecteurs: string[]): Resultat | null {
  if (lecteurs.length === 0) return null;
  return refus(`Suppression refusée : ${genre} « ${code} » est lu par ${lecteurs.join(", ")}. Modifiez ou supprimez d'abord ce qui le lit.`);
}

export function supprimerChamp(b: Bareme, code: string): Resultat {
  return refusSiLu("le champ", code, lecteursDuChamp(b, code)) ?? ok({ ...b, champs: b.champs.filter((c) => c.code !== code) });
}

export function supprimerIntermediaire(b: Bareme, code: string): Resultat {
  return refusSiLu("la valeur intermédiaire", code, lecteursDeIntermediaire(b, code)) ?? ok({ ...b, intermediaires: b.intermediaires.filter((i) => i.code !== code) });
}

export function supprimerGarantie(b: Bareme, code: string): Resultat {
  if (b.garanties.length <= 1) return refus("Suppression refusée : un barème a au moins une garantie.");
  return refusSiLu("la garantie", code, lecteursDeSouscription(b, code)) ?? ok({ ...b, garanties: b.garanties.filter((g) => g.code !== code) });
}

export function supprimerComposante(b: Bareme, codeGarantie: string, code: string): Resultat {
  const g = b.garanties.find((x) => x.code === codeGarantie);
  if (!g) return refus(`La garantie « ${codeGarantie} » n'existe pas.`);
  if (g.composantes.length <= 1) return refus(`Suppression refusée : la garantie « ${codeGarantie} » a au moins une composante.`);
  return (
    refusSiLu("la composante", `${codeGarantie}.${code}`, lecteursDeSouscription(b, `${codeGarantie}.${code}`)) ??
    ok({ ...b, garanties: b.garanties.map((x) => (x.code === codeGarantie ? { ...x, composantes: x.composantes.filter((c) => c.code !== code) } : x)) })
  );
}

export function supprimerBloc(b: Bareme, code: string): Resultat {
  return refusSiLu("le bloc", code, lecteursDuBloc(b, code)) ?? ok({ ...b, blocs: b.blocs.filter((x) => x.code !== code) });
}

/** Supprime une valeur d'une liste, sauf si une condition, une table ou un essai la nomme. */
export function supprimerValeur(b: Bareme, codeChamp: string, valeur: string): Resultat {
  const refuse = refusSiLu(`la valeur « ${valeur} » du champ`, codeChamp, lecteursDuChamp(b, codeChamp, valeur));
  if (refuse) return refuse;
  return ok({ ...b, champs: b.champs.map((c) => (c.code === codeChamp ? { ...c, valeurs: (c.valeurs ?? []).filter((v) => codeValeur(v) !== valeur) } : c)) });
}

/**
 * Renomme le code d'un champ. Refusé s'il a déjà été publié (`figes` : `risque.<code>` est lu par des documents et des cotations), si le
 * nouveau code est invalide ou pris, ou si quelque chose le lit encore (on nomme ce qui le lit).
 */
export function renommerChamp(b: Bareme, ancien: string, nouveau: string, figes: ReadonlySet<string>): Resultat {
  return renommer(b, "champ", ancien, nouveau, figes, lecteursDuChamp(b, ancien), (code) => ({ ...b, champs: b.champs.map((c) => (c.code === ancien ? { ...c, code } : c)) }));
}

export function renommerIntermediaire(b: Bareme, ancien: string, nouveau: string, figes: ReadonlySet<string>): Resultat {
  return renommer(b, "valeur intermédiaire", ancien, nouveau, figes, lecteursDeIntermediaire(b, ancien), (code) => ({ ...b, intermediaires: b.intermediaires.map((i) => (i.code === ancien ? { ...i, code } : i)) }));
}

export function renommerGarantie(b: Bareme, ancien: string, nouveau: string): Resultat {
  return renommer(b, "garantie", ancien, nouveau, new Set(), lecteursDeSouscription(b, ancien), (code) => ({ ...b, garanties: b.garanties.map((g) => (g.code === ancien ? { ...g, code } : g)) }), b.garanties.map((g) => g.code));
}

export function renommerComposante(b: Bareme, codeGarantie: string, ancien: string, nouveau: string): Resultat {
  const g = b.garanties.find((x) => x.code === codeGarantie);
  return renommer(
    b,
    "composante",
    ancien,
    nouveau,
    new Set(),
    lecteursDeSouscription(b, `${codeGarantie}.${ancien}`),
    (code) => ({ ...b, garanties: b.garanties.map((x) => (x.code === codeGarantie ? { ...x, composantes: x.composantes.map((c) => (c.code === ancien ? { ...c, code } : c)) } : x)) }),
    (g?.composantes ?? []).map((c) => c.code),
  );
}

function renommer(b: Bareme, genre: string, ancien: string, nouveau: string, figes: ReadonlySet<string>, lecteurs: string[], appliquer: (code: string) => Bareme, pris?: string[]): Resultat {
  if (nouveau === ancien) return ok(b);
  if (!codeValide(nouveau)) return refus("Code : minuscules, chiffres et _, commence par une lettre (40 caractères au plus).");
  if (figes.has(ancien)) return refus(`Le code « ${ancien} » ne peut plus changer : ce ${genre} figure dans un barème publié (ses balises et ses cotations le citent).`);
  if ((pris ?? codesChampsEtIntermediaires(b)).includes(nouveau)) return refus(`Le code « ${nouveau} » est déjà utilisé.`);
  if (lecteurs.length > 0) return refus(`Changement de code refusé : ${genre} « ${ancien} » est lu par ${lecteurs.join(", ")}.`);
  return ok(appliquer(nouveau));
}

// ---------------------------------------------------------------- Listes

/** Déplace l'élément d'un indice vers le haut (`-1`) ou le bas (`1`). Hors limites : liste inchangée. */
export function deplacer<T>(liste: T[], indice: number, sens: -1 | 1): T[] {
  const cible = indice + sens;
  if (indice < 0 || indice >= liste.length || cible < 0 || cible >= liste.length) return liste;
  const copie = [...liste];
  [copie[indice], copie[cible]] = [copie[cible], copie[indice]];
  return copie;
}

// ---------------------------------------------------------------- Documents neufs

/**
 * Barème « vide » : le schéma exige au moins une garantie à une composante, le document vide en porte donc une, sans montant
 * (assiette 0, taux 0). Elle se renomme ou se remplace à l'écran. La catégorie de taxe du produit est celle du produit.
 */
export function baremeVide(taxe: string): Bareme {
  return {
    schema: 1,
    produit: { taxe },
    blocs: [],
    champs: [],
    intermediaires: [],
    tables: [],
    sousJacents: [],
    garanties: [garantieNeuve("garantie_1", "Nouvelle garantie")],
    jeuxEssai: [],
  };
}

export function garantieNeuve(code: string, nom: string): Garantie {
  return { code, nom, souscription: "OBLIGATOIRE", composantes: [{ code: "prime", assiette: "0", taux: { unite: "POURCENT", fixe: "0" } }] };
}

export function champNeuf(code: string, libelle: string, type: Champ["type"] = "TEXTE"): Champ {
  return { code, libelle, type, obligatoire: true, ...(type === "LISTE" || type === "CHOIX_MULTIPLES" ? { valeurs: [] } : {}) };
}

/** Résumé court pour le journal (avant / après) : de quoi lire ce qui a changé sans recopier le barème. */
export function resumeBareme(b: Bareme): { champs: number; intermediaires: number; garanties: number; composantes: number; tables: number; sousJacents: number; jeuxEssai: number } {
  return {
    champs: b.champs.length,
    intermediaires: b.intermediaires.length,
    garanties: b.garanties.length,
    composantes: b.garanties.reduce((n, g) => n + g.composantes.length, 0),
    tables: b.tables.length,
    sousJacents: b.sousJacents.length,
    jeuxEssai: b.jeuxEssai.length,
  };
}

// ---------------------------------------------------------------- Valeurs de liste et attributs tarifaires

type ValeurListe = NonNullable<Champ["valeurs"]>[number];

/** Noms des attributs tarifaires d'un champ liste (colonnes des « Valeurs » du classeur : `classe`, `coefficient`…), dans l'ordre d'apparition. */
export function attributsDuChamp(c: Champ): string[] {
  const noms: string[] = [];
  for (const v of c.valeurs ?? []) if (typeof v !== "string") for (const k of Object.keys(v)) if (k !== "v" && k !== "l" && !noms.includes(k)) noms.push(k);
  return noms;
}

/** Une valeur de liste sans libellé ni attribut se range en simple texte (comme le classeur la relit). */
export function normaliserValeur(v: ValeurListe): ValeurListe {
  if (typeof v === "string") return v;
  const { v: code, l, ...attributs } = v;
  if ((l === undefined || l === "") && Object.keys(attributs).length === 0) return code;
  return { v: code, ...(l !== undefined && l !== "" ? { l } : {}), ...attributs };
}

/** Valeur d'une liste avec un libellé ou un attribut changé (`""` retire le libellé ou l'attribut). Un attribut numérique le reste s'il est un entier. */
export function changerValeur(v: ValeurListe, champ: "l" | { attribut: string }, texte: string): ValeurListe {
  const objet = typeof v === "string" ? { v } : { ...v };
  if (champ === "l") {
    if (texte === "") delete objet.l;
    else objet.l = texte;
  } else if (texte === "") delete objet[champ.attribut];
  else objet[champ.attribut] = typeof objet[champ.attribut] === "number" && /^-?\d+$/.test(texte) ? Number(texte) : texte;
  return normaliserValeur(objet);
}

/** Retire un attribut de toutes les valeurs, sauf si une table le lit comme clé. */
export function supprimerAttribut(b: Bareme, codeChamp: string, attribut: string): Resultat {
  const lus = b.tables.filter((t) => t.cles.includes(`${codeChamp}.${attribut}`)).map((t) => decrit.table(t.code));
  if (lus.length > 0) return refus(`Suppression refusée : l'attribut « ${attribut} » du champ « ${codeChamp} » est lu par ${lus.join(", ")}.`);
  return ok({
    ...b,
    champs: b.champs.map((c) =>
      c.code !== codeChamp ? c : { ...c, valeurs: (c.valeurs ?? []).map((v) => (typeof v === "string" ? v : normaliserValeur(Object.fromEntries(Object.entries(v).filter(([k]) => k !== attribut)) as ValeurListe))) },
    ),
  });
}

/** Renomme la valeur d'une liste (son code). Refusé si une condition, une table ou un essai la nomme, ou si le code est déjà pris dans la liste. */
export function renommerValeur(b: Bareme, codeChamp: string, ancien: string, nouveau: string): Resultat {
  if (nouveau === ancien) return ok(b);
  if (nouveau.trim() === "") return refus("Le code d'une valeur ne peut pas être vide.");
  const champ = b.champs.find((c) => c.code === codeChamp);
  if ((champ?.valeurs ?? []).some((v) => codeValeur(v) === nouveau)) return refus(`La valeur « ${nouveau} » existe déjà dans cette liste.`);
  const lecteurs = lecteursDuChamp(b, codeChamp, ancien);
  if (lecteurs.length > 0) return refus(`Changement de code refusé : la valeur « ${ancien} » du champ « ${codeChamp} » est lue par ${lecteurs.join(", ")}.`);
  return ok({
    ...b,
    champs: b.champs.map((c) =>
      c.code !== codeChamp ? c : { ...c, valeurs: (c.valeurs ?? []).map((v) => (codeValeur(v) !== ancien ? v : typeof v === "string" ? nouveau : { ...v, v: nouveau })) },
    ),
  });
}
