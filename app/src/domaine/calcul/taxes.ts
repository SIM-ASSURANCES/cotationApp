import type { DateIso } from "./dates";
import { ErreurCalcul } from "./montant";

/**
 * Choix du taux de taxe (CDC §8.3, réponse de la Technique H5 du 08/10/2026, D18). Règles pures.
 *
 * La clé d'un taux est (branche, type de contrat, date d'effet). Un type de contrat vide veut dire
 * « tous types ». Le taux retenu est celui de la ligne LA PLUS PRÉCISE en vigueur à la date demandée
 * (la date d'effet de la police : CDC §8.1, D9) : d'abord le type du contrat, puis le type auquel il est
 * rattaché (H29), enfin « tous types ». Les taux eux-mêmes sont des DONNÉES (table des taxes), jamais
 * écrits ici.
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
 * Hypothèse H29 (à confirmer) : la loi ne cite que INDIVIDUEL et GROUPE. FAMILLE prend le taux
 * INDIVIDUEL, GROUPE_OUVERT le taux GROUPE, quand aucune ligne propre à leur type n'existe.
 */
export const RATTACHEMENT_TYPE_CONTRAT: Partial<Record<TypeContrat, TypeContrat>> = {
  FAMILLE: "INDIVIDUEL",
  GROUPE_OUVERT: "GROUPE",
};

export const MESSAGE_TAUX_MIXTE = "taux mixte non pris en charge : à paramétrer";

export type LigneTaux = {
  branche: string;
  /** null : tous types de contrat. */
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

/** Ordre de recherche pour un type de contrat : le type, son rattachement (H29), puis « tous types ». */
export function typesCherches(typeContrat: TypeContrat): (TypeContrat | null)[] {
  const rattache = RATTACHEMENT_TYPE_CONTRAT[typeContrat];
  return rattache ? [typeContrat, rattache, null] : [typeContrat, null];
}

/**
 * Taux applicable à une branche, un type de contrat et une date. Refuse une branche à taux mixte et
 * l'absence de taux, avec un message clair. Les lignes d'une même clé ne se chevauchent jamais
 * (contrainte en base) : au plus une est en vigueur.
 */
export function choisirTaux<T extends LigneTaux>(lignes: T[], branche: string, typeContrat: TypeContrat, date: DateIso): T & { tauxPourcent: string } {
  for (const type of typesCherches(typeContrat)) {
    const enVigueur = lignes.filter((l) => l.branche === branche && l.typeContrat === type && enVigueurLe(l, date));
    if (enVigueur.length > 1) {
      throw new ErreurCalcul(`Plusieurs taux de taxe en vigueur pour la branche « ${branche} » (${type ?? "tous types"}) au ${date} : paramétrage à corriger.`);
    }
    const ligne = enVigueur[0];
    if (!ligne) continue;
    if (ligne.tauxMixte || ligne.tauxPourcent === null) {
      throw new ErreurCalcul(`Branche « ${branche} » : ${MESSAGE_TAUX_MIXTE}.`);
    }
    return ligne as T & { tauxPourcent: string };
  }
  throw new ErreurCalcul(`Aucune taxe en vigueur pour la branche « ${branche} » (contrat ${typeContrat}) au ${date}.`);
}
