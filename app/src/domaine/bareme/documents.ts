import { Contexte, codeValeur, texteDeValeur } from "./contexte";
import { ErreurBareme } from "./erreurs";
import { Evaluateur } from "./operandes";
import type { Bareme, Champ, Saisie, ValeurSaisie } from "./schema";

const CODE_BALISE = /^[a-z][a-z0-9_]*$/;

/** Libellé d'une valeur de liste, tel que le Commercial le voit : `l` de la valeur, à défaut son code. */
function libelleDeValeur(champ: Champ, code: string): string {
  const entree = (champ.valeurs ?? []).find((v) => codeValeur(v) === code);
  return entree !== undefined && typeof entree !== "string" ? (entree.l ?? code) : code;
}

/** Texte d'une valeur saisie : le libellé (`risque.<champ>`) ou le code (`risque_code.<champ>`) ; montant, nombre, texte et date : la valeur elle-même. */
function texteDuChamp(champ: Champ, v: ValeurSaisie, rendu: "libelle" | "code"): string {
  if (typeof v === "boolean") return rendu === "libelle" ? (v ? "Oui" : "Non") : v ? "OUI" : "NON";
  if (Array.isArray(v)) return v.map((x) => (rendu === "libelle" ? libelleDeValeur(champ, x) : x)).join(", ");
  if (champ.type === "LISTE" && rendu === "libelle") return libelleDeValeur(champ, texteDeValeur(v));
  return texteDeValeur(v);
}

/** Attributs tarifaires d'un champ liste : les clés des valeurs autres que `v` et `l` (ex. `classe`), si elles sont des noms de balise valides. */
function attributsDuChamp(champ: Champ): string[] {
  const noms = new Set<string>();
  for (const valeur of champ.valeurs ?? []) {
    if (typeof valeur === "string") continue;
    for (const cle of Object.keys(valeur)) if (cle !== "v" && cle !== "l" && CODE_BALISE.test(cle)) noms.add(cle);
  }
  return [...noms];
}

/**
 * Codes des balises d'un produit au barème, communs à `risque.<code>` et `risque_code.<code>` (B6b, D52 ; D54), dans cet ordre (si deux
 * sources ont le même code, la première gagne : un champ n'est jamais masqué par une valeur calculée) :
 *  1. chaque champ du barème ;
 *  2. chaque attribut tarifaire d'un champ liste : `<champ>_<attribut>` (ex. `type_commerce_classe`) ;
 *  3. chaque valeur intermédiaire du barème (ex. `contenu`, `capitaux_totaux`).
 */
export function codesRisqueDuBareme(bareme: Bareme): string[] {
  const codes = new Set<string>(bareme.champs.map((c) => c.code));
  for (const c of bareme.champs) for (const attribut of attributsDuChamp(c)) codes.add(`${c.code}_${attribut}`);
  for (const i of bareme.intermediaires) codes.add(i.code);
  return [...codes];
}

/**
 * Valeur de chaque balise pour une saisie, figée avec la cotation. Champ : la saisie, en libellé ou en code. Attribut : celui de la valeur choisie
 * dans la liste (même texte dans les deux rendus : ce n'est ni une liste ni un oui / non). Valeur intermédiaire : le montant décimal calculé par le
 * moteur du barème, celui des lignes de prime (même texte dans les deux rendus). Un champ qui ne s'applique pas à la saisie (condition d'affichage),
 * facultatif et laissé vide, ou marqué non imprimable (`surDocuments: false`), et tout ce qui en dépend (attributs ; valeur intermédiaire que la
 * saisie ne permet pas de calculer), vaut « » : la balise existe toujours, vide, et la fonction ne lève jamais d'erreur de saisie. Aucun tarif n'est
 * lu dans les tables.
 */
function valeursDuBareme(bareme: Bareme, saisie: Saisie, rendu: "libelle" | "code"): Record<string, string> {
  const contexte = new Contexte(bareme, saisie);
  const risque: Record<string, string> = {};
  const poser = (code: string, valeur: string) => {
    if (!(code in risque)) risque[code] = valeur;
  };
  const imprimable = (c: Champ) => c.surDocuments !== false;
  for (const c of bareme.champs) {
    const v = imprimable(c) ? contexte.lire(c.code).valeur : undefined;
    poser(c.code, v === undefined ? "" : texteDuChamp(c, v, rendu));
  }
  for (const c of bareme.champs) {
    const v = imprimable(c) ? contexte.lire(c.code).valeur : undefined;
    const choisie = typeof v === "string" ? (c.valeurs ?? []).find((x) => codeValeur(x) === v) : undefined;
    for (const attribut of attributsDuChamp(c)) {
      const tarif = choisie !== undefined && typeof choisie !== "string" ? choisie[attribut] : undefined;
      poser(`${c.code}_${attribut}`, tarif === undefined ? "" : String(tarif));
    }
  }
  const evaluateur = new Evaluateur(contexte);
  for (const i of bareme.intermediaires) {
    try {
      poser(i.code, evaluateur.valeurIntermediaire(i.code).toFixed());
    } catch (e) {
      if (!(e instanceof ErreurBareme)) throw e;
      poser(i.code, ""); // dépend d'un champ inapplicable, ou saisie incomplète : jamais une erreur, une valeur vide
    }
  }
  return risque;
}

/**
 * Balises `risque.<code>` : ce que le Commercial voit. Liste : le libellé de la valeur choisie ; oui / non : « Oui » ou « Non » ; choix multiples :
 * les libellés séparés par des virgules ; montant, nombre, texte, date : la valeur saisie (le filtre du modèle la met en forme). À AFFICHER ; pour
 * COMPARER (conditions, cases à cocher), un modèle utilise `risque_code.<code>`.
 */
export const risqueDuBareme = (bareme: Bareme, saisie: Saisie): Record<string, string> => valeursDuBareme(bareme, saisie, "libelle");

/**
 * Balises `risque_code.<code>` : le CODE de la valeur (liste : son code ; oui / non : « OUI » ou « NON » ; choix multiples : les codes séparés par
 * des virgules ; autres champs, attributs et valeurs intermédiaires : comme `risque`). Stable quand un libellé change : c'est lui que les modèles
 * comparent.
 */
export const risqueCodeDuBareme = (bareme: Bareme, saisie: Saisie): Record<string, string> => valeursDuBareme(bareme, saisie, "code");
