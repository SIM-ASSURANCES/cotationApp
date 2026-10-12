"use client";

import { useState } from "react";

import { Bouton, Champ, ListeDeroulante } from "@/composants/ui";
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

// Classes du `Tableau` du design system : les cellules portent ici des champs, ce qui interdit le composant lui-même.
const ENTETE = "border-b border-border bg-muted px-3 py-2 text-left font-medium text-neutral";
const CELLULE = "border-b border-border px-2 py-2 align-top";

/** Une ligne « commencée » : au moins un champ renseigné. Une ligne entièrement vide n'est pas exigée (mode par garanties, 6.2b) : le serveur l'ignore. */
const commencee = (l: LigneFormule): boolean =>
  [l.code, l.libelle, l.tauxCouverture, l.primeUnitaire, l.ageMin, l.ageMax].some((v) => v.trim() !== "") || l.accessoireMode !== "AUCUN" || !["", "0"].includes(l.accessoireValeur.trim());

/** Lignes de formules d'une version de produit : ajout et retrait de lignes. Les champs portent le même nom (getAll côté serveur). */
export function LignesFormules({ initiales }: { initiales: LigneFormule[] }) {
  const [lignes, setLignes] = useState<LigneFormule[]>(initiales.length > 0 ? initiales : [vide()]);
  // Mode par garanties (session 6.2b) : aucune formule n'est nécessaire, on peut toutes les retirer. En mode par formule, la validation en exige une.

  const modifier = (i: number, champ: keyof LigneFormule, valeur: string) =>
    setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="mb-4">
      {/* Région défilante focalisable : sur un écran étroit, les huit colonnes ne se parcourent pas sans clavier ni souris sinon. */}
      <div tabIndex={0} role="region" aria-label="Lignes de formules" className="relative overflow-x-auto rounded-md border border-border shadow-elevated">
        <table className="w-full min-w-[72rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={ENTETE}>Code</th>
              <th scope="col" className={ENTETE}>Libellé</th>
              <th scope="col" className={ENTETE}>Taux de couverture %</th>
              <th scope="col" className={ENTETE}>Prime unitaire (avec décimales)</th>
              <th scope="col" className={ENTETE}>Accessoires</th>
              <th scope="col" className={ENTETE}>Valeur</th>
              <th scope="col" className={ENTETE} title="Âges limites en années révolues (contrôle de l'import en masse) ; vide : pas de limite">Âge min.</th>
              <th scope="col" className={ENTETE}>Âge max.</th>
              <th scope="col" className={ENTETE}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-surface">
            {lignes.map((l, i) => (
              <tr key={i}>
                <td className={CELLULE}>
                  <Champ name="formule_code" value={l.code} onChange={(e) => modifier(i, "code", e.target.value.toUpperCase())} aria-label="Code de la formule" required={commencee(l)} />
                </td>
                <td className={CELLULE}>
                  <Champ name="formule_libelle" value={l.libelle} onChange={(e) => modifier(i, "libelle", e.target.value)} aria-label="Libellé" required={commencee(l)} />
                </td>
                <td className={CELLULE}>
                  <Champ name="formule_taux" value={l.tauxCouverture} onChange={(e) => modifier(i, "tauxCouverture", e.target.value)} aria-label="Taux de couverture" />
                </td>
                <td className={CELLULE}>
                  <Champ name="formule_prime" value={l.primeUnitaire} onChange={(e) => modifier(i, "primeUnitaire", e.target.value)} aria-label="Prime unitaire" inputMode="decimal" required={commencee(l)} />
                </td>
                <td className={CELLULE}>
                  <ListeDeroulante
                    name="formule_mode"
                    value={l.accessoireMode}
                    onChange={(e) => modifier(i, "accessoireMode", e.target.value)}
                    aria-label="Mode des accessoires"
                    options={MODES_ACCESSOIRE.map((m) => ({ valeur: m, libelle: LIBELLE_MODE[m] }))}
                  />
                </td>
                <td className={CELLULE}>
                  <Champ name="formule_valeur" value={l.accessoireValeur} onChange={(e) => modifier(i, "accessoireValeur", e.target.value)} aria-label="Valeur des accessoires" inputMode="decimal" required={commencee(l)} />
                </td>
                <td className={CELLULE}>
                  <Champ name="formule_age_min" value={l.ageMin} onChange={(e) => modifier(i, "ageMin", e.target.value)} aria-label="Âge minimal" inputMode="numeric" />
                </td>
                <td className={CELLULE}>
                  <Champ name="formule_age_max" value={l.ageMax} onChange={(e) => modifier(i, "ageMax", e.target.value)} aria-label="Âge maximal" inputMode="numeric" />
                </td>
                <td className={CELLULE}>
                  <Bouton variante="secondaire" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))}>
                    Retirer
                  </Bouton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Bouton variante="secondaire" className="mt-3" onClick={() => setLignes((x) => [...x, vide()])}>
        + Ajouter une formule
      </Bouton>
    </div>
  );
}
