import { Contexte, codeValeur, texteDeValeur } from "./contexte";
import type { Bareme, Champ, Saisie, ValeurSaisie } from "./schema";

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

/**
 * Valeur de chaque champ du barème pour les documents (B6b, D52 ; libellés, D54). La saisie est celle figée avec la cotation. Un champ qui ne
 * s'applique pas à la saisie (condition d'affichage), facultatif et laissé vide, ou marqué non imprimable (`surDocuments: false`) vaut « » : la
 * balise existe toujours, vide. Le barème sert à connaître les champs, leurs conditions et leurs libellés ; aucun tarif n'est lu.
 */
function valeursDuBareme(bareme: Bareme, saisie: Saisie, rendu: "libelle" | "code"): Record<string, string> {
  const contexte = new Contexte(bareme, saisie);
  return Object.fromEntries(
    bareme.champs.map((c) => {
      const v = c.surDocuments === false ? undefined : contexte.lire(c.code).valeur;
      return [c.code, v === undefined ? "" : texteDuChamp(c, v, rendu)];
    }),
  );
}

/**
 * Balises `risque.<code>` d'un produit au barème : ce que le Commercial voit. Liste : le libellé de la valeur choisie ; oui / non : « Oui » ou
 * « Non » ; choix multiples : les libellés séparés par des virgules ; montant, nombre, texte, date : la valeur saisie (le filtre du modèle la met
 * en forme). À AFFICHER ; pour COMPARER (conditions, cases à cocher), un modèle utilise `risque_code.<code>`.
 */
export const risqueDuBareme = (bareme: Bareme, saisie: Saisie): Record<string, string> => valeursDuBareme(bareme, saisie, "libelle");

/**
 * Balises `risque_code.<code>` : le CODE de la valeur (liste : son code ; oui / non : « OUI » ou « NON » ; choix multiples : les codes séparés par
 * des virgules ; autres champs : comme `risque`). Stable quand un libellé change : c'est lui que les modèles comparent.
 */
export const risqueCodeDuBareme = (bareme: Bareme, saisie: Saisie): Record<string, string> => valeursDuBareme(bareme, saisie, "code");

/** Codes des champs d'un barème : les seuls `risque.<code>` et `risque_code.<code>` que ses modèles peuvent utiliser. */
export const codesRisqueDuBareme = (bareme: Bareme): string[] => bareme.champs.map((c) => c.code);
