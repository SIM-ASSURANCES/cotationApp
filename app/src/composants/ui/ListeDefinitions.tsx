import type { ReactNode } from "react";

import { cx } from "./classes";

export type ElementDefinition = { libelle: string; valeur: ReactNode };

/**
 * Fiche « libellé : valeur » (en-tête d'un document, caractéristiques d'une police) : une liste de définitions accessible,
 * sur une ou deux colonnes. Une valeur vide s'écrit « — ».
 */
export function ListeDefinitions({ elements, colonnes = 2, className }: { elements: ElementDefinition[]; colonnes?: 1 | 2; className?: string }) {
  return (
    <dl className={cx("grid gap-x-8 gap-y-2 text-sm", colonnes === 2 && "sm:grid-cols-2", className)}>
      {elements.map((e) => (
        <div key={e.libelle} className="flex flex-wrap gap-x-1.5">
          <dt className="font-semibold text-foreground">{e.libelle} :</dt>
          <dd className="min-w-0 text-foreground">{e.valeur === null || e.valeur === undefined || e.valeur === "" ? "—" : e.valeur}</dd>
        </div>
      ))}
    </dl>
  );
}
