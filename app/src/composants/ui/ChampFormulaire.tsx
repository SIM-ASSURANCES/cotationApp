import type { ReactNode } from "react";

import { cx } from "./classes";

/**
 * Classes communes à tous les contrôles de saisie (Champ, ZoneTexte, ListeDeroulante) : un seul endroit pour changer l'aspect des
 * champs. Fond `primary-bg` pâle (consigne de la refonte), bordure du design system, anneau de focus du bleu principal.
 */
export const classesControle = (enErreur: boolean, extra?: string): string =>
  cx(
    "block w-full rounded-lg border bg-primary-bg px-3 py-2 text-sm text-foreground placeholder:text-neutral/80 transition-colors duration-150 ease-out-strong",
    "hover:border-muted-foreground/60 focus:outline-2 focus:outline-offset-2 focus:outline-primary",
    "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:border-border",
    enErreur ? "border-danger" : "border-border",
    extra,
  );

/**
 * Associe une étiquette, un contrôle quelconque et un message (erreur ou aide). `Champ`, `ZoneTexte` et `ListeDeroulante` s'en
 * servent déjà ; l'utiliser directement pour un contrôle particulier (groupe de cases à cocher, champ composé).
 * L'astérisque rouge marque un champ obligatoire.
 */
export function ChampFormulaire({
  label,
  htmlFor,
  requis,
  erreur,
  aide,
  idMessage,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  requis?: boolean;
  erreur?: string;
  aide?: string;
  /** `id` du message, pour que le contrôle le référence par `aria-describedby`. */
  idMessage?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("space-y-1", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
          {label}
          {requis ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children}
      {erreur ? (
        <p id={idMessage} className="text-sm text-danger">
          {erreur}
        </p>
      ) : aide ? (
        <p id={idMessage} className="text-sm text-muted-foreground">
          {aide}
        </p>
      ) : null}
    </div>
  );
}
