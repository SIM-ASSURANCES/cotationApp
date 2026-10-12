import { PastilleStatut } from "@/composants/ui";
import type { StatutAffiche } from "@/domaine/documents/modeles";

/**
 * Les libellés affichés d'une version (« Soumis (à publier) », « Publié, en vigueur »…) sont plus longs que les clés de la table
 * unique des statuts (ui/statuts.tsx) : on lui donne la clé qui fixe le ton, et la pastille écrit le libellé complet.
 * Aucune couleur ici : seulement la correspondance vers la clé de la table.
 */
const CLE_DE_STATUT: Record<StatutAffiche, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis",
  EN_VIGUEUR: "Publié",
  PROGRAMMEE: "Publié",
  REMPLACEE: "Archivé (remplacé)",
};

export function PastilleVersion({ statut, libelle }: { statut: StatutAffiche; libelle: string }) {
  return <PastilleStatut libelle={CLE_DE_STATUT[statut]}>{libelle}</PastilleStatut>;
}
