import { MODES_ACCESSOIRE, NIVEAUX_ARRONDI, COMPOSANTES, ASSIETTES_TAXE, type AssietteTaxe, type ModeAccessoire, type RegleArrondi } from "./calcul";
import { dateValide, type DateIso } from "./dates";
import { PRECISIONS, SENS_ARRONDI, montant } from "./montant";
import { NOMBRE_MAX_TRANCHES } from "./echeancier";

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
  formules: FormuleSaisie[];
  /**
   * Références contractuelles (CDC §7) : modèle de CG (et de CS) joint au contrat, et visa cité dans
   * les CP. À l'assemblage, ce visa doit être celui des CG jointes (contrôle bloquant, §6.8).
   */
  references?: ReferencesContractuelles;
};

export type ReferencesContractuelles = { cgModeleCode: string | null; cgVisa: string | null; csModeleCode: string | null; csVisa: string | null };

export type TaxeSaisie = {
  branche: string;
  tauxPourcent: string;
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
    for (const [code, visa, quoi] of [[r.cgModeleCode, r.cgVisa, "conditions générales"], [r.csModeleCode, r.csVisa, "conventions spéciales"]] as const) {
      if ((code === null) !== (visa === null)) p.push(`Références des ${quoi} : le code du modèle et le visa vont ensemble.`);
      if (code !== null && !/^[A-Z0-9_-]{2,60}$/.test(code)) p.push(`Code du modèle des ${quoi} invalide.`);
      if (visa !== null && (visa.trim().length < 3 || visa.length > 120)) p.push(`Visa des ${quoi} invalide (3 à 120 caractères).`);
    }
  }
  if (!dateValide(v.dateEffet)) p.push("La date d'effet est invalide.");
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
  if (v.formules.length === 0) p.push("Un produit doit avoir au moins une formule.");
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
  }
  return p;
}

export function problemesTaxe(t: TaxeSaisie): string[] {
  const p: string[] = [];
  if (!codeValide(t.branche)) p.push("La branche est invalide (majuscules, chiffres et _).");
  montantPositifOuNul(t.tauxPourcent, "Le taux", p, 100);
  if (!ASSIETTES_TAXE.includes(t.assiette)) p.push("L'assiette est invalide.");
  if (!dateValide(t.dateEffet)) p.push("La date d'effet est invalide.");
  if (t.dateFin !== null && (!dateValide(t.dateFin) || t.dateFin < t.dateEffet)) p.push("La date de fin est invalide ou antérieure à la date d'effet.");
  return p;
}

/** Version en vigueur à une date : la plus récente dont la date d'effet n'est pas postérieure. */
export function enVigueur<T extends { dateEffet: DateIso }>(versions: T[], date: DateIso): T | null {
  return versions.filter((v) => v.dateEffet <= date).sort((a, b) => (a.dateEffet < b.dateEffet ? 1 : -1))[0] ?? null;
}
