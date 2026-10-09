/**
 * Tâches d'une police après un import en masse (H64, décision de Thierry du 09/10/2026). Pas d'émission automatique :
 * l'import crée deux tâches visibles sur la police, qui restent affichées jusqu'à l'émission de la pièce. Règle PURE :
 * l'état d'une tâche se déduit des pièces émises, il n'est jamais stocké.
 */

export const TYPES_TACHE = ["CP_A_EMETTRE", "FACTURE_AVENANT_A_EMETTRE"] as const;
export type TypeTache = (typeof TYPES_TACHE)[number];

export const LIBELLE_TACHE: Record<TypeTache, string> = {
  CP_A_EMETTRE: "Nouvelle version des CP à émettre",
  FACTURE_AVENANT_A_EMETTRE: "Facture d'avenant à émettre",
};

export type Tache = { id: number; type: TypeTache; versionAdherents: number; creeLe: Date; creePar: string; lotId: number | null };

/** Tâche telle que l'écran l'affiche. */
export type TacheLue = Tache & { libelle: string };

/** Pièces émises de la police, telles que la base les donne. */
export type PiecesEmises = {
  /** Liste des adhérents reprise par chaque version des CP émise (null : contrat sans liste). */
  cpVersionsAdherents: readonly (number | null)[];
  /** Versions de la liste facturées par une facture d'avenant ÉMISE (numéro attribué, même annulée ensuite par un avoir). */
  avenantsEmis: readonly (number | null)[];
};

/**
 * Une tâche est ouverte tant que sa pièce n'est pas émise :
 * - CP : aucune version des CP émise ne reprend la liste de l'import ou une liste plus récente ;
 * - facture d'avenant : aucune facture d'avenant émise pour cette version de la liste (un brouillon ou une facture
 *   « À valider » ne ferme pas la tâche).
 */
export function estOuverte(t: Pick<Tache, "type" | "versionAdherents">, pieces: PiecesEmises): boolean {
  if (t.type === "CP_A_EMETTRE") return !pieces.cpVersionsAdherents.some((v) => v !== null && v >= t.versionAdherents);
  return !pieces.avenantsEmis.includes(t.versionAdherents);
}

export const tachesOuvertes = <T extends Pick<Tache, "type" | "versionAdherents">>(taches: readonly T[], pieces: PiecesEmises): T[] => taches.filter((t) => estOuverte(t, pieces));
