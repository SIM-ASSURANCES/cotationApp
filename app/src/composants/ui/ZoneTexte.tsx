import { useId, type Ref, type TextareaHTMLAttributes } from "react";

import { ChampFormulaire, classesControle } from "./ChampFormulaire";

/** Zone de saisie de plusieurs lignes, avec étiquette, message d'erreur ou d'aide (mêmes attributs que <textarea>). */
export function ZoneTexte({
  label,
  erreur,
  aide,
  id,
  required,
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; erreur?: string; aide?: string; ref?: Ref<HTMLTextAreaElement> }) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idMessage = erreur || aide ? `${idChamp}-message` : undefined;
  return (
    <ChampFormulaire label={label} htmlFor={idChamp} requis={required} erreur={erreur} aide={aide} idMessage={idMessage}>
      <textarea
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
