import { cx } from "./classes";

// Sans « use client » : importé aussi par LienBouton, un composant serveur (un export d'un fichier client ne s'appelle pas depuis le serveur).
export type VarianteBouton = "principal" | "secondaire" | "danger";

const CLASSES_VARIANTE: Record<VarianteBouton, string> = {
  principal: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondaire: "border border-border bg-secondary text-secondary-foreground hover:bg-secondary-hover",
  danger: "bg-danger text-danger-foreground hover:bg-danger-hover",
};

const BASE_BOUTON =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-[background-color,color,transform] duration-150 ease-out-strong sm:min-h-0 motion-safe:active:scale-[0.97]";

/** Classes d'un bouton, pour un lien qui doit lui ressembler (voir `LienBouton`) : un seul endroit pour l'aspect des boutons. */
export const classesBouton = (variante: VarianteBouton = "principal", className?: string): string => cx(BASE_BOUTON, CLASSES_VARIANTE[variante], className);


export { BASE_BOUTON, CLASSES_VARIANTE };
