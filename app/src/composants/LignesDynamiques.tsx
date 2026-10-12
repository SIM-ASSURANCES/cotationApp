"use client";

import { useState } from "react";

const entree = "w-full rounded border border-bordure bg-white px-2 py-1";

export type LigneAssure = { nom: string; naissance: string; sexe: string; lien: string; identification: string; formule: string };

/** Assurés d'une cotation (dictionnaire assures[]) : ajout et retrait de lignes. Champs de même nom : lus par getAll. */
export function LignesAssures({ initiales, formules }: { initiales: LigneAssure[]; formules: { code: string; libelle: string }[] }) {
  const [lignes, setLignes] = useState<LigneAssure[]>(initiales);
  const modifier = (i: number, champ: keyof LigneAssure, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="mb-4 overflow-x-auto">
      {lignes.length > 0 ? (
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-left text-white">
              <th className="p-2">Nom et prénoms</th>
              <th className="p-2">Naissance (AAAA-MM-JJ)</th>
              <th className="p-2">Sexe</th>
              <th className="p-2">Lien (filiation)</th>
              <th className="p-2">Pièce d&apos;identité (facultatif)</th>
              <th className="p-2">Formule</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-b border-bordure">
                <td className="p-1"><input name="assure_nom" value={l.nom} onChange={(e) => modifier(i, "nom", e.target.value)} aria-label="Nom et prénoms" className={entree} /></td>
                <td className="p-1"><input name="assure_naissance" value={l.naissance} onChange={(e) => modifier(i, "naissance", e.target.value)} aria-label="Date de naissance" placeholder="1990-05-15" className={entree} /></td>
                <td className="p-1">
                  <select name="assure_sexe" value={l.sexe} onChange={(e) => modifier(i, "sexe", e.target.value)} aria-label="Sexe" className={entree}>
                    <option value="">—</option>
                    <option value="M">M</option>
                    <option value="F">F</option>
                  </select>
                </td>
                <td className="p-1"><input name="assure_lien" value={l.lien} onChange={(e) => modifier(i, "lien", e.target.value)} aria-label="Lien" className={entree} /></td>
                <td className="p-1"><input name="assure_identification" value={l.identification} onChange={(e) => modifier(i, "identification", e.target.value)} aria-label="Pièce d'identité" placeholder="CNI, passeport…" className={entree} /></td>
                <td className="p-1">
                  <select name="assure_formule" value={l.formule} onChange={(e) => modifier(i, "formule", e.target.value)} aria-label="Formule" className={entree}>
                    <option value="">—</option>
                    {formules.map((f) => (<option key={f.code} value={f.code}>{f.code}</option>))}
                  </select>
                </td>
                <td className="p-1"><button type="button" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))} className="rounded border border-bordure px-2 py-1">Retirer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-zinc-600">Aucun assuré saisi (facultatif à ce stade).</p>
      )}
      <button type="button" onClick={() => setLignes((x) => [...x, { nom: "", naissance: "", sexe: "", lien: "", identification: "", formule: "" }])} className="mt-2 rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">
        + Ajouter un assuré
      </button>
    </div>
  );
}

export type LigneRisque = { cle: string; valeur: string };

/** Champs propres au produit (risque.*) : nom en minuscules et valeur. */
export function LignesRisque({ initiales }: { initiales: LigneRisque[] }) {
  const [lignes, setLignes] = useState<LigneRisque[]>(initiales);
  const modifier = (i: number, champ: keyof LigneRisque, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="mb-4">
      {lignes.map((l, i) => (
        <div key={i} className="mb-2 flex max-w-2xl gap-2">
          <input name="risque_cle" value={l.cle} onChange={(e) => modifier(i, "cle", e.target.value)} aria-label="Nom du champ (risque.…)" placeholder="marque" className={entree} />
          <input name="risque_valeur" value={l.valeur} onChange={(e) => modifier(i, "valeur", e.target.value)} aria-label="Valeur" className={entree} />
          <button type="button" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))} className="rounded border border-bordure px-2 py-1">Retirer</button>
        </div>
      ))}
      <button type="button" onClick={() => setLignes((x) => [...x, { cle: "", valeur: "" }])} className="rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">
        + Ajouter un champ de risque
      </button>
    </div>
  );
}

export type LigneBeneficiaire = { nom: string; lien: string; contact: string; quote: string };

/**
 * Bénéficiaires (dictionnaire beneficiaires[]) : la somme des quotes-parts doit faire 100 %, contrôlée par
 * le service. Les lignes vides sont ignorées ; l'ordre de saisie donne le numéro d'ordre.
 */
export function LignesBeneficiaires({ initiales }: { initiales: LigneBeneficiaire[] }) {
  const [lignes, setLignes] = useState<LigneBeneficiaire[]>(initiales);
  const modifier = (i: number, champ: keyof LigneBeneficiaire, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="mb-4 overflow-x-auto">
      {lignes.length > 0 ? (
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-left text-white">
              <th className="p-2">Nom et prénoms</th>
              <th className="p-2">Lien avec l'assuré</th>
              <th className="p-2">Contact</th>
              <th className="p-2">Quote-part (%)</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-b border-bordure">
                <td className="p-1"><input name="benef_nom" value={l.nom} onChange={(e) => modifier(i, "nom", e.target.value)} aria-label="Nom et prénoms du bénéficiaire" className={entree} /></td>
                <td className="p-1"><input name="benef_lien" value={l.lien} onChange={(e) => modifier(i, "lien", e.target.value)} aria-label="Lien avec l'assuré" className={entree} /></td>
                <td className="p-1"><input name="benef_contact" value={l.contact} onChange={(e) => modifier(i, "contact", e.target.value)} aria-label="Contact" className={entree} /></td>
                <td className="p-1"><input name="benef_quote" value={l.quote} onChange={(e) => modifier(i, "quote", e.target.value)} inputMode="decimal" aria-label="Quote-part en pourcentage" placeholder="50" className={entree} /></td>
                <td className="p-1"><button type="button" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))} className="rounded border border-bordure px-2 py-1">Retirer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-zinc-600">Aucun bénéficiaire saisi.</p>
      )}
      <button type="button" onClick={() => setLignes((x) => [...x, { nom: "", lien: "", contact: "", quote: "" }])} className="mt-2 rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">
        + Ajouter un bénéficiaire
      </button>
    </div>
  );
}

export type LigneContactUrgence = { nom: string; contact: string };

/** Contacts d'urgence (dictionnaire contacts_urgence[]) : nom et contact de chaque personne à prévenir. */
export function LignesContactsUrgence({ initiales }: { initiales: LigneContactUrgence[] }) {
  const [lignes, setLignes] = useState<LigneContactUrgence[]>(initiales);
  const modifier = (i: number, champ: keyof LigneContactUrgence, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="mb-4">
      {lignes.map((l, i) => (
        <div key={i} className="mb-2 flex max-w-2xl gap-2">
          <input name="urgence_nom" value={l.nom} onChange={(e) => modifier(i, "nom", e.target.value)} aria-label="Nom et prénoms du contact d'urgence" placeholder="Nom et prénoms" className={entree} />
          <input name="urgence_contact" value={l.contact} onChange={(e) => modifier(i, "contact", e.target.value)} aria-label="Contact" placeholder="Téléphone" className={entree} />
          <button type="button" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))} className="rounded border border-bordure px-2 py-1">Retirer</button>
        </div>
      ))}
      <button type="button" onClick={() => setLignes((x) => [...x, { nom: "", contact: "" }])} className="rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">
        + Ajouter un contact d'urgence
      </button>
    </div>
  );
}
