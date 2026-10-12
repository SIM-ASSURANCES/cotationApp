"use client";

import { useState } from "react";

import { ListeDeroulante } from "@/composants/ui";
import { LIBELLE_REGIME_TAXE, LIBELLE_TYPE_CONTRAT, REGIME_PAR_DEFAUT, REGIMES_TAXE, TYPES_CONTRAT, estTypeContrat } from "@/domaine/calcul/taxes";

/**
 * Type de contrat et régime de taxe (session 6.0, H29 fermée). Le régime est proposé selon le type (INDIVIDUEL, FAMILLE →
 * Individuel ; GROUPE, GROUPE_OUVERT → Groupe) tant que l'utilisateur ne l'a pas changé lui-même ; c'est lui qui choisit le taux.
 */
export function ChoixContrat({ typeContrat, regimeTaxe }: { typeContrat: string; regimeTaxe: string }) {
  const [type, setType] = useState(typeContrat);
  const [regime, setRegime] = useState(regimeTaxe || (estTypeContrat(typeContrat) ? REGIME_PAR_DEFAUT[typeContrat] : ""));
  const [regimeChoisi, setRegimeChoisi] = useState(regimeTaxe !== "");

  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <ListeDeroulante
        label="Type de contrat (obligatoire, repris dans les documents)"
        name="typeContrat"
        value={type}
        required
        invite="— Choisir —"
        options={TYPES_CONTRAT.map((t) => ({ valeur: t, libelle: LIBELLE_TYPE_CONTRAT[t] }))}
        onChange={(e) => {
          setType(e.target.value);
          if (!regimeChoisi && estTypeContrat(e.target.value)) setRegime(REGIME_PAR_DEFAUT[e.target.value]);
        }}
      />
      <ListeDeroulante
        label="Régime de taxe (obligatoire : il détermine le taux)"
        name="regimeTaxe"
        value={regime}
        required
        invite="— Choisir —"
        options={REGIMES_TAXE.map((r) => ({ valeur: r, libelle: LIBELLE_REGIME_TAXE[r] }))}
        onChange={(e) => {
          setRegime(e.target.value);
          setRegimeChoisi(true);
        }}
      />
    </div>
  );
}
