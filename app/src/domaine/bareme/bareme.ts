import { joursCouverts, type AssietteTaxe, type RegleArrondi } from "../calcul/calcul";
import { VERSION_COMPOSITION, composer, type EntreeComposition, type LigneDePrime } from "../calcul/composition";
import type { DateIso } from "../calcul/dates";
import { DecimalMontant, type Montant } from "../calcul/montant";
import { Contexte } from "./contexte";
import { ErreurBareme, type Refus } from "./erreurs";
import { calculerGarantie, type DetailGarantie } from "./garantie";
import { Evaluateur } from "./operandes";
import type { Bareme, Saisie, SousJacent } from "./schema";

/** Règles du produit que le barème ne porte pas : arrondi, prorata, période, taux de taxe par catégorie. */
export type ParametresBareme = {
  arrondi: RegleArrondi;
  /** Prorata temporis du produit (actif ou non) : jours inclus / 365, comme le mode formule. */
  prorata: { actif: boolean };
  dateEffet: DateIso;
  dateEcheance: DateIso;
  /** Taux de taxe en vigueur par catégorie de taxe (`produit.taxe`, `garantie.taxe`). */
  taxes: Record<string, { tauxPourcent: string; assiette: AssietteTaxe }>;
};

export type ResultatBareme =
  | { ok: true; lignes: LigneDePrime[]; detail: DetailGarantie[]; coefProrata: Montant }
  | { ok: false; refus: Refus[] };

type ControleE4 = Extract<SousJacent, { effet: "E4" }>;

/** Vrai si le contrôle E4 se déclenche (la saisie est refusée). */
function declenche(s: ControleE4, ctx: Contexte, ev: Evaluateur): boolean {
  const q = s.quand;
  if (Array.isArray(q)) {
    const [op, a, b] = q;
    const x = ev.evaluer(a);
    const y = ev.evaluer(b);
    return { ">": x.gt(y), ">=": x.gte(y), "<": x.lt(y), "<=": x.lte(y), "=": x.eq(y), "!=": !x.eq(y) }[op];
  }
  return ctx.evaluerSi(q);
}

/** Un refus du barème est rassemblé ; toute autre erreur (bogue) remonte telle quelle, jamais avalée. */
const enRefus = (e: unknown): Refus => {
  if (e instanceof ErreurBareme) return e.versRefus();
  throw e;
};

/**
 * Calcul d'un barème pour une saisie, dans l'ordre du socle §6 : (1) contrôle des champs ; (2) valeurs intermédiaires ; (3) pour chaque
 * garantie souscrite : assiette → taux → coefficients → minimum → effectif → réduction → prorata → accessoires ; (4) contrôles E4 ;
 * (5) lignes de composition. Les refus sont rassemblés. Taxe, arrondi et TTC restent à `composer()` (voir `versComposition`).
 */
export function calculerBareme(bareme: Bareme, saisie: Saisie, parametres: ParametresBareme): ResultatBareme {
  const ctx = new Contexte(bareme, saisie);
  const refusSaisie = ctx.controlerSaisie();
  if (refusSaisie.length > 0) return { ok: false, refus: refusSaisie };

  const ev = new Evaluateur(ctx);
  const refus: Refus[] = [];
  const attrape = (f: () => void) => {
    try {
      f();
    } catch (e) {
      refus.push(enRefus(e));
    }
  };

  for (const i of bareme.intermediaires) attrape(() => ev.valeurIntermediaire(i.code));
  if (refus.length > 0) return { ok: false, refus };

  const souscrites = bareme.garanties.filter((g) => ctx.garantieSouscrite(g));
  if (souscrites.length === 0) return { ok: false, refus: [{ code: "AUCUNE_GARANTIE", message: "Aucune garantie n'est souscrite." }] };

  const jours = joursCouverts(parametres.dateEffet, parametres.dateEcheance);
  const contratCompte = { fait: false };
  const detail: DetailGarantie[] = [];
  for (const g of souscrites) attrape(() => detail.push(calculerGarantie(bareme, g, ctx, ev, { prorata: parametres.prorata, jours }, contratCompte)));

  for (const s of bareme.sousJacents) {
    if (s.effet !== "E4") continue;
    attrape(() => {
      if (declenche(s, ctx, ev)) refus.push({ code: "CONTROLE", message: s.message });
    });
  }
  if (refus.length > 0) return { ok: false, refus };

  const lignes: LigneDePrime[] = detail.map((d) => {
    const g = bareme.garanties.find((x) => x.code === d.code)!;
    return {
      libelle: d.nom,
      branche: g.taxe ?? bareme.produit.taxe,
      montantGaranti: d.montantGaranti.toFixed(),
      primeNette: d.primeNette.toFixed(),
      accessoires: d.accessoires.toFixed(),
    };
  });
  const coefProrata = parametres.prorata.actif ? new DecimalMontant(Math.min(jours, 365)).div(365) : new DecimalMontant(1);
  return { ok: true, lignes, detail, coefProrata };
}

/**
 * Entrée de `composer()` pour les lignes d'un barème : même résolution de la taxe et même arrondi que la composition manuelle
 * (A8 : règles d'arrondi du produit). Une catégorie de taxe sans taux est un refus.
 */
export function versComposition(lignes: LigneDePrime[], parametres: ParametresBareme): EntreeComposition {
  return {
    type: "COMPOSITION",
    version: VERSION_COMPOSITION,
    dateEffet: parametres.dateEffet,
    dateEcheance: parametres.dateEcheance,
    arrondi: parametres.arrondi,
    lignes: lignes.map((l) => {
      const t = parametres.taxes[l.branche];
      if (!t) throw new ErreurBareme("TAXE_INCONNUE", `Aucun taux de taxe pour la catégorie « ${l.branche} » (garantie « ${l.libelle} »).`);
      return { ...l, tauxPourcent: t.tauxPourcent, assiette: t.assiette };
    }),
  };
}

/** Lignes de prime du barème → montants (nette, accessoires, taxe, TTC par ligne et au total). */
export const composerBareme = (lignes: LigneDePrime[], parametres: ParametresBareme) => composer(versComposition(lignes, parametres));
