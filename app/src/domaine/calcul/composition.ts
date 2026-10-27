import {
  arrondirComposants,
  calculer,
  composants,
  joursCouverts,
  somme,
  verifierCoherence,
  type AssietteTaxe,
  type EntreeCalcul,
  type RegleArrondi,
  type ResultatCalcul,
  type ResultatLigne,
} from "./calcul";
import type { Saisie as SaisieBareme } from "../bareme/schema";
import type { DateIso } from "./dates";
import { ErreurCalcul, ZERO, arrondir, montant, DecimalMontant } from "./montant";

/**
 * Composition manuelle de la prime, garantie par garantie (session 6.2b, D32). Pour un produit en mode GARANTIES, la Technique
 * calcule dans son propre simulateur et SAISIT la prime nette et les accessoires de chaque garantie ; le module résout le taux
 * de taxe de la branche de chaque ligne, calcule la taxe, arrondit selon la règle du produit et totalise. Fonctions pures, comme
 * le moteur : mêmes entrées, mêmes montants. Aucun barème, aucune classe de risque, aucun plafond ici : rien n'est calculé à
 * partir d'un capital, d'un taux ‰ ou d'un coefficient.
 *
 * Pas de prorata automatique : les montants saisis sont ceux de la période du contrat (réponse de la Technique sur H2).
 */

/** Ce que la Technique saisit pour une garantie, une surprime ou une majoration (une ligne de prime comme une autre). */
export type LigneDePrime = {
  /** « Incendie », « Vol », « Surprime »… */
  libelle: string;
  /** Code de la branche fiscale de la ligne (INCENDIE, IARD, IA, DECES, SANTE…) : elle choisit le taux de taxe. */
  branche: string;
  /** Montant garanti (capital ou 1er risque, en FCFA, ≥ 0, D37) : facultatif (null ou absent pour une garantie sans capital). */
  montantGaranti?: string | null;
  /** Prime nette HT de la ligne, texte décimal. */
  primeNette: string;
  /** Accessoires de la ligne, texte décimal (« 0 » s'il n'y en a pas). */
  accessoires: string;
};

/** Ligne dont le taux de taxe est résolu : il est FIGÉ avec la composition (T10, jamais recalculé à l'émission). */
export type LigneComposee = LigneDePrime & { tauxPourcent: string; assiette: AssietteTaxe };

export const VERSION_COMPOSITION = 1;
export const MAX_LIGNES_DE_PRIME = 30;
export const LONGUEUR_MAX_LIBELLE_LIGNE = 100;
export const LONGUEUR_MAX_MOTIF_COMPOSITION = 500;
export const LONGUEUR_MIN_MOTIF_COMPOSITION = 3;

/**
 * Barème qui a produit les lignes d'une composition d'origine BAREME (B6a, D51) : la version du produit, l'empreinte du barème publié
 * et la saisie du Commercial, figées avec la cotation. Le barème lui-même n'est jamais relu pour une cotation émise (T10).
 */
export type BaremeFige = { versionId: number; empreinte: string; saisie: SaisieBareme };

/** Entrée de la composition : ce qui est figé avec la cotation, à la place de l'entrée du moteur à la formule. */
export type EntreeComposition = {
  type: "COMPOSITION";
  version: typeof VERSION_COMPOSITION;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  arrondi: RegleArrondi;
  /** Vide : cotation créée par le Commercial, pas encore composée par la Technique. */
  lignes: LigneComposee[];
  /** Absent : composition manuelle de la Technique (GARANTIES). `BAREME` : lignes calculées par le barème publié (`bareme` est alors présent). */
  origine?: "BAREME";
  bareme?: BaremeFige;
};

/** Ce que contient la colonne `donnees_calcul` d'une cotation, d'une police ou d'une facture. */
export type DonneesCalcul = EntreeCalcul | EntreeComposition;

export const estComposition = (donnees: unknown): donnees is EntreeComposition =>
  typeof donnees === "object" && donnees !== null && (donnees as { type?: unknown }).type === "COMPOSITION";

/** Composition calculée par un barème (origine BAREME), par opposition à la composition manuelle de la Technique. */
export const estCompositionBareme = (donnees: unknown): donnees is EntreeComposition & { origine: "BAREME"; bareme: BaremeFige } =>
  estComposition(donnees) && donnees.origine === "BAREME" && donnees.bareme !== undefined;

/** Les trois natures d'un calcul figé, et le mode de tarification de version qui les accepte (D31, D32, D48). */
export type NatureCalcul = "AUTOMATIQUE" | "COMPOSITION" | "BAREME";
export const natureDuCalcul = (donnees: DonneesCalcul): NatureCalcul => (estCompositionBareme(donnees) ? "BAREME" : estComposition(donnees) ? "COMPOSITION" : "AUTOMATIQUE");
export const MODE_DE_LA_NATURE: Record<NatureCalcul, "FORMULE" | "GARANTIES" | "BAREME"> = { AUTOMATIQUE: "FORMULE", COMPOSITION: "GARANTIES", BAREME: "BAREME" };

/** Composition sans aucune ligne : la prime n'est pas encore composée. */
export const estNonComposee = (donnees: DonneesCalcul): boolean => estComposition(donnees) && donnees.lignes.length === 0;

/** Code d'une ligne dans le résultat (« G1 », « G2 »…) : sa position, stable pour une composition figée. */
export const codeDeLigne = (indice: number): string => `G${indice + 1}`;

const CODE_BRANCHE = /^[A-Z0-9][A-Z0-9_]{0,29}$/;

/**
 * Problèmes d'une saisie de lignes de prime (vide si elle est valide). `exiger: false` accepte une composition vide
 * (brouillon « à composer »). La prime nette est strictement positive : une garantie souscrite a une prime, et un zéro
 * saisi par erreur ne doit jamais passer en silence ; les accessoires peuvent valoir zéro. Aucun montant négatif.
 */
export function problemesLignesDePrime(lignes: LigneDePrime[], options: { exiger?: boolean } = {}): string[] {
  const p: string[] = [];
  if (lignes.length === 0) {
    if (options.exiger !== false) p.push("Saisissez au moins une ligne de prime.");
    return p;
  }
  if (lignes.length > MAX_LIGNES_DE_PRIME) p.push(`Au plus ${MAX_LIGNES_DE_PRIME} lignes de prime.`);
  lignes.forEach((l, i) => {
    const nom = `Ligne ${i + 1}`;
    const libelle = l.libelle.trim();
    if (libelle === "") p.push(`${nom} : le libellé de la garantie est obligatoire.`);
    else if (libelle.length > LONGUEUR_MAX_LIBELLE_LIGNE) p.push(`${nom} : libellé trop long (${LONGUEUR_MAX_LIBELLE_LIGNE} caractères au plus).`);
    if (!CODE_BRANCHE.test(l.branche)) p.push(`${nom} : choisissez la branche fiscale de la ligne.`);
    if (l.montantGaranti !== undefined && l.montantGaranti !== null && l.montantGaranti.trim() !== "") {
      try {
        const mg = montant(l.montantGaranti);
        if (mg.isNegative()) p.push(`${nom} (montant garanti) : un montant négatif n'est pas accepté.`);
      } catch (erreur) {
        p.push(`${nom} (montant garanti) : ${erreur instanceof Error ? erreur.message : "montant invalide."}`);
      }
    }
    for (const [valeur, champ, strict] of [[l.primeNette, "prime nette", true], [l.accessoires, "accessoires", false]] as const) {
      try {
        const m = montant(valeur);
        if (m.isNegative()) p.push(`${nom} (${champ}) : un montant négatif n'est pas accepté.`);
        else if (strict && m.isZero()) p.push(`${nom} (${champ}) : la prime nette doit être supérieure à zéro.`);
      } catch (erreur) {
        p.push(`${nom} (${champ}) : ${erreur instanceof Error ? erreur.message : "montant invalide."}`);
      }
    }
  });
  return p;
}

/**
 * Montants d'une composition, dans la même forme que le moteur (`ResultatCalcul`) : chaque ligne devient un « effectif de 1 »
 * dont le code est sa position. Pour chaque ligne : taxe = (nette + accessoires) × taux de la ligne (ou nette seule selon l'assiette
 * du taux), puis arrondi selon la règle du produit ; TTC = nette + accessoires + taxe arrondies, toujours. Les totaux sont la somme
 * des lignes arrondies (niveau « ligne ») ou l'arrondi de la somme exacte (niveau « total »). Le contrôle bloquant du CDC §8.1
 * (TTC = nette + accessoires + taxe) est vérifié par ligne ET au total.
 */
export function composer(entree: EntreeComposition): ResultatCalcul {
  if (entree.version !== VERSION_COMPOSITION) throw new ErreurCalcul(`Version de la composition inconnue : ${String(entree.version)}.`);
  const jours = joursCouverts(entree.dateEffet, entree.dateEcheance);
  const lignes: ResultatLigne[] = entree.lignes.map((l, i) => {
    const nette = montant(l.primeNette);
    const accessoires = montant(l.accessoires);
    const taux = montant(l.tauxPourcent);
    if (nette.isNegative() || accessoires.isNegative()) throw new ErreurCalcul(`Montant négatif refusé pour la ligne ${i + 1}.`);
    if (taux.isNegative() || taux.greaterThan(100)) throw new ErreurCalcul(`Le taux de taxe de la ligne ${i + 1} doit être compris entre 0 et 100 %.`);
    const base = l.assiette === "NETTE_ACCESSOIRES" ? nette.plus(accessoires) : nette;
    const exact = composants(nette, accessoires, base.mul(taux).div(100));
    const arrondi = arrondirComposants(exact, entree.arrondi, 2);
    return {
      code: codeDeLigne(i),
      effectif: 1,
      exact,
      arrondi,
      ttcParUnite: arrondi.ttc,
      primeParUnite: arrondir(nette, entree.arrondi.precision, entree.arrondi.sens),
    };
  });
  const exact = somme(lignes.map((l) => l.exact));
  const arrondi = lignes.length === 0 ? composants(ZERO, ZERO, ZERO) : entree.arrondi.niveau === "LIGNE" ? somme(lignes.map((l) => l.arrondi)) : arrondirComposants(exact, entree.arrondi, 2);
  verifierCoherence(arrondi);
  return { joursCouverts: jours, coefProrata: new DecimalMontant(1), lignes, fraisFractionnement: null, totaux: { exact, arrondi } };
}

/**
 * Taux de taxe unique de la composition, en texte, s'il n'y en a qu'un (toutes les lignes au même taux) ; null s'il y en a plusieurs
 * ou aucune ligne. C'est `prime.taux_taxe` des documents : rempli quand un seul taux s'applique, vide sinon.
 */
export function tauxUnique(lignes: Pick<LigneComposee, "tauxPourcent">[]): string | null {
  if (lignes.length === 0) return null;
  const premier = montant(lignes[0].tauxPourcent);
  return lignes.every((l) => montant(l.tauxPourcent).eq(premier)) ? lignes[0].tauxPourcent : null;
}

/** Les mêmes lignes, sans le taux ni l'assiette : ce que la Technique a réellement saisi. */
export const saisieDesLignes = (lignes: LigneComposee[]): LigneDePrime[] =>
  lignes.map(({ libelle, branche, montantGaranti, primeNette, accessoires }) => ({
    libelle,
    branche,
    ...(montantGaranti !== undefined ? { montantGaranti } : {}),
    primeNette,
    accessoires,
  }));

/**
 * Recalcul à l'identique d'un calcul figé (cotation, police, facture), quelle que soit sa nature : composition manuelle ou calcul
 * automatique. `calculer` n'est jamais appelé directement sur une donnée figée dont on ignore la nature.
 */
export function recalculer(donnees: DonneesCalcul): ResultatCalcul {
  return estComposition(donnees) ? composer(donnees) : calculer(donnees);
}
