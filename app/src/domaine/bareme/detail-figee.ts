import { estCompositionBareme, type BaremeFige, type ComposanteFigee, type EntreeComposition, type LigneComposee } from "../calcul/composition";
import { montant } from "../calcul/montant";
import { calculerBareme } from "./bareme";
import type { Bareme } from "./schema";

/**
 * Détail des composantes d'une composition d'origine BAREME (H173, même méthode que D54 / D55).
 *
 * Une cotation enregistrée avant la conservation des composantes n'a ni `code` de garantie ni `composantes` sur ses lignes. Pour les montrer (fiche, facture,
 * documents), on RECALCULE le barème figé (lu par sa version ET son empreinte) sur la saisie figée : calcul pur, rien n'est écrit, aucun montant de la
 * ligne n'est touché. La reconstitution n'est acceptée que si le recalcul retombe sur les lignes figées (libellé, prime nette, accessoires, montant
 * garanti) : sinon (barème différent, règle de calcul changée, saisie illisible) elle est impossible et la ligne s'affiche sans détail.
 */

type CompositionBareme = EntreeComposition & { origine: "BAREME"; bareme: BaremeFige };

/** Les lignes ont-elles déjà leur code et leurs composantes (cotation faite depuis la conservation des composantes) ? */
export const aDejaLeDetail = (lignes: readonly LigneComposee[]): boolean => lignes.every((l) => l.code !== undefined && l.composantes !== undefined);

const memeMontant = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (a == null || b == null) return a == b;
  try {
    return montant(a).eq(montant(b));
  } catch {
    return false;
  }
};

/**
 * Lignes d'une composition au barème, avec `code` et `composantes` : celles qui sont figées, sinon celles du recalcul. `null` quand la reconstitution est
 * impossible. `prorata` est celui de la version du produit figée avec la cotation (le prorata n'est pas figé dans la composition).
 */
export function lignesAvecDetail(bareme: Bareme, composition: CompositionBareme, prorata: { actif: boolean }): LigneComposee[] | null {
  if (aDejaLeDetail(composition.lignes)) return composition.lignes;
  let recalcul;
  try {
    recalcul = calculerBareme(bareme, composition.bareme.saisie, {
      arrondi: composition.arrondi,
      prorata,
      dateEffet: composition.dateEffet,
      dateEcheance: composition.dateEcheance,
      taxes: {},
    });
  } catch {
    return null;
  }
  if (!recalcul.ok || recalcul.lignes.length !== composition.lignes.length) return null;
  const lignes: LigneComposee[] = [];
  for (const [i, figee] of composition.lignes.entries()) {
    const r = recalcul.lignes[i];
    const retombe = figee.libelle === r.libelle && memeMontant(figee.primeNette, r.primeNette) && memeMontant(figee.accessoires, r.accessoires) && memeMontant(figee.montantGaranti, r.montantGaranti);
    if (!retombe) return null;
    lignes.push({ ...figee, code: figee.code ?? r.code, composantes: figee.composantes ?? (r.composantes as ComposanteFigee[]) });
  }
  return lignes;
}

/** La composition avec le détail de ses lignes (figé ou reconstitué) ; la composition telle quelle quand la reconstitution est impossible ou inutile. Rien n'est écrit. */
export function compositionAvecDetail<T>(donnees: T, bareme: Bareme | null, prorata: { actif: boolean }): T {
  if (!estCompositionBareme(donnees) || bareme === null || aDejaLeDetail(donnees.lignes)) return donnees;
  const lignes = lignesAvecDetail(bareme, donnees, prorata);
  return lignes === null ? donnees : ({ ...donnees, lignes } as T);
}
