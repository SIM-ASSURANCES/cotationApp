"use client";

import type { ButtonHTMLAttributes, Ref } from "react";
import { useFormStatus } from "react-dom";

import { cx } from "./classes";
import { BASE_BOUTON, CLASSES_VARIANTE, type VarianteBouton } from "./stylesBouton";

export type { VarianteBouton };

/**
 * Bouton standard. `danger` seulement pour une action destructrice ou irréversible (annulation, rejet).
 * État d'attente : un bouton `type="submit"` affiche un spinner et se désactive tant que le formulaire qui le contient est en
 * cours d'envoi (`useFormStatus` lit l'état natif du <form> parent : aucune logique n'est dupliquée ici). `attente` force
 * le spinner pour un bouton hors formulaire.
 */
export function Bouton({
  variante = "principal",
  attente = false,
  disabled,
  className,
  children,
  type = "button",
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBouton; attente?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const { pending } = useFormStatus();
  const enAttente = attente || (type === "submit" && pending);
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || enAttente}
      aria-busy={enAttente}
      className={cx(BASE_BOUTON, "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100", CLASSES_VARIANTE[variante], className)}
      {...props}
    >
      {enAttente ? (
        <svg className="size-4 motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
