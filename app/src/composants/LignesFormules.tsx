"use client";

import { useState } from "react";

import { MODES_ACCESSOIRE } from "@/domaine/calcul/calcul";

export type LigneFormule = {
  code: string;
  libelle: string;
  tauxCouverture: string;
  primeUnitaire: string;
  accessoireMode: string;
  accessoireValeur: string;
  ageMin: string;
  ageMax: string;
};

const LIBELLE_MODE: Record<string, string> = {
  AUCUN: "Aucun",
  FIXE: "Fixe par contrat",
  PAR_TETE: "Par tête",
  PAR_FAMILLE: "Par famille",
  POURCENT: "% de la prime nette",
};

const vide = (): LigneFormule => ({ code: "", libelle: "", tauxCouverture: "", primeUnitaire: "", accessoireMode: "AUCUN", accessoireValeur: "0", ageMin: "", ageMax: "" });

const entree = "w-full rounded border border-border bg-surface px-2 py-1";

/** Lignes de formules d'une version de produit : ajout et retrait de lignes. Les champs portent le même nom (getAll côté serveur). */
export function LignesFormules({ initiales }: { initiales: LigneFormule[] }) {
  const [lignes, setLignes] = useState<LigneFormule[]>(initiales.length > 0 ? initiales : [vide()]);
  // Mode par garanties (session 6.2b) : aucune formule n'est nécessaire, on peut toutes les retirer. En mode par formule, la validation en exige une.

  const modifier = (i: number, champ: keyof LigneFormule, valeur: string) =>
    setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground">
            <th className="p-2">Code</th>
            <th className="p-2">Libellé</th>
            <th className="p-2">Taux de couverture %</th>
            <th className="p-2">Prime unitaire (avec décimales)</th>
            <th className="p-2">Accessoires</th>
            <th className="p-2">Valeur</th>
            <th className="p-2" title="Âges limites en années révolues (contrôle de l'import en masse) ; vide : pas de limite">Âge min.</th>
            <th className="p-2">Âge max.</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-border align-top">
              <td className="p-1">
                <input name="formule_code" value={l.code} onChange={(e) => modifier(i, "code", e.target.value.toUpperCase())} aria-label="Code de la formule" className={entree} required />
              </td>
              <td className="p-1">
                <input name="formule_libelle" value={l.libelle} onChange={(e) => modifier(i, "libelle", e.target.value)} aria-label="Libellé" className={entree} required />
              </td>
              <td className="p-1">
                <input name="formule_taux" value={l.tauxCouverture} onChange={(e) => modifier(i, "tauxCouverture", e.target.value)} aria-label="Taux de couverture" className={entree} />
              </td>
              <td className="p-1">
                <input name="formule_prime" value={l.primeUnitaire} onChange={(e) => modifier(i, "primeUnitaire", e.target.value)} aria-label="Prime unitaire" inputMode="decimal" className={entree} required />
              </td>
              <td className="p-1">
                <select name="formule_mode" value={l.accessoireMode} onChange={(e) => modifier(i, "accessoireMode", e.target.value)} aria-label="Mode des accessoires" className={entree}>
                  {MODES_ACCESSOIRE.map((m) => (
                    <option key={m} value={m}>
                      {LIBELLE_MODE[m]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="p-1">
                <input name="formule_valeur" value={l.accessoireValeur} onChange={(e) => modifier(i, "accessoireValeur", e.target.value)} aria-label="Valeur des accessoires" inputMode="decimal" className={entree} required />
              </td>
              <td className="p-1">
                <input name="formule_age_min" value={l.ageMin} onChange={(e) => modifier(i, "ageMin", e.target.value)} aria-label="Âge minimal" inputMode="numeric" className={entree} />
              </td>
              <td className="p-1">
                <input name="formule_age_max" value={l.ageMax} onChange={(e) => modifier(i, "ageMax", e.target.value)} aria-label="Âge maximal" inputMode="numeric" className={entree} />
              </td>
              <td className="p-1">
                <button type="button" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))} className="rounded border border-border px-2 py-1">
                  Retirer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setLignes((x) => [...x, vide()])} className="mt-2 rounded border border-primary px-3 py-1 text-sm font-medium text-primary hover:bg-muted">
        + Ajouter une formule
      </button>
    </div>
  );
}
