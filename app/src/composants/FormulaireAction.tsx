"use client";

import { useActionState, type ReactNode } from "react";

import type { ActionFormulaire, EtatFormulaire } from "./types";

const etatInitial: EtatFormulaire = {};

/** Formulaire branché sur une Server Action, avec affichage du message d'erreur ou de réussite. */
export function FormulaireAction({
  action,
  libelleBouton,
  children,
  className = "",
  discret = false,
}: {
  action: ActionFormulaire;
  libelleBouton: string;
  children: ReactNode;
  className?: string;
  /** Bouton secondaire (dans un tableau). */
  discret?: boolean;
}) {
  const [etat, executer, enCours] = useActionState(action, etatInitial);
  return (
    <form action={executer} className={className}>
      {children}
      <button
        type="submit"
        disabled={enCours}
        className={
          discret
            ? "rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface disabled:opacity-50"
            : "rounded bg-sim-bleu px-4 py-2 font-semibold text-white hover:bg-sim-marine disabled:opacity-50"
        }
      >
        {enCours ? "En cours…" : libelleBouton}
      </button>
      {etat.erreur ? (
        <div role="alert" className="mt-2 text-sm font-medium text-red-700">
          <p>{etat.erreur}</p>
          {etat.details?.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 font-normal">
              {etat.details.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {etat.succes ? (
        <div role="status" className="mt-2 text-sm font-medium text-green-700">
          <p>{etat.succes}</p>
          {etat.details?.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 font-normal text-amber-800">
              {etat.details.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export function Champ({
  nom,
  libelle,
  type = "text",
  requis = true,
  autoComplete,
  valeur,
}: {
  nom: string;
  libelle: string;
  type?: "text" | "password";
  requis?: boolean;
  autoComplete?: string;
  valeur?: string;
}) {
  return (
    <label className="mb-4 block text-sm font-medium">
      {libelle}
      <input
        name={nom}
        type={type}
        required={requis}
        autoComplete={autoComplete}
        defaultValue={valeur}
        className="mt-1 block w-full rounded border border-bordure bg-white px-3 py-2 text-base"
      />
    </label>
  );
}
