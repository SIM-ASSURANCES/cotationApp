import { useId, type InputHTMLAttributes, type Ref } from "react";

import { ChampFormulaire, classesControle } from "./ChampFormulaire";

/**
 * Champ de saisie d'une ligne, avec étiquette, message d'erreur ou d'aide et astérisque si `required`. Compatible avec
 * `FormulaireAction` : mêmes attributs `name`, `defaultValue`, `autoComplete`… que l'élément <input> natif, même envoi.
 *
 * Exemple : <Champ label="Identifiant" name="identifiant" required autoComplete="username" />
 */
export function Champ({
  label,
  erreur,
  aide,
  id,
  required,
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; erreur?: string; aide?: string; ref?: Ref<HTMLInputElement> }) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idMessage = erreur || aide ? `${idChamp}-message` : undefined;
  return (
    <ChampFormulaire label={label} htmlFor={idChamp} requis={required} erreur={erreur} aide={aide} idMessage={idMessage}>
      <input
        ref={ref}
        id={idChamp}
        required={required}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={idMessage}
        className={classesControle(Boolean(erreur), className)}
        {...props}
      />
    </ChampFormulaire>
  );
}
