import type { ReactNode } from "react";

import type { ComposanteFigee } from "@/domaine/calcul/composition";

/**
 * Sous-lignes des composantes d'une garantie au barème (H173) : sous la ligne « Vol », une sous-ligne par composante souscrite (libellé, montant garanti,
 * prime nette), sans accessoires ni taxe (ils restent sur la ligne de la garantie). Commun à la fiche de cotation, au résultat du calcul et à la facture.
 * Sans `"use client"` : un composant serveur peut appeler ces fonctions.
 */

/** Composantes à montrer sous la ligne d'une garantie : une garantie à une seule composante (ou sans détail) n'a pas de sous-ligne. */
export const composantesAMontrer = (composantes: readonly ComposanteFigee[] | null | undefined): readonly ComposanteFigee[] => (composantes && composantes.length > 1 ? composantes : []);

/** Libellé d'une sous-ligne : en retrait, d'un ton plus discret (contraste AA sur fond blanc comme sur `bg-muted`), annoncé comme composante de la ligne au-dessus. */
export function libelleSousLigne(libelle: string): ReactNode {
  return (
    <span className="pl-4 text-neutral">
      <span className="sr-only">Composante : </span>
      {libelle}
    </span>
  );
}

/** Montant d'une sous-ligne : même ton discret que son libellé. */
export const montantSousLigne = (texte: string): ReactNode => <span className="text-neutral">{texte}</span>;
