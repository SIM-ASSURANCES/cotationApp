import type { ReactNode } from "react";

import { Pastille, type TonPastille } from "./Pastille";

/**
 * UNE SEULE table de correspondance statut → ton pour tous les écrans métier (décision de la refonte V2). Elle ne connaît que le
 * LIBELLÉ affiché à l'utilisateur (casse ignorée), aucune logique métier : un libellé absent de la table est neutre. Le ton ne porte jamais le sens
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
  // Ajouts de la V2 (libellés déjà affichés par les écrans, absents de la consigne) : documents émis, lots, éléments de lot, états actif / inactif.
  "Valide": "succes",
  "Terminé": "succes",
  "En cours": "info",
  "Traitement en cours": "info",
  "Contrôlé, à confirmer": "avertissement",
  "Abandonné": "neutre",
  "À faire": "neutre",
  "Produit": "succes",
  "Déjà produit": "neutre",
  "Sans objet": "neutre",
  "En échec": "danger",
  "Active": "succes",
  "Actif": "succes",
  "Désactivée": "neutre",
  "Désactivé": "neutre",
  "Verrouillé": "avertissement",
};

/** Un statut peut porter un complément (« Annulée – avoir AV-2026-10-0001 ») : le ton est celui de son premier mot. */
const TON_SANS_CASSE = new Map(Object.entries(TON_PAR_STATUT).map(([libelle, ton]) => [libelle.toLowerCase(), ton]));
export const tonDuStatut = (libelle: string): TonPastille => TON_SANS_CASSE.get(libelle.trim().toLowerCase()) ?? TON_SANS_CASSE.get(libelle.split(/\s+[–-]\s+/)[0].trim().toLowerCase()) ?? "neutre";

/** Pastille d'un statut métier : le libellé fait foi, le ton vient de la table unique ci-dessus. */
export function PastilleStatut({ libelle, className, children }: { libelle: string; className?: string; children?: ReactNode }) {
  return (
    <Pastille ton={tonDuStatut(libelle)} className={className}>
      {children ?? libelle}
    </Pastille>
  );
}
