import { useId, type Ref, type SelectHTMLAttributes } from "react";

import { ChampFormulaire, classesControle } from "./ChampFormulaire";

export type OptionListe = { valeur: string; libelle: string };

/**
 * Liste déroulante, avec étiquette, message d'erreur ou d'aide (mêmes attributs que <select>). `invite` est une première
 * option désactivée (« Choisir… ») ; sans valeur par défaut, elle est sélectionnée et le formulaire exige un vrai choix.
 */
export function ListeDeroulante({
  label,
  erreur,
  aide,
  id,
  required,
  className,
  options,
  invite,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; erreur?: string; aide?: string; options: OptionListe[]; invite?: string; ref?: Ref<HTMLSelectElement> }) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idMessage = erreur || aide ? `${idChamp}-message` : undefined;
  return (
    <ChampFormulaire label={label} htmlFor={idChamp} requis={required} erreur={erreur} aide={aide} idMessage={idMessage}>
      <select
        ref={ref}
        id={idChamp}
        required={required}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={idMessage}
        {...(props.value === undefined && { defaultValue: props.defaultValue ?? (invite ? "" : undefined) })}
        className={classesControle(Boolean(erreur), className)}
        {...props}
      >
        {invite ? (
          <option value="" disabled>
            {invite}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.valeur} value={option.valeur}>
            {option.libelle}
          </option>
        ))}
      </select>
    </ChampFormulaire>
  );
}
