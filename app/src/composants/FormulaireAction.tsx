"use client";

import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";

import { Bouton, Champ as ChampSaisie, ChampDate as ChampDateSaisie, Icone } from "@/composants/ui";

import type { ActionFormulaire, EtatFormulaire } from "./types";

const etatInitial: EtatFormulaire = {};

/**
 * Formulaire branché sur une Server Action, avec affichage du message d'erreur ou de réussite. Un seul composant pour tous les
 * formulaires de l'application : son aspect change ici, son comportement (useActionState, « En cours… ») n'a pas bougé.
 */
export function FormulaireAction({
  action,
  libelleBouton,
  children,
  className = "",
  discret = false,
  pleineLargeur = false,
  conserverSaisie = false,
}: {
  action: ActionFormulaire;
  libelleBouton: string;
  children: ReactNode;
  className?: string;
  /** Bouton secondaire (dans un tableau). */
  discret?: boolean;
  /** Bouton sur toute la largeur (écran de connexion). */
  pleineLargeur?: boolean;
  /**
   * React 19 remet à zéro un formulaire dès que son action se termine, REFUS compris : le visiteur perd sa saisie. Avec cette option,
   * l'envoi est intercepté et l'action lancée à la main (même `FormData`, même état d'erreur) : le formulaire n'est jamais remis à
   * zéro, seul un enregistrement réussi quitte la page (redirection). À réserver aux longs formulaires ; l'envoi par `action` reste
   * le repli avant l'hydratation.
   */
  conserverSaisie?: boolean;
}) {
  const [etat, executer, enCours] = useActionState(action, etatInitial);
  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (enCours) return;
    const donnees = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => executer(donnees));
  };
  return (
    <form action={executer} onSubmit={conserverSaisie ? envoyer : undefined} className={className}>
      {children}
      {/* `type="submit"` : le spinner suit l'envoi du formulaire (useFormStatus) ; `disabled` garde le verrou de l'ancien bouton. */}
      <Bouton type="submit" variante={discret ? "secondaire" : "principal"} disabled={enCours} attente={conserverSaisie && enCours} className={pleineLargeur ? "w-full" : undefined}>
        {enCours ? "En cours…" : libelleBouton}
      </Bouton>
      {etat.erreur ? (
        <div role="alert" className="animate-fade-in-up mt-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          <Icone nom="alerte" className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{etat.erreur}</p>
            {etat.details?.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {etat.details.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      {etat.succes ? (
        <div role="status" className="animate-fade-in-up mt-3 flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success">
          <Icone nom="succes" className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{etat.succes}</p>
            {/* Sous un succès, les détails sont des avertissements : ils gardent la teinte d'alerte de l'ancien affichage. */}
            {etat.details?.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-warning">
                {etat.details.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}

/**
 * Champ de saisie d'un formulaire d'action : enveloppe fine du `Champ` de `composants/ui`, avec les noms de props français
 * historiques. Attention : `requis` vaut `true` PAR DÉFAUT (astérisque rouge sur chaque champ obligatoire) ; passer
 * `requis={false}` pour un champ facultatif.
 */
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
  // Le `div` reprend l'espacement de l'ancienne étiquette (mb-4) : les champs se suivent sans rien entre eux.
  return (
    <div className="mb-4">
      <ChampSaisie name={nom} label={libelle} type={type} required={requis} autoComplete={autoComplete} defaultValue={valeur} />
    </div>
  );
}

export function ChampDate({
  nom,
  libelle,
  requis = true,
  valeur,
  min,
  max,
  aide,
}: {
  nom: string;
  libelle: string;
  requis?: boolean;
  valeur?: string;
  min?: string;
  max?: string;
  aide?: string;
}) {
  return (
    <div className="mb-4">
      <ChampDateSaisie name={nom} label={libelle} required={requis} defaultValue={valeur} min={min} max={max} aide={aide} />
    </div>
  );
}
