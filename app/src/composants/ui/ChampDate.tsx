import { useId, type InputHTMLAttributes, type Ref } from "react";

import { normaliserDateSaisie } from "@/domaine/calcul/dates";

import { ChampFormulaire, classesControle } from "./ChampFormulaire";

/**
 * Sélecteur de date unique de l'application (D37, point 3) : `<input type="date" lang="fr-CI" />` (affichage JJ/MM/AAAA,
 * valeur transmise en AAAA-MM-JJ), avec bornes `min` et `max` facultatives.
 */
export function ChampDate({
  label,
  erreur,
  aide,
  id,
  required,
  className,
  value,
  defaultValue,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  erreur?: string;
  aide?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idMessage = erreur || aide ? `${idChamp}-message` : undefined;
  const valeurNormalisee = typeof value === "string" && value ? normaliserDateSaisie(value) : value;
  const defautNormalise = typeof defaultValue === "string" && defaultValue ? normaliserDateSaisie(defaultValue) : defaultValue;
  return (
    <ChampFormulaire label={label} htmlFor={idChamp} requis={required} erreur={erreur} aide={aide} idMessage={idMessage}>
      <input
        ref={ref}
        id={idChamp}
        type="date"
        lang="fr-CI"
        placeholder="JJ/MM/AAAA"
        required={required}
        value={valeurNormalisee}
        defaultValue={defautNormalise}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={idMessage}
        className={classesControle(Boolean(erreur), className)}
        {...props}
      />
    </ChampFormulaire>
  );
}
