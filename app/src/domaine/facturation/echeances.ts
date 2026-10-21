import { ajouterJours, dateValide, ecartEnJours, type DateIso } from "../calcul/dates";
import { DecimalMontant, montant, ZERO, type Montant } from "../calcul/montant";

/**
 * Avis d'échéance et relances (CDC §12, session 5b) : règles PURES. Le serveur lit la base (factures émises, paiements,
 * paramètres du produit, documents déjà produits) ; ces fonctions disent ce qu'il reste à produire, et pourquoi.
 *
 * Une ÉCHÉANCE est une tranche d'une facture émise (échéancier de la facture) ; une facture sans échéancier a une seule
 * échéance, son terme : le TTC entier, dû à la date d'effet de la facture (H67). Les paiements couvrent les échéances
 * DANS L'ORDRE (H49) : une échéance n'est « Payé » que couverte en entier ; couverte en partie, elle est « Partiellement
 * payé » (session 6.1). `repartirEcheances` est l'UNIQUE règle de cette répartition : l'écran de la facture, les données
 * du PDF, les avis, les relances et le tableau de bord l'appellent tous.
 */

// ------------------------------------------------------------------ Paramètres (par produit, historisés)

export type NiveauRelance = { niveau: number; jours: number; libelle: string };

export type ParametresRelance = {
  /** Délai J-x de l'avis d'échéance, en jours avant la date de l'échéance. */
  delaiAvisJours: number;
  /** Niveaux de relance, du premier au dernier : J+jours après la date de l'échéance. */
  niveaux: NiveauRelance[];
};

/** Valeurs par défaut du CDC §12 : avis à J-15 ; relances à J+7, J+15, J+30 (mise en demeure). */
export const PARAMETRES_RELANCE_DEFAUT: ParametresRelance = {
  delaiAvisJours: 15,
  niveaux: [
    { niveau: 1, jours: 7, libelle: "Première relance" },
    { niveau: 2, jours: 15, libelle: "Deuxième relance" },
    { niveau: 3, jours: 30, libelle: "Mise en demeure" },
  ],
};

/** 9 niveaux au plus : un modèle Word par niveau, niveaux 1 à 9 (H16, contrôle au dépôt d'un modèle de relance). */
export const NIVEAUX_MAX = 9;

export function problemesParametresRelance(p: ParametresRelance): string[] {
  const pb: string[] = [];
  if (!Number.isInteger(p.delaiAvisJours) || p.delaiAvisJours < 0 || p.delaiAvisJours > 365) pb.push("Délai de l'avis d'échéance : un nombre entier de jours, de 0 à 365.");
  if (p.niveaux.length === 0) pb.push("Au moins un niveau de relance.");
  if (p.niveaux.length > NIVEAUX_MAX) pb.push(`${NIVEAUX_MAX} niveaux de relance au plus.`);
  p.niveaux.forEach((n, i) => {
    if (n.niveau !== i + 1) pb.push(`Les niveaux se suivent à partir de 1 (niveau ${n.niveau} à la place ${i + 1}).`);
    if (!Number.isInteger(n.jours) || n.jours < 1 || n.jours > 365) pb.push(`Niveau ${n.niveau} : un nombre entier de jours après l'échéance, de 1 à 365.`);
    if (i > 0 && n.jours <= p.niveaux[i - 1].jours) pb.push(`Niveau ${n.niveau} : son délai doit dépasser celui du niveau ${p.niveaux[i - 1].niveau}.`);
    const libelle = n.libelle.trim();
    if (libelle === "" || libelle.length > 100) pb.push(`Niveau ${n.niveau} : libellé obligatoire (100 caractères au plus).`);
  });
  return pb;
}

// ------------------------------------------------------------------ Échéances d'une facture

export type FactureAppelable = {
  /** EMISE seulement : un brouillon, une facture « À valider » ou ANNULÉE (avoir) n'appelle rien. */
  statut: string;
  type: string;
  dateEffet: DateIso;
  ttc: string;
  echeances?: readonly { numero: number; date: DateIso; montant: string }[];
};

/** Statut d'une échéance (`echeances[].statut`). */
export type StatutEcheance = "Payé" | "Partiellement payé" | "Non payé";

export type EcheanceDue = {
  numero: number;
  date: DateIso;
  montant: string;
  /** Part déjà couverte par les paiements (dans l'ordre des échéances). */
  paye: string;
  /** Reste à payer sur CETTE échéance. */
  restant: string;
  payee: boolean;
  statut: StatutEcheance;
};

/** Une facture appelle des paiements : émise (numéro attribué), pas annulée par un avoir, pas un avoir. */
export const factureAppelable = (f: Pick<FactureAppelable, "statut" | "type">): boolean => f.statut === "EMISE" && f.type !== "AVOIR";

/**
 * Répartition d'une somme réglée sur des échéances, DANS L'ORDRE (H49) : chaque échéance reçoit au plus son montant, le
 * surplus passe à la suivante. La somme réglée est celle de la facture : paiements hors excédent (H33), imputations
 * d'avance et sommes reportées (session 6.0) comptent comme des paiements.
 */
export function repartirEcheances(echeances: readonly { numero: number; date: DateIso; montant: string }[], totalPaye: string): EcheanceDue[] {
  let reste: Montant = montant(totalPaye);
  return (echeances ?? []).map((e) => {
    const du = montant(e.montant);
    const couvert = DecimalMontant.min(du, DecimalMontant.max(ZERO, reste));
    reste = reste.minus(couvert);
    const restant = du.minus(couvert);
    const payee = !restant.greaterThan(0);
    const statut: StatutEcheance = payee ? "Payé" : couvert.greaterThan(0) ? "Partiellement payé" : "Non payé";
    return { numero: e.numero, date: e.date, montant: du.toFixed(), paye: couvert.toFixed(), restant: restant.toFixed(), payee, statut };
  });
}

/** Échéances d'une facture et leur couverture par le total payé (H49 : dans l'ordre ; H67 : terme unique sans échéancier). */
export function echeancesDe(f: FactureAppelable, totalPaye: string): EcheanceDue[] {
  const echeances = f.echeances ?? [];
  return repartirEcheances(echeances.length > 0 ? echeances : [{ numero: 1, date: f.dateEffet, montant: f.ttc }], totalPaye);
}

// ------------------------------------------------------------------ Avis d'échéance (J-x)

/**
 * Avis à produire pour une échéance, à une date : échéance non payée, à échoir dans au plus `delaiAvisJours` jours
 * (fenêtre de J-x jusqu'au jour de l'échéance compris : un jour manqué par la tâche quotidienne se rattrape le
 * lendemain), et aucun avis déjà produit pour elle. Une échéance échue relève des relances.
 */
export function avisDu(e: Pick<EcheanceDue, "date" | "payee">, p: Pick<ParametresRelance, "delaiAvisJours">, aujourdhui: DateIso, dejaProduit: boolean): boolean {
  if (e.payee || dejaProduit) return false;
  return aujourdhui >= ajouterJours(e.date, -p.delaiAvisJours) && aujourdhui <= e.date;
}

// ------------------------------------------------------------------ Relances (J+x)

export const joursDeRetard = (e: Pick<EcheanceDue, "date">, aujourdhui: DateIso): number => ecartEnJours(e.date, aujourdhui);

/**
 * Niveau de relance à produire pour une échéance, à une date : le niveau le PLUS ÉLEVÉ dont le délai est atteint, s'il
 * n'a pas déjà été produit (un seul document par échéance et par niveau). Les niveaux inférieurs non produits ne sont
 * pas rattrapés : on n'envoie pas une première relance après la mise en demeure (H68). Rien si l'échéance est payée.
 */
export function relanceDue(e: Pick<EcheanceDue, "date" | "payee">, p: Pick<ParametresRelance, "niveaux">, aujourdhui: DateIso, niveauxProduits: readonly number[]): NiveauRelance | null {
  if (e.payee) return null;
  const retard = joursDeRetard(e, aujourdhui);
  const atteints = p.niveaux.filter((n) => retard >= n.jours);
  const plusHaut = atteints[atteints.length - 1];
  if (!plusHaut) return null;
  // Un niveau supérieur déjà produit (paramètres changés depuis) : rien de plus bas.
  if (niveauxProduits.some((n) => n >= plusHaut.niveau)) return null;
  return plusHaut;
}

/** Contrôles d'une date de liste (écran « Liste du jour »). */
export const problemesDateListe = (date: string): string[] => (dateValide(date) ? [] : ["Date de la liste invalide (AAAA-MM-JJ)."]);
