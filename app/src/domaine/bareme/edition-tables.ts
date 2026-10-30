import { codeValeur } from "./contexte";
import { codeValide, type Resultat } from "./edition";
import { DECIMAL, type Bareme, type Champ, type Table } from "./schema";

/**
 * Édition des tables à l'écran (session B5, D59). Fonctions PURES sur le MÊME document que l'import. Une table lit une ou deux clés,
 * toujours TIRÉES DES VALEURS DES CHAMPS du barème (jamais saisies à la main) : la grille attendue (lignes × colonnes) se déduit des
 * champs, `verifierBareme` reste le seul juge de la complétude. Rien n'est écrit par défaut : une case vide n'existe pas dans
 * `lignes` (un 0 silencieux est interdit, A4).
 */

const ok = (bareme: Bareme): Resultat => ({ ok: true, bareme });
const refus = (...messages: string[]): Resultat => ({ ok: false, refus: messages });

export const MESSAGE_CLES_MAX = "Une table lit un ou deux champs au plus. Pour tenir compte de plus de critères, créez plusieurs tables, chacune lue par son sous-jacent (les coefficients de plusieurs sous-jacents se multiplient).";

// ---------------------------------------------------------------- Clés tirées des champs

/** Une clé de table : un champ (liste ou oui / non), ou un attribut tarifaire d'un champ liste (`type_commerce.classe`). */
export type CleLue = { spec: string; champ: string; attribut?: string; libelle: string; valeurs: { v: string; l: string }[] };

const nomChamp = (c: Champ) => c.libelle ?? c.code;

/**
 * Valeurs d'une clé, dans l'ordre du champ : liste → ses valeurs (code + libellé) ; oui / non → OUI et NON ; attribut → ses valeurs
 * distinctes. Même lecture que `verifierBareme` ; `null` si le champ ne peut pas servir de clé (introuvable, autre type, attribut absent
 * d'une valeur).
 */
export function lireCle(b: Bareme, spec: string): CleLue | null {
  const [code, attribut] = spec.split(".");
  const c = b.champs.find((x) => x.code === code);
  if (!c) return null;
  if (c.type === "OUI_NON" && attribut === undefined) return { spec, champ: code, libelle: nomChamp(c), valeurs: [{ v: "OUI", l: "Oui" }, { v: "NON", l: "Non" }] };
  if (c.type !== "LISTE") return null;
  const entrees = c.valeurs ?? [];
  if (attribut === undefined) {
    return { spec, champ: code, libelle: nomChamp(c), valeurs: entrees.map((e) => ({ v: codeValeur(e), l: typeof e === "string" ? e : (e.l ?? e.v) })) };
  }
  const tarifs = entrees.map((e) => (typeof e === "string" ? undefined : e[attribut]));
  if (tarifs.length === 0 || tarifs.some((t) => t === undefined)) return null;
  return { spec, champ: code, attribut, libelle: `${nomChamp(c)} — ${attribut}`, valeurs: [...new Set(tarifs.map(String))].map((v) => ({ v, l: v })) };
}

/** Clés qu'une table peut lire : chaque liste, chaque oui / non, et chaque attribut tarifaire complet d'une liste. */
export function clesPossibles(b: Bareme): CleLue[] {
  const specs: string[] = [];
  for (const c of b.champs) {
    if (c.type === "OUI_NON") specs.push(c.code);
    else if (c.type === "LISTE") {
      specs.push(c.code);
      const noms = new Set<string>();
      for (const e of c.valeurs ?? []) if (typeof e !== "string") for (const k of Object.keys(e)) if (k !== "v" && k !== "l") noms.add(k);
      for (const n of noms) specs.push(`${c.code}.${n}`);
    }
  }
  return specs.map((s) => lireCle(b, s)).filter((c): c is CleLue => c !== null && c.valeurs.length > 0);
}

// ---------------------------------------------------------------- Grille attendue

export type Grille = {
  /** 1 clé : une liste de lignes. 2 clés : lignes × colonnes. */
  dimension: 1 | 2;
  cleLignes: CleLue;
  cleColonnes?: CleLue;
  lignes: { v: string; l: string }[];
  colonnes: { v: string; l: string }[];
};

/** Clé d'une case dans `Table.lignes` : `ligne` (1 clé) ou `ligne|colonne` (2 clés). */
export const cleDeCase = (ligne: string, colonne?: string): string => (colonne === undefined ? ligne : `${ligne}|${colonne}`);

/** Grille d'une table d'après les valeurs actuelles des champs lus ; `null` si une clé n'est plus lisible (champ supprimé, devenu non liste…). */
export function grilleDeTable(b: Bareme, t: Pick<Table, "cles">): Grille | null {
  const cles = t.cles.map((s) => lireCle(b, s));
  if (cles.length < 1 || cles.length > 2 || cles.some((c) => c === null)) return null;
  const [premiere, seconde] = cles as CleLue[];
  return { dimension: seconde ? 2 : 1, cleLignes: premiere, cleColonnes: seconde, lignes: premiere.valeurs, colonnes: seconde ? seconde.valeurs : [] };
}

/** Toutes les cases attendues, dans l'ordre de la grille (ligne par ligne). */
export function clesAttendues(g: Grille): string[] {
  return g.dimension === 1 ? g.lignes.map((l) => l.v) : g.lignes.flatMap((l) => g.colonnes.map((c) => cleDeCase(l.v, c.v)));
}

export type Comptage = { remplies: number; total: number; manquantes: string[]; inconnues: string[] };

/** « n / N cases remplies » : les cases attendues absentes (signalées), et les lignes qui ne correspondent plus à aucune valeur. */
export function comptageDeTable(b: Bareme, t: Table): Comptage | null {
  const g = grilleDeTable(b, t);
  if (!g) return null;
  const attendues = clesAttendues(g);
  const presentes = Object.keys(t.lignes);
  return { total: attendues.length, remplies: attendues.filter((k) => presentes.includes(k)).length, manquantes: attendues.filter((k) => !presentes.includes(k)), inconnues: presentes.filter((k) => !attendues.includes(k)) };
}

/** Nom lisible d'une case (`gardien = Oui, extincteurs = Non`), pour les messages. */
export function decrireCase(g: Grille, cle: string): string {
  const [a, c] = cle.split("|");
  const libelle = (valeurs: Grille["lignes"], v: string) => valeurs.find((x) => x.v === v)?.l ?? v;
  return g.dimension === 1 ? `${g.cleLignes.libelle} : ${libelle(g.lignes, a)}` : `${g.cleLignes.libelle} : ${libelle(g.lignes, a)} × ${g.cleColonnes!.libelle} : ${libelle(g.colonnes, c)}`;
}

// ---------------------------------------------------------------- Nombres saisis

/** Texte d'un nombre saisi (copié d'un tableur ou tapé) : espaces (y compris insécables) retirés, virgule décimale convertie. */
export const decimalDepuisSaisie = (texte: string): string => texte.replace(/[\s  ]/g, "").replace(",", ".");

export const nombreValide = (texte: string): boolean => DECIMAL.test(decimalDepuisSaisie(texte));

const MESSAGE_NOMBRE = "écrivez un nombre positif (virgule ou point : 0,864), sans lettre ni signe";

// ---------------------------------------------------------------- Création, clés, suppression

const tableDe = (b: Bareme, code: string): Table | undefined => b.tables.find((t) => t.code === code);
const remplacer = (b: Bareme, code: string, f: (t: Table) => Table): Bareme => ({ ...b, tables: b.tables.map((t) => (t.code === code ? f(t) : t)) });

/** Ce qui lit une table : sous-jacents (E1, E2, E5), assiettes (opération TABLE), valeurs intermédiaires et conditions de refus. */
export function lecteursDeTable(b: Bareme, code: string): string[] {
  const l: string[] = [];
  const litOperande = (op: unknown): boolean => Array.isArray(op) && (op[0] === "TABLE" ? op[1] === code : op.slice(1).some(litOperande));
  for (const s of b.sousJacents) {
    if (s.effet === "E4") {
      if (Array.isArray(s.quand) && (litOperande(s.quand[1]) || litOperande(s.quand[2]))) l.push(`le sous-jacent « ${s.code} » (condition de refus)`);
    } else if (s.table === code) l.push(`le sous-jacent « ${s.code} »`);
  }
  for (const i of b.intermediaires) if (litOperande(i.op)) l.push(`la valeur intermédiaire « ${i.code} »`);
  for (const g of b.garanties) for (const c of g.composantes) if (litOperande(c.assiette)) l.push(`la composante « ${g.code}.${c.code} » (assiette)`);
  return l;
}

/**
 * Crée une table vide sur 1 ou 2 clés tirées des champs. Au-delà de 2 : refus clair. Une clé doit être lisible (liste, oui / non, ou
 * attribut complet d'une liste) et n'être pas répétée.
 */
export function creerTable(b: Bareme, code: string, cles: string[]): Resultat {
  if (cles.length === 0) return refus("Choisissez le champ que la table lit.");
  if (cles.length > 2) return refus(MESSAGE_CLES_MAX);
  if (tableDe(b, code)) return refus(`Le code « ${code} » est déjà utilisé par une table.`);
  const probleme = problemeDeCles(b, cles);
  if (probleme) return refus(probleme);
  return ok({ ...b, tables: [...b.tables, { code, cles, lignes: {} }] });
}

function problemeDeCles(b: Bareme, cles: string[]): string | null {
  if (new Set(cles).size !== cles.length) return "Une table ne lit pas deux fois le même champ.";
  for (const spec of cles) if (!lireCle(b, spec)) return `« ${spec} » ne peut pas servir de clé : seuls une liste (avec ses valeurs), un oui / non ou un attribut présent sur toutes les valeurs d'une liste sont lisibles.`;
  return null;
}

/**
 * Change les clés lues. Les cases dont la ligne existe encore sont gardées (même clé, même position) ; les autres sont retirées, et la
 * table se signale incomplète s'il en manque. Refusé au-delà de 2 clés.
 */
export function changerCles(b: Bareme, code: string, cles: string[]): Resultat {
  const t = tableDe(b, code);
  if (!t) return refus(`La table « ${code} » n'existe pas.`);
  if (cles.length === 0) return refus("Choisissez le champ que la table lit.");
  if (cles.length > 2) return refus(MESSAGE_CLES_MAX);
  const probleme = problemeDeCles(b, cles);
  if (probleme) return refus(probleme);
  const grille = grilleDeTable(b, { cles });
  const attendues = new Set(clesAttendues(grille!));
  return ok(remplacer(b, code, (x) => ({ ...x, cles, lignes: Object.fromEntries(Object.entries(x.lignes).filter(([k]) => attendues.has(k))) })));
}

/** Supprime une table, sauf si un sous-jacent, une assiette ou un contrôle la lit (on nomme ce qui la lit). */
export function supprimerTable(b: Bareme, code: string): Resultat {
  const lecteurs = lecteursDeTable(b, code);
  if (lecteurs.length > 0) return refus(`Suppression refusée : la table « ${code} » est lue par ${lecteurs.join(", ")}. Modifiez ou supprimez d'abord ce qui la lit.`);
  return ok({ ...b, tables: b.tables.filter((t) => t.code !== code) });
}

/** Renomme le code d'une table, sauf si quelque chose la lit ou si le code est pris. */
export function renommerTable(b: Bareme, ancien: string, nouveau: string): Resultat {
  if (nouveau === ancien) return ok(b);
  if (!codeValide(nouveau)) return refus("Code : minuscules, chiffres et _, commence par une lettre (40 caractères au plus).");
  if (tableDe(b, nouveau)) return refus(`Le code « ${nouveau} » est déjà utilisé par une table.`);
  const lecteurs = lecteursDeTable(b, ancien);
  if (lecteurs.length > 0) return refus(`Changement de code refusé : la table « ${ancien} » est lue par ${lecteurs.join(", ")}.`);
  return ok(remplacer(b, ancien, (t) => ({ ...t, code: nouveau })));
}

// ---------------------------------------------------------------- Cases

/**
 * Pose la valeur d'une case. Texte vide : la case est vidée (elle n'existe plus dans la table). Texte qui n'est pas un nombre positif :
 * refus (la case n'est pas touchée). La case doit correspondre à une ligne attendue (les clés viennent des champs).
 */
export function poserCase(b: Bareme, code: string, cle: string, texte: string): Resultat {
  const t = tableDe(b, code);
  if (!t) return refus(`La table « ${code} » n'existe pas.`);
  const g = grilleDeTable(b, t);
  if (!g) return refus(`La table « ${code} » lit un champ qui n'existe plus ou n'est plus une liste : changez ses clés.`);
  if (!clesAttendues(g).includes(cle)) return refus(`Cette case ne correspond à aucune valeur des champs lus par la table « ${code} ».`);
  const propre = decimalDepuisSaisie(texte);
  if (propre === "") {
    const reste = Object.fromEntries(Object.entries(t.lignes).filter(([k]) => k !== cle));
    return ok(remplacer(b, code, (x) => ({ ...x, lignes: reste })));
  }
  if (!DECIMAL.test(propre)) return refus(`Case « ${decrireCase(g, cle)} » : ${MESSAGE_NOMBRE}.`);
  return ok(remplacer(b, code, (x) => ({ ...x, lignes: { ...x.lignes, [cle]: propre } })));
}

/** « Remplir avec 1 » (ou toute autre valeur) : seules les cases VIDES sont remplies, les valeurs saisies ne sont jamais écrasées. */
export function remplirCasesVides(b: Bareme, code: string, valeur = "1"): Resultat {
  const t = tableDe(b, code);
  if (!t) return refus(`La table « ${code} » n'existe pas.`);
  const g = grilleDeTable(b, t);
  if (!g) return refus(`La table « ${code} » lit un champ qui n'existe plus ou n'est plus une liste : changez ses clés.`);
  if (!DECIMAL.test(valeur)) return refus(`Valeur de remplissage invalide : ${MESSAGE_NOMBRE}.`);
  const lignes = { ...t.lignes };
  for (const k of clesAttendues(g)) if (!(k in lignes)) lignes[k] = valeur;
  return ok(remplacer(b, code, (x) => ({ ...x, lignes })));
}

// ---------------------------------------------------------------- Collage d'une plage copiée d'un tableur

/** Texte copié d'un tableur (colonnes séparées par des tabulations, lignes par des retours) → matrice de cellules. Les lignes vides de fin sont ignorées. */
export function analyserPlage(texte: string): string[][] {
  const lignes = texte.replace(/\r\n?/g, "\n").split("\n").map((l) => l.split("\t").map((c) => c.trim().replace(/^"([\s\S]*)"$/, "$1").trim()));
  while (lignes.length > 0 && lignes[lignes.length - 1].every((c) => c === "")) lignes.pop();
  return lignes;
}

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Colle une plage dans la grille. Deux formes, reconnues sans ambiguïté :
 *  - avec en-têtes (la plage fait une ligne et une colonne de plus que la grille, ou 2 colonnes pour une liste) : chaque case est placée
 *    d'après le CODE ou le LIBELLÉ de sa ligne et de sa colonne, quel que soit l'ordre ;
 *  - sans en-têtes : la plage s'applique à partir de la première case, dans l'ordre de la grille ; elle ne peut pas la dépasser.
 * Tout ou rien : la moindre cellule illisible ou inconnue refuse la plage entière (rien n'est écrit), le message nomme la cellule.
 * Une cellule vide ne modifie pas la case.
 */
export function collerPlage(b: Bareme, code: string, plage: string[][]): Resultat {
  const t = tableDe(b, code);
  if (!t) return refus(`La table « ${code} » n'existe pas.`);
  const g = grilleDeTable(b, t);
  if (!g) return refus(`La table « ${code} » lit un champ qui n'existe plus ou n'est plus une liste : changez ses clés.`);
  if (plage.length === 0 || plage.every((l) => l.every((c) => c === ""))) return refus("Rien à coller : copiez d'abord une plage de cases depuis le tableur.");

  const cherche = (valeurs: Grille["lignes"], libelle: string) => {
    const n = sansAccent(libelle);
    return valeurs.find((v) => sansAccent(v.v) === n || sansAccent(v.l) === n)?.v;
  };
  const problemes: string[] = [];
  const poses: Record<string, string> = {};
  const poser = (cle: string, cellule: string, ou: string) => {
    if (cellule === "") return;
    const propre = decimalDepuisSaisie(cellule);
    if (!DECIMAL.test(propre)) problemes.push(`${ou} : « ${cellule} » n'est pas un nombre positif (virgule ou point).`);
    else poses[cle] = propre;
  };
  const largeur = Math.max(...plage.map((l) => l.length));

  if (g.dimension === 1) {
    if (largeur > 2) return refus(`La table « ${code} » est une liste (une clé) : collez une colonne de valeurs, ou deux colonnes (valeur de la liste, nombre). La plage a ${largeur} colonnes.`);
    if (largeur === 2) {
      plage.forEach((ligne, i) => {
        const v = cherche(g.lignes, ligne[0] ?? "");
        if (v === undefined) {
          // Une première ligne dont le second terme n'est pas un nombre est un en-tête de colonnes.
          if (i === 0 && !nombreValide(ligne[1] ?? "")) return;
          problemes.push(`Ligne ${i + 1} : « ${ligne[0] ?? ""} » n'est aucune valeur de « ${g.cleLignes.libelle} ».`);
          return;
        }
        poser(v, ligne[1] ?? "", `Ligne ${i + 1} (${ligne[0]})`);
      });
    } else {
      if (plage.length > g.lignes.length) return refus(`La plage a ${plage.length} lignes, la table « ${code} » n'en attend que ${g.lignes.length}.`);
      plage.forEach((ligne, i) => poser(g.lignes[i].v, ligne[0] ?? "", `Ligne ${i + 1} (${g.lignes[i].l})`));
    }
  } else {
    const colonnes = g.colonnes;
    const tailleAvecEnTetes = plage.length === g.lignes.length + 1 && largeur === colonnes.length + 1;
    // Une plage de la taille « grille + en-têtes » dont AUCUN en-tête ne se reconnaît n'est pas une plage avec en-têtes : elle est trop grande.
    const avecEnTetes = tailleAvecEnTetes && (plage[0].slice(1).some((e) => cherche(colonnes, e) !== undefined) || plage.slice(1).some((l) => cherche(g.lignes, l[0] ?? "") !== undefined));
    if (avecEnTetes) {
      const entetes = plage[0].slice(1);
      const colonnesVues = entetes.map((e) => cherche(colonnes, e));
      entetes.forEach((e, j) => colonnesVues[j] === undefined && problemes.push(`En-tête de colonne « ${e} » : aucune valeur de « ${g.cleColonnes!.libelle} » ne porte ce nom.`));
      plage.slice(1).forEach((ligne, i) => {
        const v = cherche(g.lignes, ligne[0] ?? "");
        if (v === undefined) return problemes.push(`Ligne ${i + 2} : « ${ligne[0] ?? ""} » n'est aucune valeur de « ${g.cleLignes.libelle} ».`);
        ligne.slice(1).forEach((cellule, j) => colonnesVues[j] !== undefined && poser(cleDeCase(v, colonnesVues[j]), cellule, `Ligne ${i + 2} (${ligne[0]}), colonne ${j + 2}`));
      });
    } else {
      if (plage.length > g.lignes.length || largeur > colonnes.length) {
        return refus(`La plage (${plage.length} ligne(s) × ${largeur} colonne(s)) dépasse la grille de la table « ${code} » (${g.lignes.length} × ${colonnes.length}). Collez soit exactement la grille, soit la grille avec ses en-têtes (une ligne et une colonne de plus).`);
      }
      plage.forEach((ligne, i) => ligne.forEach((cellule, j) => poser(cleDeCase(g.lignes[i].v, colonnes[j].v), cellule, `Ligne ${i + 1}, colonne ${j + 1}`)));
    }
  }
  if (problemes.length > 0) return { ok: false, refus: ["Plage refusée, rien n'a été collé :", ...problemes.slice(0, 12), ...(problemes.length > 12 ? [`… et ${problemes.length - 12} autre(s).`] : [])] };
  if (Object.keys(poses).length === 0) return refus("Aucune case à remplir dans cette plage.");
  return ok(remplacer(b, code, (x) => ({ ...x, lignes: { ...x.lignes, ...poses } })));
}
