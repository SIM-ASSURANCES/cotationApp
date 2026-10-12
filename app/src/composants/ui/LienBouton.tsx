import Link from "next/link";
import type { ComponentProps } from "react";

import { classesBouton, type VarianteBouton } from "./stylesBouton";

/**
 * Lien qui a l'aspect d'un bouton (navigation vers une page ou un fichier), avec les mêmes variantes que `Bouton`. Un lien
 * navigue, un bouton agit : pour envoyer un formulaire ou lancer une action, utiliser `Bouton` ou `FormulaireAction`.
 * Composant serveur : aucun état. `href` externe ou de téléchargement : passer `download` ou `target` comme sur un <a>.
 */
export function LienBouton({ variante = "secondaire", className, ...props }: Omit<ComponentProps<typeof Link>, "className"> & { variante?: VarianteBouton; className?: string }) {
  return <Link className={classesBouton(variante, className)} {...props} />;
}
