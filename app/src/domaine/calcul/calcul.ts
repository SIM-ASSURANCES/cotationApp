import { ecartEnJours, type DateIso } from "./dates";
import {
  ErreurCalcul,
  ZERO,
  arrondir,
  montant,
  DecimalMontant,
  type EntreeMontant,
  type Montant,
  type Precision,
  type SensArrondi,
} from "./montant";

/**
 * Moteur de calcul des primes (CDC §8). Fonctions pures : mêmes entrées, mêmes montants, sans
 * base de données ni horloge. C'est la SEULE source des montants de l'application (CDC §5).
 * Tout est en décimal exact ; les arrondis sont explicites, jamais laissés au langage.
 */

export const MODES_ACCESSOIRE = ["AUCUN", "FIXE", "PAR_TETE", "PAR_FAMILLE", "POURCENT"] as const;
export type ModeAccessoire = (typeof MODES_ACCESSOIRE)[number];

export const NIVEAUX_ARRONDI = ["LIGNE", "TOTAL"] as const;
export type NiveauArrondi = (typeof NIVEAUX_ARRONDI)[number];

export const COMPOSANTES = ["NETTE", "ACCESSOIRES", "TAXE"] as const;
export type Composante = (typeof COMPOSANTES)[number];

export const ASSIETTES_TAXE = ["NETTE_ACCESSOIRES", "NETTE"] as const;
export type AssietteTaxe = (typeof ASSIETTES_TAXE)[number];

/** Règle d'arrondi d'un produit (CDC §8.5). */
export type RegleArrondi = {
  precision: Precision;
  sens: SensArrondi;
  /** LIGNE : chaque formule est arrondie, le total est leur somme. TOTAL : seul le total est arrondi. */
  niveau: NiveauArrondi;
  /** Composante qui absorbait l'écart quand le TTC était arrondi à part (CDC §8.5). Sans effet depuis la version 2 du moteur (H4, D18). */
  composanteAbsorbante: Composante;
};

export type LigneEntree = {
  code: string;
  /** Prime unitaire annuelle, avec ses décimales (par exemple « 252657.63 »). */
  primeUnitaire: EntreeMontant;
  /** Nombre d'unités vendues : assurés pour une formule « Solo », familles pour « Famille ». */
  effectif: number;
  accessoire: { mode: ModeAccessoire; valeur: EntreeMontant };
};

export type ParametresCalcul = {
  prorata: { actif: boolean; primeMinimale: EntreeMontant | null };
  arrondi: RegleArrondi;
  /** Taux en pourcentage : « 1.5 » pour 1,5 %. */
  taxe: { tauxPourcent: EntreeMontant; assiette: AssietteTaxe };
  /** Frais de fractionnement : ajoutés aux accessoires, donc taxés (CDC §8.4). */
  fraisFractionnement?: EntreeMontant;
};

/**
 * Version des règles du moteur. 1 : règles d'origine (D9). 2 : réponses de la Technique du 08/10/2026
 * (D18) : prorata plafonné à 1 (H3) et TTC = somme des trois montants arrondis (H4). Une entrée sans
 * version est un calcul enregistré avant la session 4.0 : il se refait avec les règles 1, à l'identique
 * de ce qui a été émis (T10). Tout nouveau calcul porte la version courante.
 */
export const VERSION_MOTEUR = 2;
export type VersionMoteur = 1 | 2;

export type EntreeCalcul = {
  /** Absente : version 1 (calcul enregistré avant la session 4.0). */
  moteur?: VersionMoteur;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  lignes: LigneEntree[];
  parametres: ParametresCalcul;
};

export type Composants = { nette: Montant; accessoires: Montant; taxe: Montant; ttc: Montant };

export type ResultatLigne = {
  code: string;
  effectif: number;
  /** Montants avant arrondi. */
  exact: Composants;
  /** Montants arrondis selon la règle du produit ; ttc = nette + accessoires + taxe, toujours. */
  arrondi: Composants;
  /** TTC arrondi divisé par l'effectif, au franc : TTC par personne ou par famille. */
  ttcParUnite: Montant;
  /**
   * Prime de l'unité (une personne, ou une famille) : la prime nette exacte de la ligne, prorata et prime minimale
   * compris, divisée par l'effectif, puis arrondie selon la règle du produit. C'est la valeur de `assures[].prime`
   * des documents : le générateur ne calcule rien.
   */
  primeParUnite: Montant;
};

export type ResultatCalcul = {
  joursCouverts: number;
  /** Jours couverts / 365 si le prorata est actif (plafonné à 1 depuis la version 2), sinon 1. */
  coefProrata: Montant;
  lignes: ResultatLigne[];
  /** Ligne des frais de fractionnement, s'il y en a. */
  fraisFractionnement: ResultatLigne | null;
  totaux: { exact: Composants; arrondi: Composants };
};

export const JOURS_PAR_AN = 365;

/** Jours couverts, bornes incluses : échéance − effet + 1 (CDC §8.2). */
export function joursCouverts(dateEffet: DateIso, dateEcheance: DateIso): number {
  const jours = ecartEnJours(dateEffet, dateEcheance) + 1;
  if (jours < 1) {
    throw new ErreurCalcul("La date d'échéance ne peut pas précéder la date d'effet.");
  }
  return jours;
}

export function composants(nette: Montant, accessoires: Montant, taxe: Montant): Composants {
  return { nette, accessoires, taxe, ttc: nette.plus(accessoires).plus(taxe) };
}

export function somme(liste: Composants[]): Composants {
  return composants(
    liste.reduce((s, c) => s.plus(c.nette), ZERO),
    liste.reduce((s, c) => s.plus(c.accessoires), ZERO),
    liste.reduce((s, c) => s.plus(c.taxe), ZERO),
  );
}

/** Contrôle bloquant du CDC §8.1 : TTC = nette + accessoires + taxe, à 0 F près. */
export function verifierCoherence(c: Composants): void {
  if (!c.ttc.eq(c.nette.plus(c.accessoires).plus(c.taxe))) {
    throw new ErreurCalcul("Contrôle bloquant : le TTC n'est pas égal à nette + accessoires + taxe.");
  }
}

/**
 * Arrondit selon la règle du produit. Version 2 (H4, D18) : la nette, les accessoires et la taxe sont
 * arrondis, et le TTC est LEUR SOMME, jamais un arrondi indépendant. Version 1 (calculs antérieurs) :
 * le TTC était arrondi à part et l'écart absorbé par la composante choisie.
 */
export function arrondirComposants(exact: Composants, regle: RegleArrondi, moteur: VersionMoteur = VERSION_MOTEUR): Composants {
  const { precision, sens } = regle;
  if (moteur === 2) {
    const resultat = composants(arrondir(exact.nette, precision, sens), arrondir(exact.accessoires, precision, sens), arrondir(exact.taxe, precision, sens));
    verifierCoherence(resultat);
    return resultat;
  }
  const ttc = arrondir(exact.ttc, precision, sens);
  const partiel = {
    NETTE: arrondir(exact.nette, precision, sens),
    ACCESSOIRES: arrondir(exact.accessoires, precision, sens),
    TAXE: arrondir(exact.taxe, precision, sens),
  };
  const ecart = ttc.minus(partiel.NETTE).minus(partiel.ACCESSOIRES).minus(partiel.TAXE);
  partiel[regle.composanteAbsorbante] = partiel[regle.composanteAbsorbante].plus(ecart);
  const resultat = { nette: partiel.NETTE, accessoires: partiel.ACCESSOIRES, taxe: partiel.TAXE, ttc };
  verifierCoherence(resultat);
  return resultat;
}

function verifierEntree(entree: EntreeCalcul): { taux: Montant; primeMinimale: Montant | null; frais: Montant } {
  if (entree.lignes.length === 0) {
    throw new ErreurCalcul("Aucune formule à calculer.");
  }
  const codes = new Set<string>();
  for (const ligne of entree.lignes) {
    if (codes.has(ligne.code)) {
      throw new ErreurCalcul(`Formule en double : « ${ligne.code} ».`);
    }
    codes.add(ligne.code);
    if (!Number.isInteger(ligne.effectif) || ligne.effectif < 1) {
      throw new ErreurCalcul(`Effectif invalide pour « ${ligne.code} » : un entier d'au moins 1 est attendu.`);
    }
    if (montant(ligne.primeUnitaire).isNegative() || montant(ligne.accessoire.valeur).isNegative()) {
      throw new ErreurCalcul(`Montant négatif refusé pour « ${ligne.code} ».`);
    }
  }
  const taux = montant(entree.parametres.taxe.tauxPourcent);
  if (taux.isNegative() || taux.greaterThan(100)) {
    throw new ErreurCalcul("Le taux de taxe doit être compris entre 0 et 100 %.");
  }
  const primeMinimale = entree.parametres.prorata.primeMinimale === null ? null : montant(entree.parametres.prorata.primeMinimale);
  const frais = entree.parametres.fraisFractionnement === undefined ? ZERO : montant(entree.parametres.fraisFractionnement);
  if ((primeMinimale && primeMinimale.isNegative()) || frais.isNegative()) {
    throw new ErreurCalcul("Prime minimale et frais de fractionnement ne peuvent pas être négatifs.");
  }
  return { taux, primeMinimale, frais };
}

function taxer(nette: Montant, accessoires: Montant, taux: Montant, assiette: AssietteTaxe): Montant {
  const base = assiette === "NETTE_ACCESSOIRES" ? nette.plus(accessoires) : nette;
  return base.mul(taux).div(100);
}

function accessoiresDe(ligne: LigneEntree, nette: Montant): Montant {
  const valeur = montant(ligne.accessoire.valeur);
  switch (ligne.accessoire.mode) {
    case "AUCUN":
      return ZERO;
    case "FIXE":
      return valeur;
    case "PAR_TETE":
    case "PAR_FAMILLE":
      return valeur.mul(ligne.effectif);
    case "POURCENT":
      return nette.mul(valeur).div(100);
  }
}

function resultatLigne(code: string, effectif: number, exact: Composants, regle: RegleArrondi, moteur: VersionMoteur): ResultatLigne {
  const arrondi = arrondirComposants(exact, regle, moteur);
  return {
    code,
    effectif,
    exact,
    arrondi,
    ttcParUnite: arrondir(arrondi.ttc.div(effectif), 1, "PROCHE"),
    primeParUnite: arrondir(exact.nette.div(effectif), regle.precision, regle.sens),
  };
}

/**
 * Chaîne de calcul complète (CDC §8.1) pour toutes les formules d'une cotation :
 *   nette = prime unitaire × effectif × coef_prorata  (au moins la prime minimale ; coef ≤ 1, H3)
 *   accessoires = fixe | par tête × effectif | par famille × effectif | % × nette
 *   taxe = (nette + accessoires) × taux
 *   arrondis du produit sur la nette, les accessoires et la taxe ; TTC = leur somme (H4).
 */
export function calculer(entree: EntreeCalcul): ResultatCalcul {
  const { taux, primeMinimale, frais } = verifierEntree(entree);
  const { arrondi: regle, prorata, taxe } = entree.parametres;

  const moteur: VersionMoteur = entree.moteur ?? 1;
  if (moteur !== 1 && moteur !== 2) {
    throw new ErreurCalcul(`Version du moteur inconnue : ${String(moteur)}.`);
  }

  const jours = joursCouverts(entree.dateEffet, entree.dateEcheance);
  // H3 (version 2) : une année complète de 366 jours (année bissextile) vaut 1, jamais plus.
  const brut = new DecimalMontant(jours).div(JOURS_PAR_AN);
  const coef = !prorata.actif ? new DecimalMontant(1) : moteur === 2 ? DecimalMontant.min(1, brut) : brut;

  const lignes = entree.lignes.map((ligne) => {
    const proratisee = montant(ligne.primeUnitaire).mul(ligne.effectif).mul(coef);
    const nette = primeMinimale && proratisee.lessThan(primeMinimale) ? primeMinimale : proratisee;
    const accessoires = accessoiresDe(ligne, nette);
    return resultatLigne(
      ligne.code,
      ligne.effectif,
      composants(nette, accessoires, taxer(nette, accessoires, taux, taxe.assiette)),
      regle,
      moteur,
    );
  });

  const fraisLigne = frais.isZero()
    ? null
    : resultatLigne("FRAIS_FRACTIONNEMENT", 1, composants(ZERO, frais, taxer(ZERO, frais, taux, taxe.assiette)), regle, moteur);

  const toutes = fraisLigne ? [...lignes, fraisLigne] : lignes;
  const exact = somme(toutes.map((l) => l.exact));
  // LIGNE : le total est la somme des lignes arrondies. TOTAL : on arrondit seulement la somme exacte.
  const arrondi = regle.niveau === "LIGNE" ? somme(toutes.map((l) => l.arrondi)) : arrondirComposants(exact, regle, moteur);
  verifierCoherence(arrondi);

  return { joursCouverts: jours, coefProrata: coef, lignes, fraisFractionnement: fraisLigne, totaux: { exact, arrondi } };
}
