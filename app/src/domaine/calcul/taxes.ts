import type { DateIso } from "./dates";
import { ErreurCalcul } from "./montant";

/**
 * Choix du taux de taxe (CDC §8.3, réponse de la Technique H5 du 08/10/2026, D18). Règles pures.
 *
 * La clé d'un taux est (branche, régime de taxe, date d'effet). Un régime vide veut dire « tous régimes ».
 * Depuis la réponse de la Technique du 09/10/2026 (H29 fermée) : c'est le RÉGIME DE TAXE choisi sur la
 * cotation (« Individuel » ou « Groupe »), et non plus le type de contrat, qui sélectionne le taux. Le taux
 * retenu est celui de la ligne LA PLUS PRÉCISE en vigueur à la date demandée (la date d'effet de la police :
 * CDC §8.1, D9) : d'abord le régime, puis « tous régimes ». Les taux eux-mêmes sont des DONNÉES (table des
 * taxes), jamais écrits ici.
 */

export const TYPES_CONTRAT = ["INDIVIDUEL", "FAMILLE", "GROUPE", "GROUPE_OUVERT"] as const;
export type TypeContrat = (typeof TYPES_CONTRAT)[number];

export const LIBELLE_TYPE_CONTRAT: Record<TypeContrat, string> = {
  INDIVIDUEL: "Individuel",
  FAMILLE: "Famille",
  GROUPE: "Groupe",
  GROUPE_OUVERT: "Groupe ouvert",
};

export function estTypeContrat(valeur: string): valeur is TypeContrat {
  return (TYPES_CONTRAT as readonly string[]).includes(valeur);
}

/**
 * Régime de taxe (réponse de la Technique du 09/10/2026, H29 fermée : « un bouton pour dire si le contrat est
 * individuel ou groupe »). Choisi sur la cotation, obligatoire ; il sélectionne le taux. Le type de contrat
 * reste dans les documents (`police.type_contrat`).
 */
export const REGIMES_TAXE = ["INDIVIDUEL", "GROUPE"] as const;
export type RegimeTaxe = (typeof REGIMES_TAXE)[number];

export const LIBELLE_REGIME_TAXE: Record<RegimeTaxe, string> = { INDIVIDUEL: "Individuel", GROUPE: "Groupe" };

export const estRegimeTaxe = (valeur: string): valeur is RegimeTaxe => (REGIMES_TAXE as readonly string[]).includes(valeur);

/** Régime proposé par défaut : INDIVIDUEL et FAMILLE → Individuel ; GROUPE et GROUPE_OUVERT → Groupe. Modifiable. */
export const REGIME_PAR_DEFAUT: Record<TypeContrat, RegimeTaxe> = {
  INDIVIDUEL: "INDIVIDUEL",
  FAMILLE: "INDIVIDUEL",
  GROUPE: "GROUPE",
  GROUPE_OUVERT: "GROUPE",
};

export const MESSAGE_TAUX_MIXTE = "taux mixte non pris en charge : à paramétrer";

export type LigneTaux = {
  branche: string;
  /**
   * Régime de taxe de la ligne (colonne historique `type_contrat`) ; null : tous régimes. Une ligne FAMILLE ou
   * GROUPE_OUVERT d'avant la session 6.0 n'est plus jamais retenue : seuls INDIVIDUEL, GROUPE et « tous » le sont.
   */
  typeContrat: TypeContrat | null;
  /** Taux en % (« 1.5 ») ; null pour une ligne à taux mixte. */
  tauxPourcent: string | null;
  /** Plusieurs taux dans un même contrat (incendie / dommages aux biens) : calcul refusé tant que la ventilation n'est pas paramétrée. */
  tauxMixte: boolean;
  assiette: string;
  dateEffet: DateIso;
  dateFin: DateIso | null;
};

/** Période de validité, bornes incluses ; sans date de fin, la ligne reste en vigueur. */
export const enVigueurLe = (l: Pick<LigneTaux, "dateEffet" | "dateFin">, date: DateIso): boolean => l.dateEffet <= date && (l.dateFin === null || l.dateFin >= date);

/** Deux périodes d'une même clé se chevauchent-elles ? (contrôle aussi garanti par la base) */
export function periodesSeChevauchent(a: Pick<LigneTaux, "dateEffet" | "dateFin">, b: Pick<LigneTaux, "dateEffet" | "dateFin">): boolean {
  return a.dateEffet <= (b.dateFin ?? "9999-12-31") && b.dateEffet <= (a.dateFin ?? "9999-12-31");
}

/** Ordre de recherche pour un régime de taxe : le régime, puis « tous régimes ». */
export const typesCherches = (regime: RegimeTaxe): (RegimeTaxe | null)[] => [regime, null];

/**
 * Taux applicable à une branche, un type de contrat et une date. Refuse une branche à taux mixte et
 * l'absence de taux, avec un message clair. Les lignes d'une même clé ne se chevauchent jamais
 * (contrainte en base) : au plus une est en vigueur.
 */
export function choisirTaux<T extends LigneTaux>(lignes: T[], branche: string, regime: RegimeTaxe, date: DateIso): T & { tauxPourcent: string } {
  for (const type of typesCherches(regime)) {
    const enVigueur = lignes.filter((l) => l.branche === branche && l.typeContrat === type && enVigueurLe(l, date));
    if (enVigueur.length > 1) {
      throw new ErreurCalcul(`Plusieurs taux de taxe en vigueur pour la branche « ${branche} » (${type ?? "tous régimes"}) au ${date} : paramétrage à corriger.`);
    }
    const ligne = enVigueur[0];
    if (!ligne) continue;
    if (ligne.tauxMixte || ligne.tauxPourcent === null) {
      throw new ErreurCalcul(`Branche « ${branche} » : ${MESSAGE_TAUX_MIXTE}.`);
    }
    return ligne as T & { tauxPourcent: string };
  }
  throw new ErreurCalcul(`Aucune taxe en vigueur pour la branche « ${branche} » (régime ${LIBELLE_REGIME_TAXE[regime].toLowerCase()}) au ${date}.`);
}

/**
 * Branche fiscale (D21, réponse de Thierry du 08/10/2026) : liste paramétrable, clé des taux de taxe et
 * des produits. Le code ne change jamais (il est référencé) ; le libellé et l'état actif se modifient.
 */
export type BrancheSaisie = { code: string; libelle: string };

export const LONGUEUR_MAX_LIBELLE_BRANCHE = 100;
const CODE_BRANCHE = /^[A-Z0-9][A-Z0-9_]{0,29}$/; // même règle que les codes de produit

export function problemesBranche(b: BrancheSaisie): string[] {
  const problemes: string[] = [];
  if (!CODE_BRANCHE.test(b.code)) problemes.push("Code de branche invalide (majuscules, chiffres et _, 30 caractères au plus).");
  const libelle = b.libelle.trim();
  if (libelle === "") problemes.push("Le libellé de la branche est obligatoire.");
  else if (libelle.length > LONGUEUR_MAX_LIBELLE_BRANCHE) problemes.push(`Libellé de la branche trop long (${LONGUEUR_MAX_LIBELLE_BRANCHE} caractères au plus).`);
  return problemes;
}
