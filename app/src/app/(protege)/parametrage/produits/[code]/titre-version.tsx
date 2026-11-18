import type { Instant } from "@/domaine/calcul/dates";
import { titreDeVersionHorodate } from "@/domaine/calcul/parametrage";
import type { VersionProduit } from "@/serveur/parametrage";

/**
 * Titre d'une version sur la fiche du produit (D68) : « En vigueur depuis le JJ/MM/AAAA à HH h MM », « À venir : … », « Remplacée le JJ/MM/AAAA à HH h MM »
 * ou « En préparation : … ». `toutes` : les versions du produit (pour trouver celle qui a remplacé `v`) ; `maintenant` : l'instant présent.
 */
export function TitreDeVersion({ v, toutes, maintenant }: { v: VersionProduit; toutes: readonly VersionProduit[]; maintenant: Instant }) {
  return <h3 className="mb-2 text-base font-bold text-foreground">{titreDeVersionHorodate(v, toutes, maintenant)}</h3>;
}
