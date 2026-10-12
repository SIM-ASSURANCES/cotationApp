"use client";

import { useState } from "react";

import { LIBELLE_REGIME_TAXE, LIBELLE_TYPE_CONTRAT, REGIME_PAR_DEFAUT, REGIMES_TAXE, TYPES_CONTRAT, estTypeContrat } from "@/domaine/calcul/taxes";

const entree = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2";

/**
 * Type de contrat et régime de taxe (session 6.0, H29 fermée). Le régime est proposé selon le type (INDIVIDUEL, FAMILLE →
 * Individuel ; GROUPE, GROUPE_OUVERT → Groupe) tant que l'utilisateur ne l'a pas changé lui-même ; c'est lui qui choisit le taux.
 */
export function ChoixContrat({ typeContrat, regimeTaxe }: { typeContrat: string; regimeTaxe: string }) {
  const [type, setType] = useState(typeContrat);
  const [regime, setRegime] = useState(regimeTaxe || (estTypeContrat(typeContrat) ? REGIME_PAR_DEFAUT[typeContrat] : ""));
  const [regimeChoisi, setRegimeChoisi] = useState(regimeTaxe !== "");

  return (
    <div className="mb-4 grid max-w-3xl gap-x-6 sm:grid-cols-2">
      <label className="mb-2 block text-sm font-medium">
        Type de contrat (obligatoire, repris dans les documents)
        <select
          name="typeContrat"
          value={type}
          required
          className={entree}
          onChange={(e) => {
            setType(e.target.value);
            if (!regimeChoisi && estTypeContrat(e.target.value)) setRegime(REGIME_PAR_DEFAUT[e.target.value]);
          }}
        >
          <option value="" disabled>
            — Choisir —
          </option>
          {TYPES_CONTRAT.map((t) => (
            <option key={t} value={t}>
              {LIBELLE_TYPE_CONTRAT[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="mb-2 block text-sm font-medium">
        Régime de taxe (obligatoire : il détermine le taux)
        <select
          name="regimeTaxe"
          value={regime}
          required
          className={entree}
          onChange={(e) => {
            setRegime(e.target.value);
            setRegimeChoisi(true);
          }}
        >
          <option value="" disabled>
            — Choisir —
          </option>
          {REGIMES_TAXE.map((r) => (
            <option key={r} value={r}>
              {LIBELLE_REGIME_TAXE[r]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
