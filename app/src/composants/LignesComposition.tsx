"use client";

import { useState } from "react";

import { Bouton, Champ, ListeDeroulante } from "@/composants/ui";

export type LigneComposition = {
  libelle: string;
  branche: string;
  montantGaranti: string;
  primeNette: string;
  accessoires: string;
};

const vide = (branche = ""): LigneComposition => ({
  libelle: "",
  branche,
  montantGaranti: "",
  primeNette: "",
  accessoires: "0",
});

// Tableau manuel (cellules = champs) aux classes du composant Tableau. Pas de zébrure : un champ teinté ne doit pas reposer sur un fond bg-muted.
const ENTETE = "border-b border-border bg-muted px-3 py-2 font-medium text-neutral";
const CELLULE = "border-b border-border px-2 py-1.5 align-top";

/**
 * Lignes de prime d'une cotation composée par la Technique (session 6.2b, D37) : une ligne par garantie souscrite, surprime ou majoration.
 * Le libellé se choisit dans la liste des garanties du produit (suggestions) et pré-remplit la catégorie de taxe, le montant garanti par défaut
 * et les accessoires par défaut ; tout reste modifiable sur la cotation. Champs de même nom : lus par getAll côté serveur.
 */
export function LignesComposition({
  initiales,
  garanties,
  branches,
  saisieLibre,
}: {
  initiales: LigneComposition[];
  garanties: { libelle: string; branche: string | null; montantGaranti?: string | null; accessoires?: string | null }[];
  branches: { code: string; libelle: string }[];
  saisieLibre: boolean;
}) {
  const [lignes, setLignes] = useState<LigneComposition[]>(initiales.length > 0 ? initiales : [vide()]);
  const modifier = (i: number, champ: keyof LigneComposition, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));
  /** Choisir un libellé de la liste du produit pré-remplit sa catégorie de taxe, son montant garanti par défaut et ses accessoires par défaut. */
  const changerLibelle = (i: number, valeur: string) =>
    setLignes((l) =>
      l.map((x, k) => {
        if (k !== i) return x;
        const connue = garanties.find((g) => g.libelle.toLowerCase() === valeur.trim().toLowerCase());
        if (!connue) return { ...x, libelle: valeur };
        return {
          ...x,
          libelle: valeur,
          branche: x.branche === "" && connue.branche ? connue.branche : x.branche,
          montantGaranti: x.montantGaranti === "" && connue.montantGaranti != null ? connue.montantGaranti : x.montantGaranti,
          accessoires: (x.accessoires === "" || x.accessoires === "0") && connue.accessoires != null ? connue.accessoires : x.accessoires,
        };
      }),
    );

  return (
    <div className="space-y-3">
      {garanties.length > 0 ? (
        <datalist id="garanties-du-produit">
          {garanties.map((g) => (
            <option key={g.libelle} value={g.libelle} />
          ))}
        </datalist>
      ) : null}
      <div className="relative overflow-x-auto rounded-md border border-border shadow-elevated">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${ENTETE} text-left`}>Garantie {saisieLibre ? "" : "(liste du produit)"}</th>
              <th scope="col" className={`${ENTETE} text-left`}>Catégorie de taxe</th>
              <th scope="col" className={`${ENTETE} text-right`}>Montant garanti (FCFA)</th>
              <th scope="col" className={`${ENTETE} text-right`}>Prime nette HT</th>
              <th scope="col" className={`${ENTETE} text-right`}>Accessoires</th>
              <th scope="col" className={ENTETE}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="bg-surface [&>tr:last-child>td]:border-b-0">
            {lignes.map((l, i) => (
              <tr key={i}>
                <td className={CELLULE}>
                  <Champ name="ligne_libelle" value={l.libelle} onChange={(e) => changerLibelle(i, e.target.value)} list={garanties.length > 0 ? "garanties-du-produit" : undefined} aria-label="Libellé de la garantie" required />
                </td>
                <td className={CELLULE}>
                  <ListeDeroulante
                    name="ligne_branche"
                    value={l.branche}
                    onChange={(e) => modifier(i, "branche", e.target.value)}
                    aria-label="Catégorie de taxe de la ligne"
                    required
                    options={[{ valeur: "", libelle: "— Choisir —" }, ...branches.map((b) => ({ valeur: b.code, libelle: `${b.code} — ${b.libelle}` }))]}
                  />
                </td>
                <td className={CELLULE}>
                  <Champ
                    name="ligne_montant_garanti"
                    value={l.montantGaranti}
                    onChange={(e) => modifier(i, "montantGaranti", e.target.value)}
                    aria-label="Montant garanti"
                    placeholder="Facultatif"
                    inputMode="decimal"
                    className="text-right tabular-nums"
                  />
                </td>
                <td className={CELLULE}>
                  <Champ name="ligne_nette" value={l.primeNette} onChange={(e) => modifier(i, "primeNette", e.target.value)} aria-label="Prime nette" inputMode="decimal" className="text-right tabular-nums" required />
                </td>
                <td className={CELLULE}>
                  <Champ name="ligne_accessoires" value={l.accessoires} onChange={(e) => modifier(i, "accessoires", e.target.value)} aria-label="Accessoires" inputMode="decimal" className="text-right tabular-nums" required />
                </td>
                <td className={CELLULE}>
                  <Bouton variante="secondaire" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))} disabled={lignes.length === 1}>
                    Retirer
                  </Bouton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Bouton variante="secondaire" onClick={() => setLignes((x) => [...x, vide()])}>
        + Ajouter une ligne (garantie, surprime, majoration)
      </Bouton>
    </div>
  );
}
