import type { ReactNode } from "react";

import { cx } from "./classes";
import { EtatVide } from "./EtatVide";

export type ColonneTableau<T> = {
  cle: string;
  entete: string;
  /** Contenu de la cellule. */
  rendu: (ligne: T) => ReactNode;
  /** `droite` pour un montant ou un nombre : aligné à droite, chiffres tabulaires. */
  alignement?: "gauche" | "droite";
  className?: string;
};

/**
 * Tableau de données : en-tête collant, lignes zébrées discrètes, état vide. Sans tri ni pagination : une page qui en a déjà
 * les garde sous ses propres contrôles. Composant serveur (aucun état) : les fonctions `rendu` viennent de la page qui l'appelle.
 */
export function Tableau<T>({
  colonnes,
  lignes,
  cleLigne,
  messageVide = "Aucune donnée.",
  legende,
}: {
  colonnes: ColonneTableau<T>[];
  lignes: readonly T[];
  cleLigne: (ligne: T) => string;
  messageVide?: string;
  /** Titre du tableau pour les lecteurs d'écran (non affiché). */
  legende?: string;
}) {
  if (lignes.length === 0) {
    return (
      <div className="rounded-md border border-border shadow-elevated">
        <EtatVide message={messageVide} encadre={false} />
      </div>
    );
  }
  return (
    // Région défilante : focalisable au clavier, sinon un tableau plus large que l'écran ne se parcourt pas sans souris.
    <div tabIndex={0} role="region" aria-label={legende ?? "Tableau"} className="max-h-[calc(100vh-14rem)] overflow-auto rounded-md border border-border shadow-elevated">
      <table className="w-full min-w-full border-separate border-spacing-0 text-sm">
        {legende ? <caption className="sr-only">{legende}</caption> : null}
        <thead>
          <tr>
            {colonnes.map((colonne) => (
              <th
                key={colonne.cle}
                scope="col"
                className={cx(
                  "sticky top-0 z-[1] border-b border-border bg-muted px-4 py-2 font-medium text-neutral",
                  colonne.alignement === "droite" ? "text-right" : "text-left",
                  colonne.className,
                )}
              >
                {colonne.entete}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface">
          {lignes.map((ligne) => (
            <tr key={cleLigne(ligne)} className="even:bg-muted/40 hover:bg-muted/60">
              {colonnes.map((colonne) => (
                <td key={colonne.cle} className={cx("border-b border-border px-4 py-2 text-foreground", colonne.alignement === "droite" && "text-right tabular-nums", colonne.className)}>
                  {colonne.rendu(ligne)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
