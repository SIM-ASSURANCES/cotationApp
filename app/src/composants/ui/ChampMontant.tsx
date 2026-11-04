"use client";

import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";

import { lireSaisieMontant, positionApresReformatage, significatifsAvant } from "@/domaine/calcul/saisie-montant";

import { Champ } from "./Champ";
import { cx } from "./classes";

type OptionsSaisie = {
  /** Le champ admet des décimales (virgule). Vrai par défaut ; `false` pour un montant entier. */
  decimales?: boolean;
  /** Mode contrôlé : la valeur SANS séparateur (« 1000000 », « 1000000.5 »). */
  value?: string;
  /** Mode non contrôlé : valeur initiale, sous n'importe quelle écriture (« 1000000 », « 1 000 000 », « 1000000.5 »). */
  defaultValue?: string | number;
  /** Reçoit la valeur SANS séparateur de milliers, point décimal (le texte tel quel s'il n'est pas un nombre bien formé). */
  onChange?: (brut: string) => void;
  /** `name` du champ dans le formulaire : l'entrée envoyée est la valeur sans séparateur. */
  name?: string;
};

/**
 * Comportement d'un champ de montant (D63), à brancher sur un `<input>` : séparateur de milliers affiché PENDANT la saisie
 * (« 1 000 000 »), valeur envoyée sans séparateur (« 1000000 »), curseur qui reste où l'on tape, collage depuis Excel accepté
 * (« 1 000 000 », « 1000000 », décimales avec virgule). Rien n'est validé : un texte que le hook ne reconnaît pas est laissé tel quel
 * et le serveur le refuse avec son message.
 *
 * Deux usages, comme un `<input>` :
 * - dans un formulaire (`name`, `defaultValue`) : le champ garde son `name` ; à l'envoi (`FormData` du formulaire, quelle que soit la
 *   façon dont il est construit : envoi natif, `FormulaireAction`, lecture du calcul automatique) son entrée est remplacée par la
 *   valeur sans séparateur, y compris pour plusieurs champs de même `name` (lignes d'un tableau). Un formulaire remis à zéro
 *   retrouve la valeur initiale ;
 * - contrôlé (`value`, `onChange(brut)`) : l'état de la page ne porte jamais de séparateur.
 *
 * Étaler le résultat sur l'`<input>` : `<input {...useSaisieMontant({ value, onChange })} />`.
 */
export function useSaisieMontant({ decimales = true, value, defaultValue, onChange, name }: OptionsSaisie) {
  const options = { decimales };
  const controle = value !== undefined;
  const initial = lireSaisieMontant(String(controle ? value : (defaultValue ?? "")), options).affiche;
  const [affiche, setAffiche] = useState(initial);
  const valeurInitiale = useRef(initial);
  const champ = useRef<HTMLInputElement>(null);

  // Mode contrôlé : une valeur changée par la page (réinitialisation, autre ligne) remplace ce qui est affiché ; la saisie en cours,
  // elle, revient ici sous la même valeur et ne déclenche rien.
  if (value !== undefined && lireSaisieMontant(value, options).brut !== lireSaisieMontant(affiche, options).brut) {
    setAffiche(lireSaisieMontant(value, options).affiche);
  }

  function surChangement(e: ChangeEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const texte = el.value;
    const avant = significatifsAvant(texte, el.selectionStart ?? texte.length);
    const lu = lireSaisieMontant(texte, options);
    if (lu.affiche !== texte) {
      // Écrit tout de suite dans le champ (et non au rendu suivant) : React ne le recopiera pas, et le curseur reste où l'on tape.
      el.value = lu.affiche;
      if (document.activeElement === el) {
        const position = positionApresReformatage(lu.affiche, avant);
        el.setSelectionRange(position, position);
      }
    }
    setAffiche(lu.affiche);
    onChange?.(lu.brut);
  }

  // Envoi : l'entrée de ce champ dans le `FormData` du formulaire porte la valeur sans séparateur. L'événement `formdata` est émis à
  // chaque construction d'un `FormData` depuis le formulaire.
  useEffect(() => {
    const el = champ.current;
    const formulaire = el?.form;
    if (!el || !formulaire || !name) return;
    const surDonnees = (e: FormDataEvent) => {
      const brut = lireSaisieMontant(el.value, { decimales }).brut;
      const miens = Array.from(formulaire.querySelectorAll<HTMLInputElement>("input[data-champ-montant]")).filter((i) => i.name === name && !i.disabled);
      const entrees = e.formData.getAll(name);
      const rang = miens.indexOf(el);
      if (rang < 0 || entrees.length !== miens.length) return; // alignement impossible : l'envoi garde ce que le champ affiche (le serveur lit aussi cela)
      entrees[rang] = brut;
      e.formData.delete(name);
      for (const entree of entrees) e.formData.append(name, entree);
    };
    const surRemiseAZero = () => {
      if (!controle) setAffiche(valeurInitiale.current);
    };
    formulaire.addEventListener("formdata", surDonnees);
    formulaire.addEventListener("reset", surRemiseAZero);
    return () => {
      formulaire.removeEventListener("formdata", surDonnees);
      formulaire.removeEventListener("reset", surRemiseAZero);
    };
  }, [name, decimales, controle]);

  return {
    ref: champ,
    name,
    "data-champ-montant": "",
    value: affiche,
    onChange: surChangement,
    inputMode: decimales ? ("decimal" as const) : ("numeric" as const),
    autoComplete: "off",
    spellCheck: false,
  };
}

type ProprietesChampMontant = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "inputMode" | "ref"> &
  Omit<OptionsSaisie, "name"> & {
    label?: string;
    erreur?: string;
    aide?: string;
  };

/**
 * Champ de saisie d'un montant (D63) : le `Champ` du design system avec le comportement de `useSaisieMontant` (séparateur de milliers
 * pendant la saisie, valeur envoyée sans séparateur, curseur stable, collage depuis Excel). Aligné à droite, chiffres tabulaires.
 *
 * Exemple : <ChampMontant label="Prime minimale" name="primeMinimale" defaultValue="150000" />
 */
export function ChampMontant({ decimales, value, defaultValue, onChange, name, className, ...props }: ProprietesChampMontant) {
  const saisie = useSaisieMontant({ decimales, value, defaultValue, onChange, name });
  return <Champ {...props} {...saisie} className={cx("text-right tabular-nums", className)} />;
}
