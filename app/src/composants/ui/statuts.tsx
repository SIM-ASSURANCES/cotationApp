import type { ReactNode } from "react";

import { Pastille, type TonPastille } from "./Pastille";

/**
 * UNE SEULE table de correspondance statut → ton pour tous les écrans métier (décision de la refonte V2). Elle ne connaît que le
 * LIBELLÉ affiché à l'utilisateur, aucune logique métier : un libellé absent de la table est neutre. Le ton ne porte jamais le sens
 * seul : la pastille écrit toujours le libellé.
 */
const TON_PAR_STATUT: Record<string, TonPastille> = {
  // Cotations
  "Brouillon": "neutre",
  "À valider": "avertissement",
  "Émise": "principal",
  "Acceptée": "succes",
  "Refusée": "danger",
  "Expirée": "neutre",
  // Factures, avoirs, échéances
  "Annulée": "danger",
  "Abandonnée": "neutre",
  "Payé": "succes",
  "Partiellement payé": "avertissement",
  "Non payé": "danger",
  // Documents et modèles
  "PDF en attente": "avertissement",
  "Publié": "succes",
  "Soumis": "info",
};

export const tonDuStatut = (libelle: string): TonPastille => TON_PAR_STATUT[libelle] ?? "neutre";

/** Pastille d'un statut métier : le libellé fait foi, le ton vient de la table unique ci-dessus. */
export function PastilleStatut({ libelle, className, children }: { libelle: string; className?: string; children?: ReactNode }) {
  return (
    <Pastille ton={tonDuStatut(libelle)} className={className}>
      {children ?? libelle}
    </Pastille>
  );
}
