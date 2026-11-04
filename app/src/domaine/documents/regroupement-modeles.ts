/**
 * Regroupement des modèles par branche puis par produit (D63) : un produit = ses modèles déposés ET ceux qui manquent (cotation, CP,
 * certificat). Fonctions pures, génériques : aucun droit ni règle de publication ici, l'écran ne fait que ranger ce que `listerModeles`
 * lui a déjà donné.
 */

/** Les trois modèles que tout produit doit avoir pour émettre ses documents : cotation, conditions particulières, certificat. */
export const TYPES_ATTENDUS_PAR_PRODUIT = [
  { type: "COTATION", libelle: "Cotation" },
  { type: "CP", libelle: "Conditions particulières (CP)" },
  { type: "CERTIFICAT", libelle: "Certificat d'adhésion" },
] as const;

export type ModeleRegroupable = { id: number; type: string; produitCode: string | null; branchePrincipale?: string | null };
export type ProduitRegroupable = { code: string; libelle: string; branchePrincipale: string | null };

export type SlotAttendu<M> = { type: string; libelle: string; modeles: M[] };
export type GroupeProduit<M> = {
  produit: ProduitRegroupable;
  /** Cotation, CP, certificat : les modèles déposés de chaque type, ou aucun (le modèle manque). */
  attendus: SlotAttendu<M>[];
  /** Les autres modèles du produit (facture, reçu, annexe, sous-modèle…). */
  autres: M[];
  /** Nombre de modèles attendus qui manquent (0 à 3). */
  manquants: number;
};
export type GroupeBranche<M> = { branche: string | null; produits: GroupeProduit<M>[]; communs: M[] };

const parCodeProduit = <T extends { code: string }>(a: T, b: T) => a.code.localeCompare(b.code, "fr");

export function groupeDuProduit<M extends ModeleRegroupable>(produit: ProduitRegroupable, modeles: readonly M[]): GroupeProduit<M> {
  const siens = modeles.filter((m) => m.produitCode === produit.code);
  const attendus = TYPES_ATTENDUS_PAR_PRODUIT.map((t) => ({ type: t.type, libelle: t.libelle, modeles: siens.filter((m) => m.type === t.type) }));
  const types = new Set<string>(TYPES_ATTENDUS_PAR_PRODUIT.map((t) => t.type));
  return { produit, attendus, autres: siens.filter((m) => !types.has(m.type)), manquants: attendus.filter((s) => s.modeles.length === 0).length };
}

/**
 * Les modèles d'UNE branche (`null` : sans branche principale), rangés par produit. Tous les produits de la branche figurent, même sans
 * modèle (leurs trois modèles manquent) ; les modèles sans produit de la branche (conditions générales, modèles communs) sont à part.
 * Un modèle d'un produit inconnu de la liste reste visible, dans les communs : rien ne disparaît.
 */
export function regrouperParProduit<M extends ModeleRegroupable>(branche: string | null, produits: readonly ProduitRegroupable[], modeles: readonly M[]): GroupeBranche<M> {
  const dansLaBranche = (b: string | null | undefined) => (b ?? null) === branche;
  const produitsDeLaBranche = produits.filter((p) => dansLaBranche(p.branchePrincipale)).sort(parCodeProduit);
  const codes = new Set(produitsDeLaBranche.map((p) => p.code));
  const deLaBranche = modeles.filter((m) => dansLaBranche(m.branchePrincipale));
  return {
    branche,
    produits: produitsDeLaBranche.map((p) => groupeDuProduit(p, deLaBranche)),
    communs: deLaBranche.filter((m) => m.produitCode === null || !codes.has(m.produitCode)),
  };
}
