"use client";

import { useState, type ReactNode } from "react";

import { Bouton, Champ } from "@/composants/ui";
import type { Bareme, Resultat } from "@/domaine/bareme";

/** Ce que reçoit chaque onglet : le document, comment le modifier, et ce qui est figé par une publication. */
export type ContexteEdition = {
  doc: Bareme;
  /** Remplace le document par le résultat de la fonction. */
  maj: (f: (b: Bareme) => Bareme) => void;
  /** Applique le résultat d'une opération du domaine ; un refus est montré (il nomme qui lit l'élément). */
  appliquer: (r: Resultat) => void;
  /** Montre un refus de l'écran. */
  refuser: (messages: string[]) => void;
  /** Codes de champs et de valeurs intermédiaires qui figurent dans un barème publié du produit : ils ne se renomment plus. */
  figes: ReadonlySet<string>;
  categoriesTaxe: string[];
};

export const LIBELLE_TYPE = {
  TEXTE: "Texte",
  NOMBRE: "Nombre",
  MONTANT: "Montant",
  DATE: "Date",
  OUI_NON: "Oui / non",
  LISTE: "Liste déroulante",
  CHOIX_MULTIPLES: "Choix multiples",
} as const;

/** Nombre décimal saisi à la française : la virgule devient le point, les espaces disparaissent (la validité reste jugée par le schéma). */
export const decimalSaisi = (texte: string): string => texte.replace(/\s/g, "").replace(",", ".");

export const CASE = "size-4 accent-primary";
export const SOUS_TITRE = "text-sm font-bold text-foreground";

/** Case à cocher étiquetée (cible tactile de 40 px sous `lg`). */
export function CaseACocher({ libelle, coche, onChange, disabled }: { libelle: string; coche: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-foreground lg:min-h-0">
      <input type="checkbox" className={CASE} checked={coche} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {libelle}
    </label>
  );
}

/**
 * Champ de code : le texte est jugé à la sortie du champ (ou à Entrée), pas à chaque frappe, car un changement de code est refusé tant
 * que quelque chose le lit. `valider` rend vrai si le changement est accepté ; sinon le texte revient à la valeur enregistrée.
 * À utiliser avec `key={valeur}` : le champ repart de la nouvelle valeur après un changement accepté.
 */
export function ChampCode({ label, valeur, valider, disabled, aide }: { label: string; valeur: string; valider: (nouveau: string) => boolean; disabled?: boolean; aide?: string }) {
  const [texte, setTexte] = useState(valeur);
  const finir = () => {
    if (texte !== valeur && !valider(texte)) setTexte(valeur);
  };
  return (
    <Champ
      label={label}
      value={texte}
      disabled={disabled}
      aide={aide}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={finir}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finir();
        }
      }}
    />
  );
}

/** Rangée de petits boutons d'un élément de liste : monter, descendre, supprimer (libellés écrits, jamais une icône seule). */
export function ActionsElement({ nom, onMonter, onDescendre, onSupprimer, disabled }: { nom: string; onMonter?: () => void; onDescendre?: () => void; onSupprimer: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {onMonter ? (
        <Bouton variante="secondaire" onClick={onMonter} disabled={disabled} aria-label={`Monter ${nom}`}>
          Monter
        </Bouton>
      ) : null}
      {onDescendre ? (
        <Bouton variante="secondaire" onClick={onDescendre} disabled={disabled} aria-label={`Descendre ${nom}`}>
          Descendre
        </Bouton>
      ) : null}
      <Bouton variante="danger" onClick={onSupprimer} disabled={disabled} aria-label={`Supprimer ${nom}`}>
        Supprimer
      </Bouton>
    </div>
  );
}

/** Élément dépliable (liste de champs, de garanties…) : `details` natif, donc clavier complet (Entrée ou Espace sur le titre). */
export function Depliable({ ouvert, onBascule, titre, sousTitre, pastilles, children }: { ouvert: boolean; onBascule: (ouvert: boolean) => void; titre: string; sousTitre?: string; pastilles?: ReactNode; children: ReactNode }) {
  return (
    <details open={ouvert} onToggle={(e) => onBascule(e.currentTarget.open)} className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-10 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 marker:content-none">
        <span className="text-sm font-semibold text-foreground">{titre}</span>
        {sousTitre && sousTitre !== titre ? <span className="break-all text-sm text-muted-foreground">{sousTitre}</span> : null}
        {pastilles}
        <span aria-hidden="true" className="ml-auto text-sm text-muted-foreground group-open:hidden">
          Déplier
        </span>
        <span aria-hidden="true" className="ml-auto hidden text-sm text-muted-foreground group-open:inline">
          Replier
        </span>
      </summary>
      <div className="space-y-4 border-t border-border p-3">{children}</div>
    </details>
  );
}

/** Ensemble des éléments dépliés d'un onglet, par code. */
export function useOuverts() {
  const [ouverts, setOuverts] = useState<ReadonlySet<string>>(new Set());
  return {
    estOuvert: (code: string) => ouverts.has(code),
    bascule: (code: string, ouvert: boolean) =>
      setOuverts((anciens) => {
        const suivants = new Set(anciens);
        if (ouvert) suivants.add(code);
        else suivants.delete(code);
        return suivants;
      }),
    ouvrir: (code: string) => setOuverts((anciens) => new Set(anciens).add(code)),
    renommer: (ancien: string, nouveau: string) =>
      setOuverts((anciens) => {
        if (!anciens.has(ancien)) return anciens;
        const suivants = new Set(anciens);
        suivants.delete(ancien);
        suivants.add(nouveau);
        return suivants;
      }),
  };
}
