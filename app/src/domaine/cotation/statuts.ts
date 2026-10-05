import { ajouterMois, type DateIso } from "../calcul/dates";

/** Statuts et transitions d'une cotation (CDC §9.3). Règles pures. */

export const STATUTS = ["BROUILLON", "A_VALIDER", "EMISE", "ACCEPTEE", "REFUSEE", "EXPIREE"] as const;
export type StatutCotation = (typeof STATUTS)[number];

export const LIBELLE_STATUT: Record<StatutCotation, string> = {
  BROUILLON: "Brouillon",
  A_VALIDER: "À valider",
  EMISE: "Émise",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  EXPIREE: "Expirée",
};

export function estStatut(valeur: string): valeur is StatutCotation {
  return (STATUTS as readonly string[]).includes(valeur);
}

/**
 * Fin de validité : date d'établissement + N mois (T1 : « date + 3 mois »). Le jour de la fin de
 * validité est encore valable ; si le mois d'arrivée est plus court, c'est son dernier jour.
 */
export function dateFinValidite(dateEtablissement: DateIso, mois: number): DateIso {
  return ajouterMois(dateEtablissement, mois);
}

/**
 * Statut réel à une date donnée. Une cotation émise dont la validité est dépassée est « Expirée »
 * automatiquement, même si la base n'a pas encore été mise à jour (CDC §9.3).
 */
export function statutEffectif(statut: StatutCotation, dateValidite: DateIso | null, aujourdhui: DateIso): StatutCotation {
  return statut === "EMISE" && dateValidite !== null && aujourdhui > dateValidite ? "EXPIREE" : statut;
}

/** Seul un brouillon se modifie : une cotation validée ou émise est figée (CDC §4.1). */
export const peutModifier = (statut: StatutCotation): boolean => statut === "BROUILLON";
/** Le client ne peut accepter qu'une cotation émise ET encore valide : jamais une expirée (T11). */
export const peutAccepter = (statut: StatutCotation): boolean => statut === "EMISE";
export const peutRefuser = (statut: StatutCotation): boolean => statut === "EMISE";
export const peutEtreValidee = (statut: StatutCotation): boolean => statut === "A_VALIDER";
export const peutEtreRenvoyee = (statut: StatutCotation): boolean => statut === "A_VALIDER";

/** Filigrane du PDF ré-édité (CDC §9.3, T11). */
export const filigraneDe = (statut: StatutCotation): string | null => (statut === "EXPIREE" ? "EXPIRÉE" : null);
