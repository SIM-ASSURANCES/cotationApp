"use client";

import { useState } from "react";

export type LigneComposition = { libelle: string; branche: string; primeNette: string; accessoires: string };

const vide = (branche = ""): LigneComposition => ({ libelle: "", branche, primeNette: "", accessoires: "0" });

const entree = "w-full rounded border border-border bg-surface px-2 py-1";

/**
 * Lignes de prime d'une cotation composée par la Technique (session 6.2b) : une ligne par garantie souscrite, surprime ou majoration.
 * Le libellé se choisit dans la liste des garanties du produit (suggestions) ; la branche fiscale choisit le taux de taxe, calculé par le
 * module à l'enregistrement. Champs de même nom : lus par getAll côté serveur.
 */
export function LignesComposition({
  initiales,
  garanties,
  branches,
  saisieLibre,
}: {
  initiales: LigneComposition[];
  garanties: { libelle: string; branche: string | null }[];
  branches: { code: string; libelle: string }[];
  saisieLibre: boolean;
}) {
  const [lignes, setLignes] = useState<LigneComposition[]>(initiales.length > 0 ? initiales : [vide()]);
  const modifier = (i: number, champ: keyof LigneComposition, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));
  /** Choisir un libellé de la liste propose sa branche par défaut, sans écraser une branche déjà choisie. */
  const changerLibelle = (i: number, valeur: string) =>
    setLignes((l) =>
      l.map((x, k) => {
        if (k !== i) return x;
        const connue = garanties.find((g) => g.libelle.toLowerCase() === valeur.trim().toLowerCase());
        return { ...x, libelle: valeur, branche: x.branche === "" && connue?.branche ? connue.branche : x.branche };
      }),
    );

  return (
    <div className="mb-4 overflow-x-auto">
      {garanties.length > 0 ? (
        <datalist id="garanties-du-produit">
          {garanties.map((g) => (
            <option key={g.libelle} value={g.libelle} />
          ))}
        </datalist>
      ) : null}
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground">
            <th className="p-2">Garantie {saisieLibre ? "" : "(liste du produit)"}</th>
            <th className="p-2">Branche fiscale</th>
            <th className="p-2">Prime nette HT</th>
            <th className="p-2">Accessoires</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-border align-top">
              <td className="p-1">
                <input name="ligne_libelle" value={l.libelle} onChange={(e) => changerLibelle(i, e.target.value)} list={garanties.length > 0 ? "garanties-du-produit" : undefined} aria-label="Libellé de la garantie" className={entree} required />
              </td>
              <td className="p-1">
                <select name="ligne_branche" value={l.branche} onChange={(e) => modifier(i, "branche", e.target.value)} aria-label="Branche fiscale de la ligne" className={entree} required>
                  <option value="">— Choisir —</option>
                  {branches.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code} — {b.libelle}
                    </option>
                  ))}
                </select>
              </td>
              <td className="p-1">
                <input name="ligne_nette" value={l.primeNette} onChange={(e) => modifier(i, "primeNette", e.target.value)} aria-label="Prime nette" inputMode="decimal" className={entree} required />
              </td>
              <td className="p-1">
                <input name="ligne_accessoires" value={l.accessoires} onChange={(e) => modifier(i, "accessoires", e.target.value)} aria-label="Accessoires" inputMode="decimal" className={entree} required />
              </td>
              <td className="p-1">
                <button type="button" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))} disabled={lignes.length === 1} className="rounded border border-border px-2 py-1 disabled:opacity-40">
                  Retirer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setLignes((x) => [...x, vide()])} className="mt-2 rounded border border-primary px-3 py-1 text-sm font-medium text-primary hover:bg-muted">
        + Ajouter une ligne (garantie, surprime, majoration)
      </button>
    </div>
  );
}
