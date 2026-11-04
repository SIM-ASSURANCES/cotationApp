/**
 * Choix du produit d'une nouvelle cotation (D63) : d'abord la branche principale, puis un produit de cette branche. Fonctions pures ;
 * aucun droit ni règle métier ici (la liste des produits proposés est celle que l'écran avait déjà, le filtre ne retire rien d'autre
 * que les produits d'une autre branche).
 */
export type ProduitProposable = { code: string; libelle: string; branchePrincipale: string | null; branchePrincipaleLibelle: string | null };

/** Valeur de la liste des branches pour les produits qui n'ont pas encore de branche principale (produits antérieurs à D37). */
export const SANS_BRANCHE = "__sans_branche__";
export const LIBELLE_SANS_BRANCHE = "Sans branche principale (à renseigner)";

export type BrancheProposable = { code: string; libelle: string; produits: number };

const cleBranche = (p: ProduitProposable): string => (p.branchePrincipale ? p.branchePrincipale : SANS_BRANCHE);

/** Branches qui ont au moins un produit proposable, par libellé ; les produits sans branche forment une dernière entrée. */
export function branchesDesProduits(produits: readonly ProduitProposable[]): BrancheProposable[] {
  const parCode = new Map<string, BrancheProposable>();
  for (const p of produits) {
    const code = cleBranche(p);
    const existante = parCode.get(code);
    if (existante) existante.produits += 1;
    else parCode.set(code, { code, libelle: code === SANS_BRANCHE ? LIBELLE_SANS_BRANCHE : (p.branchePrincipaleLibelle ?? code), produits: 1 });
  }
  const toutes = [...parCode.values()];
  const avec = toutes.filter((b) => b.code !== SANS_BRANCHE).sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
  return [...avec, ...toutes.filter((b) => b.code === SANS_BRANCHE)];
}

/** Produits d'une branche, par code. Branche vide ou inconnue : aucun produit (on choisit la branche d'abord). */
export function produitsDeLaBranche(produits: readonly ProduitProposable[], branche: string): ProduitProposable[] {
  if (branche === "") return [];
  return produits.filter((p) => cleBranche(p) === branche).sort((a, b) => a.code.localeCompare(b.code, "fr"));
}
