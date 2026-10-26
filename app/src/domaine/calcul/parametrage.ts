import { MODES_ACCESSOIRE, NIVEAUX_ARRONDI, COMPOSANTES, ASSIETTES_TAXE, type AssietteTaxe, type ModeAccessoire, type RegleArrondi } from "./calcul";
import { dateValide, type DateIso } from "./dates";
import { PRECISIONS, SENS_ARRONDI, montant } from "./montant";
import { NOMBRE_MAX_TRANCHES } from "./echeancier";
import { REGIMES_TAXE, type TypeContrat } from "./taxes";

/**
 * Paramétrage produit et taxes (CDC §7, §8.3). Ces types décrivent ce qu'un administrateur saisit ;
 * les montants sont des TEXTES décimaux (« 93581.33 »), jamais des nombres à virgule.
 * Une version de produit est HISTORISÉE : on ne modifie jamais une version, on en ajoute une
 * avec une nouvelle date d'effet (un changement de taux ne touche pas les documents déjà émis).
 */

export type FormuleSaisie = {
  code: string;
  libelle: string;
  /** Taux de couverture en % (ex. 80 pour RELAXSANTE 80 %), facultatif. */
  tauxCouverture: string | null;
  primeUnitaire: string;
  accessoireMode: ModeAccessoire;
  accessoireValeur: string;
  /**
   * Âges limites de la formule, en années révolues (session 5a : contrôle de l'import en masse, H62). Facultatifs :
   * absents ou null, aucune limite. Les valeurs sont celles de la Technique, saisies dans le paramétrage.
   */
  ageMin?: number | null;
  ageMax?: number | null;
};

export const AGE_MAXIMAL = 120;

/**
 * Cinq branches principales de classement des produits (session SECURPRO, D37, H105).
 * Distinctes des branches fiscales (catégories de taxe par ligne de prime). Un code ne change plus une fois en production.
 */
export const BRANCHES_PRINCIPALES = [
  { code: "MALADIE", libelle: "Maladie" },
  { code: "ACCIDENTS_CORPORELS", libelle: "Accidents corporels" },
  { code: "RECOLTE", libelle: "Récolte" },
  { code: "DECES", libelle: "Décès" },
  { code: "INCENDIE_DOMMAGES", libelle: "Incendie et dommages aux biens" },
] as const;

export type CodeBranchePrincipale = (typeof BRANCHES_PRINCIPALES)[number]["code"];

export const CODES_BRANCHES_PRINCIPALES: readonly CodeBranchePrincipale[] = BRANCHES_PRINCIPALES.map((b) => b.code);

export function estBranchePrincipaleValide(code: string | null | undefined): code is CodeBranchePrincipale {
  return typeof code === "string" && (CODES_BRANCHES_PRINCIPALES as readonly string[]).includes(code);
}

export function libelleBranchePrincipale(code: string | null | undefined): string | null {
  if (!code) return null;
  return BRANCHES_PRINCIPALES.find((b) => b.code === code)?.libelle ?? null;
}

/**
 * Mode de tarification d'une version de produit (session 6.2a).
 *  - FORMULE : prime unitaire × effectif × prorata (T1, T2, T3), calcul automatique ;
 *  - GARANTIES : une prime par garantie, que le moteur ne sait pas calculer ; la prime est composée par la Technique ;
 *  - BAREME (session B3, D48) : mode cible ; la prime vient du barème publié de la version (domaine/bareme). Tant que les cotations
 *    ne le lisent pas (B6), ni le calcul automatique ni la composition manuelle ne l'acceptent : refus, jamais de montant.
 */
export const MODES_TARIFICATION = ["FORMULE", "GARANTIES", "BAREME"] as const;
export type ModeTarification = (typeof MODES_TARIFICATION)[number];

/** Refus du calcul automatique d'un produit tarifé par garanties. Texte fixé par la Technique et Thierry (6.2a). */
export const MESSAGE_TARIFICATION_PAR_GARANTIES = "Ce produit se tarifie par garanties : la prime doit être composée par la Technique (composition manuelle)";

/**
 * Le moteur ne calcule que le mode FORMULE. Tout autre mode, y compris une valeur inconnue, est refusé :
 * dans le doute, on ne sort jamais de montant (« jamais de 0 silencieux »).
 */
export const calculAutomatiquePossible = (mode: string): boolean => mode === "FORMULE";

/**
 * La composition manuelle de la prime (session 6.2b) n'existe que pour le mode GARANTIES, et seulement pour lui : la chaîne exacte,
 * comme pour `calculAutomatiquePossible` (une valeur inconnue n'est ni calculée ni composée).
 */
export const compositionPossible = (mode: string): boolean => mode === "GARANTIES";

/** Brouillon préparé avec des formules, que son produit a quittées pour le mode par garanties (session 6.2b) : il ne se convertit pas, on le recrée. */
export const MESSAGE_BROUILLON_A_FORMULES =
  "Ce produit se tarife désormais par garanties : ce brouillon, préparé avec des formules, ne peut plus être modifié ni soumis ; créez une nouvelle cotation, dont la Technique composera la prime";

/**
 * Refus pour un produit au barème (H139, B9) : une version n'est en mode BAREME que si son barème est publié (déclencheur de la base) ;
 * ni le calcul automatique ni la composition manuelle ne le lisent tant que les cotations ne sont pas branchées (session B6).
 */
export const MESSAGE_TARIFICATION_AU_BAREME = "Barème publié pour cette version : le calcul de la prime au barème n'est pas encore ouvert aux cotations (ni calcul automatique, ni composition manuelle)";

/** Refus de la composition manuelle pour un produit à la formule (le tarif existe : la Technique ne compose pas la prime). */
export const MESSAGE_COMPOSITION_IMPOSSIBLE = "Ce produit se tarifie à la formule : la prime se calcule, elle ne se compose pas";

/**
 * Renouvellement et incorporation d'adhérents d'une police dont la prime a été composée (session 6.2b, H90) : non pris en charge. La
 * composition d'une nouvelle période, ou d'un avenant, est une décision de Thierry et de la Technique ; en attendant, jamais de montant
 * recopié ou recalculé en silence.
 */
export const MESSAGE_RENOUVELLEMENT_GARANTIES =
  "Le renouvellement d'une police d'un produit tarifé par garanties n'est pas encore pris en charge : la composition de la nouvelle période n'est pas gérée";
export const MESSAGE_AVENANT_GARANTIES =
  "L'incorporation d'adhérents dans une police d'un produit tarifé par garanties n'est pas encore facturée automatiquement : la prime d'un avenant à garanties n'est pas gérée";

/**
 * Une garantie paramétrée du produit : son libellé, la catégorie de taxe proposée, le montant garanti par défaut (capital ou 1er risque,
 * en FCFA, ≥ 0, facultatif : vide/null pour une garantie sans capital) et les accessoires par défaut (en FCFA, ≥ 0).
 */
export type GarantieParametree = {
  libelle: string;
  branche: string | null;
  montantGaranti?: string | null;
  accessoires?: string | null;
};

export type VersionSaisie = {
  dateEffet: DateIso;
  arrondi: RegleArrondi;
  prorata: { actif: boolean; primeMinimale: string | null };
  fractionnement: {
    tranchesMax: number;
    /** Répartition en % utilisée quand le nombre de tranches choisi lui est égal. */
    repartitionPourcent: string[] | null;
    decalagesMois: number[] | null;
    frais: string;
  };
  /** Validité en MOIS à partir de la date d'établissement (T1 : « date + 3 mois »). */
  cotation: { validiteMois: number; formulesMax: number };
  /** Seuil de TTC au-dessus duquel la double validation est exigée (CDC §4.1). */
  seuilValidationTtc: string | null;
  /** Mode de tarification (session 6.2a). Absent : FORMULE, le comportement d'avant. */
  modeTarification?: ModeTarification;
  /** Garanties du produit proposées à la composition de la prime (session 6.2b, mode GARANTIES). Absent ou vide : saisie libre. */
  garanties?: GarantieParametree[];
  /** Faux : la composition n'accepte que les libellés de `garanties`. Absent : vrai. */
  garantiesSaisieLibre?: boolean;
  /** Mode GARANTIES : les formules sont facultatives (la prime ne vient pas d'un tarif) ; mode FORMULE : au moins une. */
  formules: FormuleSaisie[];
  /**
   * Références contractuelles (CDC §7) : modèle de CS joint au contrat et visa cité dans les CP (contrôle bloquant, §6.8).
   * Les CG ne sont plus au produit : elles viennent de sa branche principale (étape 6, D42).
   */
  references?: ReferencesContractuelles;
};

export type ReferencesContractuelles = { csModeleCode: string | null; csVisa: string | null };

export type TaxeSaisie = {
  branche: string;
  /** null : tous types de contrat (D18). */
  typeContrat: TypeContrat | null;
  /** null seulement pour une ligne à taux mixte. */
  tauxPourcent: string | null;
  /** Plusieurs taux dans un même contrat (incendie / dommages aux biens) : le moteur refuse le calcul. */
  tauxMixte: boolean;
  /** Précision libre (par exemple les taux d'une ligne mixte). */
  commentaire: string | null;
  assiette: AssietteTaxe;
  dateEffet: DateIso;
  dateFin: DateIso | null;
};

const CODE = /^[A-Z0-9][A-Z0-9_]{0,29}$/;

function montantPositifOuNul(texte: string | null, nom: string, problemes: string[], plafond?: number): void {
  if (texte === null) {
    return;
  }
  try {
    const m = montant(texte);
    if (m.isNegative() || (plafond !== undefined && m.greaterThan(plafond))) {
      problemes.push(`${nom} doit être compris entre 0 et ${plafond ?? "l'infini"}.`);
    }
  } catch (erreur) {
    // Message de l'analyseur unique : il dit pourquoi (« point et virgule mélangés »…).
    problemes.push(`${nom} n'est pas un nombre valide : ${erreur instanceof Error ? erreur.message : ""}`);
  }
}

export function codeValide(code: string): boolean {
  return CODE.test(code);
}

/** Liste des problèmes d'une version saisie (vide si elle est valide). */
export function problemesVersion(v: VersionSaisie): string[] {
  const p: string[] = [];
  const r = v.references;
  if (r) {
    for (const [code, visa, quoi] of [[r.csModeleCode, r.csVisa, "conventions spéciales"]] as const) {
      if ((code === null) !== (visa === null)) p.push(`Références des ${quoi} : le code du modèle et le visa vont ensemble.`);
      if (code !== null && !/^[A-Z0-9_-]{2,60}$/.test(code)) p.push(`Code du modèle des ${quoi} invalide.`);
      if (visa !== null && (visa.trim().length < 3 || visa.length > 120)) p.push(`Visa des ${quoi} invalide (3 à 120 caractères).`);
    }
  }
  if (!dateValide(v.dateEffet)) p.push("La date d'effet est invalide.");
  if (v.modeTarification !== undefined && !MODES_TARIFICATION.includes(v.modeTarification)) p.push("Le mode de tarification est invalide (par formule, par garanties ou au barème).");
  if (!PRECISIONS.includes(v.arrondi.precision)) p.push("La précision d'arrondi doit être 1, 10, 100 ou 1 000.");
  if (!SENS_ARRONDI.includes(v.arrondi.sens)) p.push("Le sens d'arrondi est invalide.");
  if (!NIVEAUX_ARRONDI.includes(v.arrondi.niveau)) p.push("Le niveau d'arrondi est invalide.");
  if (!COMPOSANTES.includes(v.arrondi.composanteAbsorbante)) p.push("La composante absorbant l'écart d'arrondi est invalide.");
  montantPositifOuNul(v.prorata.primeMinimale, "La prime minimale", p);
  montantPositifOuNul(v.fractionnement.frais, "Les frais de fractionnement", p);
  montantPositifOuNul(v.seuilValidationTtc, "Le seuil de validation", p);
  const { tranchesMax, repartitionPourcent, decalagesMois } = v.fractionnement;
  if (!Number.isInteger(tranchesMax) || tranchesMax < 1 || tranchesMax > NOMBRE_MAX_TRANCHES) {
    p.push(`Le nombre maximal de tranches doit être un entier de 1 à ${NOMBRE_MAX_TRANCHES}.`);
  }
  if (repartitionPourcent) {
    try {
      if (!repartitionPourcent.map(montant).reduce((s, x) => s.plus(x), montant("0")).eq(100)) {
        p.push("La répartition du fractionnement doit totaliser exactement 100 %.");
      }
      if (repartitionPourcent.length > tranchesMax) p.push("La répartition compte plus de tranches que le maximum autorisé.");
    } catch {
      p.push("La répartition du fractionnement contient un nombre invalide.");
    }
  }
  if (decalagesMois && (decalagesMois.length > tranchesMax || decalagesMois.some((m, i) => !Number.isInteger(m) || m < 0 || (i > 0 && m <= decalagesMois[i - 1])))) {
    p.push("Les décalages en mois doivent être des entiers croissants, au plus un par tranche autorisée.");
  }
  if (!Number.isInteger(v.cotation.validiteMois) || v.cotation.validiteMois < 1 || v.cotation.validiteMois > 60) {
    p.push("La validité de la cotation doit être de 1 à 60 mois.");
  }
  if (!Number.isInteger(v.cotation.formulesMax) || v.cotation.formulesMax < 1 || v.cotation.formulesMax > 10) {
    p.push("Le nombre maximal de formules comparées doit être de 1 à 10.");
  }
  const parGaranties = v.modeTarification === "GARANTIES" || v.modeTarification === "BAREME"; // pas de tarif unitaire : formules facultatives
  if (v.formules.length === 0 && !parGaranties) p.push("Un produit doit avoir au moins une formule.");
  // Mode par garanties (session 6.2b) : pas de frais de fractionnement automatiques (taux de taxe ambigu avec plusieurs branches : ils se
  // saisissent comme une ligne de prime) ; liste des garanties du produit contrôlée ; elle n'a pas de sens à la formule.
  if (parGaranties && montant(v.fractionnement.frais || "0").greaterThan(0)) {
    p.push("Mode par garanties : les frais de fractionnement ne s'ajoutent pas automatiquement, saisissez-les comme une ligne de prime.");
  }
  const garanties = v.garanties ?? [];
  if (!parGaranties && (garanties.length > 0 || v.garantiesSaisieLibre === false)) p.push("La liste des garanties n'a de sens qu'en mode par garanties.");
  if (garanties.length > 30) p.push("Au plus 30 garanties par produit.");
  const libellesVus = new Set<string>();
  for (const g of garanties) {
    const libelle = g.libelle.trim();
    if (libelle === "" || libelle.length > 100) p.push("Une garantie a un libellé de 1 à 100 caractères.");
    else if (libellesVus.has(libelle.toLowerCase())) p.push(`Garantie « ${libelle} » en double.`);
    libellesVus.add(libelle.toLowerCase());
    if (g.branche !== null && !codeValide(g.branche)) p.push(`Garantie « ${libelle} » : code de branche invalide.`);
    if (g.montantGaranti !== undefined && g.montantGaranti !== null && g.montantGaranti.trim() !== "") {
      montantPositifOuNul(g.montantGaranti, `Garantie « ${libelle} » : le montant garanti par défaut`, p);
    }
    if (g.accessoires !== undefined && g.accessoires !== null && g.accessoires.trim() !== "") {
      montantPositifOuNul(g.accessoires, `Garantie « ${libelle} » : les accessoires par défaut`, p);
    }
  }
  if (parGaranties && v.garantiesSaisieLibre === false && garanties.length === 0) p.push("La saisie libre est interdite : la liste des garanties du produit ne peut pas être vide.");
  const codes = new Set<string>();
  for (const f of v.formules) {
    const nom = `Formule « ${f.code} »`;
    if (!codeValide(f.code)) p.push(`${nom} : code invalide (majuscules, chiffres et _, 30 caractères au plus).`);
    if (codes.has(f.code)) p.push(`${nom} : code en double.`);
    codes.add(f.code);
    if (f.libelle.trim() === "") p.push(`${nom} : libellé obligatoire.`);
    if (!MODES_ACCESSOIRE.includes(f.accessoireMode)) p.push(`${nom} : mode d'accessoires invalide.`);
    montantPositifOuNul(f.primeUnitaire, `${nom} : la prime unitaire`, p);
    montantPositifOuNul(f.accessoireValeur, `${nom} : la valeur des accessoires`, p, f.accessoireMode === "POURCENT" ? 100 : undefined);
    montantPositifOuNul(f.tauxCouverture, `${nom} : le taux de couverture`, p, 100);
    const ages = [f.ageMin ?? null, f.ageMax ?? null];
    if (ages.some((a) => a !== null && (!Number.isInteger(a) || a < 0 || a > AGE_MAXIMAL))) {
      p.push(`${nom} : les âges limites sont des nombres entiers d'années, de 0 à ${AGE_MAXIMAL}.`);
    } else if (ages[0] !== null && ages[1] !== null && ages[0] > ages[1]) {
      p.push(`${nom} : l'âge minimal dépasse l'âge maximal.`);
    }
  }
  return p;
}

/**
 * Libellés de lignes de prime refusés par la liste des garanties du produit (session 6.2b) : seulement quand la saisie libre est
 * interdite. Sinon la liste n'est qu'une aide à la saisie. Comparaison sans casse ni espaces de bord.
 */
export function problemesLibellesGaranties(version: Pick<VersionSaisie, "garanties" | "garantiesSaisieLibre">, libelles: string[]): string[] {
  if (version.garantiesSaisieLibre !== false) return [];
  const permis = new Set((version.garanties ?? []).map((g) => g.libelle.trim().toLowerCase()));
  return libelles
    .map((l, i) => ({ l: l.trim(), i }))
    .filter(({ l }) => !permis.has(l.toLowerCase()))
    .map(({ l, i }) => `Ligne ${i + 1} : « ${l} » n'est pas une garantie de ce produit (la saisie libre est interdite).`);
}

export function problemesTaxe(t: TaxeSaisie): string[] {
  const p: string[] = [];
  if (!codeValide(t.branche)) p.push("La branche est invalide (majuscules, chiffres et _).");
  // Session 6.0 (H29 fermée) : un taux se rattache à un régime de taxe (Individuel ou Groupe), ou à tous.
  if (t.typeContrat !== null && !(REGIMES_TAXE as readonly string[]).includes(t.typeContrat)) p.push("Le régime de taxe est invalide (Individuel, Groupe, ou tous régimes).");
  if (t.tauxMixte) {
    if (t.tauxPourcent !== null) p.push("Une ligne à taux mixte n'a pas de taux unique : laissez le taux vide et décrivez les taux en commentaire.");
  } else if (t.tauxPourcent === null) {
    p.push("Le taux est obligatoire.");
  } else {
    montantPositifOuNul(t.tauxPourcent, "Le taux", p, 100);
  }
  if (t.commentaire !== null && t.commentaire.length > 300) p.push("Le commentaire est trop long (300 caractères au plus).");
  if (!ASSIETTES_TAXE.includes(t.assiette)) p.push("L'assiette est invalide.");
  if (!dateValide(t.dateEffet)) p.push("La date d'effet est invalide.");
  if (t.dateFin !== null && (!dateValide(t.dateFin) || t.dateFin < t.dateEffet)) p.push("La date de fin est invalide ou antérieure à la date d'effet.");
  return p;
}

/** Version en vigueur à une date : la plus récente dont la date d'effet n'est pas postérieure. */
export function enVigueur<T extends { dateEffet: DateIso }>(versions: T[], date: DateIso): T | null {
  return versions.filter((v) => v.dateEffet <= date).sort((a, b) => (a.dateEffet < b.dateEffet ? 1 : -1))[0] ?? null;
}
