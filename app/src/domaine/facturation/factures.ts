import { ajouterJours, ajouterMois, dateValide, type DateIso } from "../calcul/dates";
import { analyserMontant, ErreurCalcul, montant, ZERO, type Montant } from "../calcul/montant";
import type { Assure, Souscripteur } from "../cotation/saisie";
import type { IntermediaireDocument } from "../intermediaires";
import type { FormuleSource } from "../documents/donnees";

/**
 * Factures, avoirs, paiements et reçus (CDC §11, §12, session 4b). Règles pures : aucun montant n'est calculé ici en
 * dehors du moteur (domaine/calcul), sauf les soldes (somme des paiements, restant dû) et le signe d'un avoir.
 */

export const TYPES_FACTURE = ["AFFAIRE_NOUVELLE", "RENOUVELLEMENT", "AVENANT", "AVOIR"] as const;
export type TypeFacture = (typeof TYPES_FACTURE)[number];

export const LIBELLE_TYPE_FACTURE: Record<TypeFacture, string> = {
  AFFAIRE_NOUVELLE: "Affaire nouvelle",
  RENOUVELLEMENT: "Renouvellement",
  AVENANT: "Avenant d'incorporation",
  AVOIR: "Avoir",
};

export const STATUTS_FACTURE = ["BROUILLON", "A_VALIDER", "EMISE", "ANNULEE"] as const;
export type StatutFacture = (typeof STATUTS_FACTURE)[number];

export const LIBELLE_STATUT_FACTURE: Record<StatutFacture, string> = {
  BROUILLON: "Brouillon",
  A_VALIDER: "À valider",
  EMISE: "Émise",
  ANNULEE: "Annulée",
};

export const CANAUX_PAIEMENT = ["ESPECES", "CHEQUE", "VIREMENT", "MOBILE_MONEY"] as const;
export type CanalPaiement = (typeof CANAUX_PAIEMENT)[number];

/** « AVANCE » : imputation de l'avance de la police sur une facture (session 6.0) ; jamais le canal d'un paiement. */
export type CanalEncaissement = CanalPaiement | "AVANCE";

export const LIBELLE_CANAL: Record<CanalEncaissement, string> = {
  ESPECES: "Espèces",
  CHEQUE: "Chèque",
  VIREMENT: "Virement",
  MOBILE_MONEY: "Mobile Money",
  AVANCE: "Avance",
};

export const estCanalPaiement = (valeur: string): valeur is CanalPaiement => (CANAUX_PAIEMENT as readonly string[]).includes(valeur);

/** « Envoyé à » (CDC §11.2) : destinataire de la facture quand il diffère du souscripteur (« Facturé à »). */
export type EnvoyeA = { nom: string; adresse: string };

/**
 * Contenu figé d'une facture ou d'un avoir (colonne `factures.contenu`) : tout ce qu'il faut pour écrire le document,
 * montants du moteur en texte. Un avoir porte les montants de la facture qu'il annule, en négatif.
 */
export type ContenuFacture = {
  produit: { code: string; libelle: string; gamme: string; branche: string };
  typeContrat: string | null;
  souscripteur: Souscripteur;
  envoyeA: EnvoyeA | null;
  /** Assurés repris sur la facture (facture de groupe : annexe par adhérent) ; [] pour un contrat individuel sans liste. */
  assures: Assure[];
  ordresSansPrime: number[];
  /** Listes toujours renvoyées en annexe : « assures » pour un contrat de groupe (CDC §11.3, facture de groupe). */
  listesEnAnnexe: string[];
  dateSouscription: DateIso;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  joursCouverts: number;
  formules: FormuleSource[];
  totaux: { nette: string; accessoires: string; taxe: string; ttc: string };
  taxe: { tauxPourcent: string; assiette: string };
  /** Échéancier de la facture : vide si elle n'est pas fractionnée (une seule tranche). */
  echeances: { numero: number; date: DateIso; montant: string }[];
  /** Entrée du moteur dont viennent les montants (null pour un avoir : ses montants sont ceux de la facture annulée). */
  entree: unknown;
  /** Intermédiaires de la cotation (session 6.0) ; absent d'une facture d'avant : liste vide dans le document. */
  intermediaires?: IntermediaireDocument[];
};

// ------------------------------------------------------------------ « Envoyé à »

/**
 * « Envoyé à » retenu : null (bloc masqué) s'il n'est pas saisi ou s'il est identique à « Facturé à » (même nom et même
 * adresse, sans tenir compte des majuscules ni des espaces).
 */
export function envoyeARetenu(saisi: EnvoyeA | null, factureA: { nom: string; adresse: string }): EnvoyeA | null {
  if (!saisi) return null;
  const propre = (t: string) => t.normalize("NFC").replace(/\s+/g, " ").trim();
  const nom = propre(saisi.nom);
  const adresse = propre(saisi.adresse);
  if (nom === "" && adresse === "") return null;
  if (nom.toLowerCase() === propre(factureA.nom).toLowerCase() && adresse.toLowerCase() === propre(factureA.adresse).toLowerCase()) return null;
  return { nom, adresse };
}

export function problemesEnvoyeA(saisi: EnvoyeA | null): string[] {
  if (!saisi) return [];
  const p: string[] = [];
  if ((saisi.nom.trim() === "") !== (saisi.adresse.trim() === "")) p.push("« Envoyé à » : le nom et l'adresse vont ensemble (les deux, ou aucun).");
  if (saisi.nom.length > 200 || saisi.adresse.length > 300) p.push("« Envoyé à » : 200 caractères au plus pour le nom, 300 pour l'adresse.");
  return p;
}

/** Nom affiché dans « Facturé à » : raison sociale d'une personne morale, sinon nom et prénoms. */
export const nomFacture = (s: Pick<Souscripteur, "type" | "nom" | "prenoms" | "raison_sociale">): string =>
  (s.type === "MORALE" ? s.raison_sociale : `${s.nom} ${s.prenoms}`).replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ Avoir (CDC §11.3, §11.5)

const negatif = (t: string): string => (montant(t).isZero() ? "0" : montant(t).negated().toFixed());

/** Contenu d'un avoir : celui de la facture annulée, montants en négatif ; mêmes dates et mêmes assurés. */
export function contenuAvoir(facture: ContenuFacture): ContenuFacture {
  const totaux = facture.totaux;
  return {
    ...facture,
    formules: facture.formules.map((f) => ({ ...f, primeUnitaire: negatif(f.primeUnitaire), primeParAssure: negatif(f.primeParAssure), nette: negatif(f.nette), accessoires: negatif(f.accessoires), taxe: negatif(f.taxe), ttc: negatif(f.ttc) })),
    totaux: { nette: negatif(totaux.nette), accessoires: negatif(totaux.accessoires), taxe: negatif(totaux.taxe), ttc: negatif(totaux.ttc) },
    // Un avoir n'a pas d'échéancier : il annule la facture en une fois.
    echeances: [],
    entree: null,
  };
}

export const LONGUEUR_MIN_MOTIF_AVOIR = 5;

export function problemesMotifAvoir(motif: string): string[] {
  const t = motif.trim();
  return t.length < LONGUEUR_MIN_MOTIF_AVOIR || t.length > 500 ? [`Motif de l'avoir obligatoire (${LONGUEUR_MIN_MOTIF_AVOIR} à 500 caractères).`] : [];
}

// ------------------------------------------------------------------ Renouvellement (CDC §11.3)

/** Période proposée pour un renouvellement : du lendemain de l'échéance précédente, pour un an (jour de fin inclus). */
export function periodeRenouvellement(echeancePrecedente: DateIso): { dateEffet: DateIso; dateEcheance: DateIso } {
  const dateEffet = ajouterJours(echeancePrecedente, 1);
  return { dateEffet, dateEcheance: ajouterJours(ajouterMois(dateEffet, 12), -1) };
}

// ------------------------------------------------------------------ Paiements et soldes (CDC §11.1, §12)

/**
 * Somme qui règle une facture : un paiement (reçu REC), un paiement reporté depuis la facture annulée qu'elle remplace (H47 :
 * son reçu d'origine reste valable), ou une imputation de l'avance de la police (H33, sans reçu : `numero` vide).
 * `excedent` : part d'un paiement au-delà du restant dû, versée en avance (H33) ; elle ne règle pas la facture.
 */
export type PaiementEnregistre = { numero: string; date: DateIso; montant: string; reference: string; canal: CanalEncaissement; payeur: string; excedent?: string };

/** Part d'une somme qui règle la facture (montant hors excédent). */
export const partReglee = (p: Pick<PaiementEnregistre, "montant" | "excedent">): Montant => montant(p.montant).minus(montant(p.excedent ?? "0"));

export type EtatPaiements = {
  totalPaye: string;
  restantDu: string;
  /** Échéances avec leur statut : payées DANS L'ORDRE, une échéance n'est « Payé » que couverte en entier (H49). */
  echeances: { numero: number; date: DateIso; montant: string; statut: "Payé" | "Non payé" }[];
  /** Paiements dans l'ordre d'enregistrement, avec le restant dû après chacun. */
  paiements: (PaiementEnregistre & { restantDu: string })[];
};

export function etatPaiements(ttc: string, echeances: ContenuFacture["echeances"], paiements: readonly PaiementEnregistre[]): EtatPaiements {
  let cumule: Montant = ZERO;
  const liste = paiements.map((p) => {
    cumule = cumule.plus(partReglee(p));
    return { ...p, restantDu: montant(ttc).minus(cumule).toFixed() };
  });
  let couvert: Montant = ZERO;
  const etat = echeances.map((e) => {
    couvert = couvert.plus(montant(e.montant));
    return { ...e, statut: (cumule.greaterThanOrEqualTo(couvert) ? "Payé" : "Non payé") as "Payé" | "Non payé" };
  });
  return { totalPaye: cumule.toFixed(), restantDu: montant(ttc).minus(cumule).toFixed(), echeances: etat, paiements: liste };
}

export type SaisiePaiement = { date: DateIso; montant: string; canal: string; reference: string; payeur: string };

/**
 * Contrôles d'un paiement (CDC §12) : montant > 0 (analyseur unique), facture émise et non annulée (pas un avoir),
 * date valide et pas dans le futur, canal connu. Trop-perçu ACCEPTÉ (réponse de la Technique du 09/10/2026, H33) : la part
 * au-delà du restant dû est l'`excedent`, versé en avance sur la police. Renvoie le montant canonique et l'excédent.
 */
export function controlerPaiement(
  saisie: SaisiePaiement,
  facture: { statut: StatutFacture; type: TypeFacture; numero: string | null; restantDu: string },
  aujourdhui: DateIso,
): { problemes: string[]; montant: string | null; excedent: string } {
  const p: string[] = [];
  let canonique: string | null = null;
  try {
    canonique = analyserMontant(saisie.montant);
    if (!montant(canonique).greaterThan(0)) p.push("Le montant du paiement doit être supérieur à 0.");
  } catch (erreur) {
    p.push(erreur instanceof ErreurCalcul ? erreur.message : "Montant invalide.");
  }
  if (facture.type === "AVOIR") p.push("Un avoir ne se paie pas.");
  else if (facture.statut === "ANNULEE") p.push(`La facture ${facture.numero ?? ""} est annulée par un avoir : aucun paiement ne peut y être enregistré.`.replace("  ", " "));
  else if (facture.statut !== "EMISE") p.push("Seule une facture émise peut recevoir un paiement.");
  else if (!montant(facture.restantDu).greaterThan(0)) p.push("Cette facture est déjà soldée : une somme reçue en plus s'enregistre sur la facture suivante, ou se restitue.");
  p.push(...problemesDateCanal(saisie, aujourdhui, "paiement"));
  if (saisie.payeur.trim().length > 200) p.push("Payeur : 200 caractères au plus.");
  if (p.length > 0 || canonique === null) return { problemes: p, montant: null, excedent: "0" };
  const excedent = montant(canonique).minus(montant(facture.restantDu));
  return { problemes: [], montant: canonique, excedent: excedent.greaterThan(0) ? excedent.toFixed() : "0" };
}

function problemesDateCanal(saisie: { date: DateIso; canal: string; reference: string }, aujourdhui: DateIso, quoi: string): string[] {
  const p: string[] = [];
  if (!dateValide(saisie.date)) p.push(`Date du ${quoi} invalide (AAAA-MM-JJ).`);
  else if (saisie.date > aujourdhui) p.push(`La date du ${quoi} ne peut pas être dans le futur.`);
  if (!estCanalPaiement(saisie.canal)) p.push(`Canal du ${quoi} : espèces, chèque, virement ou Mobile Money.`);
  if (saisie.reference.trim().length > 120) p.push("Référence : 120 caractères au plus.");
  if (saisie.canal !== "ESPECES" && saisie.reference.trim() === "") p.push("La référence de la transaction est obligatoire pour un chèque, un virement ou un paiement Mobile Money.");
  return p;
}

// ------------------------------------------------------------------ Avance sur police (session 6.0, H33)

export type SaisieRestitution = { date: DateIso; montant: string; canal: string; reference: string };

/** Montant d'un débit de l'avance (imputation ou restitution) : > 0, et jamais plus que l'avance disponible (ni le plafond donné). */
function montantDebit(saisi: string, disponible: string, plafond: { valeur: string; message: string } | null): { problemes: string[]; montant: string | null } {
  let canonique: string;
  try {
    canonique = analyserMontant(saisi);
  } catch (erreur) {
    return { problemes: [erreur instanceof ErreurCalcul ? erreur.message : "Montant invalide."], montant: null };
  }
  const m = montant(canonique);
  if (!m.greaterThan(0)) return { problemes: ["Le montant doit être supérieur à 0."], montant: null };
  if (m.greaterThan(montant(disponible))) return { problemes: [`Le montant (${canonique} F) dépasse l'avance disponible de la police (${montant(disponible).toFixed()} F).`], montant: null };
  if (plafond && m.greaterThan(montant(plafond.valeur))) return { problemes: [plafond.message], montant: null };
  return { problemes: [], montant: canonique };
}

/** Restitution de tout ou partie de l'avance : date, montant, canal, référence (pas de nouveau type de document, H74). */
export function controlerRestitution(saisie: SaisieRestitution, disponible: string, aujourdhui: DateIso): { problemes: string[]; montant: string | null } {
  const debit = montantDebit(saisie.montant, disponible, null);
  const p = [...debit.problemes, ...problemesDateCanal(saisie, aujourdhui, "remboursement")];
  return { problemes: p, montant: p.length === 0 ? debit.montant : null };
}

/** Imputation de l'avance sur une facture émise et en cours de la même police, au plus son restant dû. */
export function controlerImputation(saisi: string, disponible: string, facture: { statut: StatutFacture; type: TypeFacture; restantDu: string }): { problemes: string[]; montant: string | null } {
  if (facture.type === "AVOIR" || facture.statut !== "EMISE") return { problemes: ["L'avance ne s'impute que sur une facture émise et en cours."], montant: null };
  return montantDebit(saisi, disponible, { valeur: facture.restantDu, message: `L'imputation ne peut pas dépasser le restant dû de la facture (${montant(facture.restantDu).toFixed()} F).` });
}

/** Imputation proposée : le plus petit de l'avance disponible et du restant dû (0 : rien à proposer). */
export function imputationProposee(disponible: string, restantDu: string): string {
  const plusPetit = montant(disponible).lessThan(montant(restantDu)) ? montant(disponible) : montant(restantDu);
  return plusPetit.greaterThan(0) ? plusPetit.toFixed() : "0";
}
