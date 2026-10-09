import type { StatutLot } from "@/serveur/imports";

export const LIBELLE_STATUT_LOT: Record<StatutLot, string> = {
  CONTROLE: "Contrôlé, à confirmer",
  EN_COURS: "Traitement en cours",
  TERMINE: "Terminé",
  ABANDONNE: "Abandonné",
};
