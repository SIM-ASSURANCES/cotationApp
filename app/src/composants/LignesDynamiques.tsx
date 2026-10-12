"use client";

import { useState } from "react";

import { Bouton, Champ, ListeDeroulante } from "@/composants/ui";

// Tableau manuel (cellules = champs) aux classes du composant Tableau. Pas de zébrure : un champ teinté ne doit pas reposer sur un fond bg-muted.
const ENTETE = "border-b border-border bg-muted px-3 py-2 text-left font-medium text-neutral";
const CELLULE = "border-b border-border px-2 py-1.5 align-top";
const CORPS = "bg-surface [&>tr:last-child>td]:border-b-0";
const ZONE_TABLEAU = "relative overflow-x-auto rounded-md border border-border shadow-elevated";

export type LigneAssure = { nom: string; naissance: string; sexe: string; lien: string; identification: string; formule: string };

/** Assurés d'une cotation (dictionnaire assures[]) : ajout et retrait de lignes. Champs de même nom : lus par getAll. */
export function LignesAssures({ initiales, formules }: { initiales: LigneAssure[]; formules: { code: string; libelle: string }[] }) {
  const [lignes, setLignes] = useState<LigneAssure[]>(initiales);
  const modifier = (i: number, champ: keyof LigneAssure, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="space-y-3">
      {lignes.length > 0 ? (
        <div className={ZONE_TABLEAU}>
          <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className={ENTETE}>Nom et prénoms</th>
                <th scope="col" className={ENTETE}>Naissance (AAAA-MM-JJ)</th>
                <th scope="col" className={ENTETE}>Sexe</th>
                <th scope="col" className={ENTETE}>Lien (filiation)</th>
                <th scope="col" className={ENTETE}>Pièce d&apos;identité (facultatif)</th>
                {formules.length > 0 ? <th scope="col" className={ENTETE}>Formule</th> : null}
                <th scope="col" className={ENTETE}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className={CORPS}>
              {lignes.map((l, i) => (
                <tr key={i}>
                  <td className={CELLULE}><Champ name="assure_nom" value={l.nom} onChange={(e) => modifier(i, "nom", e.target.value)} aria-label="Nom et prénoms" /></td>
                  <td className={CELLULE}><Champ name="assure_naissance" value={l.naissance} onChange={(e) => modifier(i, "naissance", e.target.value)} aria-label="Date de naissance" placeholder="1990-05-15" /></td>
                  <td className={CELLULE}>
                    <ListeDeroulante
                      name="assure_sexe"
                      value={l.sexe}
                      onChange={(e) => modifier(i, "sexe", e.target.value)}
                      aria-label="Sexe"
                      options={[{ valeur: "", libelle: "—" }, { valeur: "M", libelle: "M" }, { valeur: "F", libelle: "F" }]}
                    />
                  </td>
                  <td className={CELLULE}><Champ name="assure_lien" value={l.lien} onChange={(e) => modifier(i, "lien", e.target.value)} aria-label="Lien" /></td>
                  <td className={CELLULE}><Champ name="assure_identification" value={l.identification} onChange={(e) => modifier(i, "identification", e.target.value)} aria-label="Pièce d'identité" placeholder="CNI, passeport…" /></td>
                  {formules.length > 0 ? (
                    <td className={CELLULE}>
                      <ListeDeroulante
                        name="assure_formule"
                        value={l.formule}
                        onChange={(e) => modifier(i, "formule", e.target.value)}
                        aria-label="Formule"
                        options={[{ valeur: "", libelle: "—" }, ...formules.map((f) => ({ valeur: f.code, libelle: f.code }))]}
                      />
                    </td>
                  ) : null}
                  <td className={CELLULE}><Bouton variante="secondaire" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))}>Retirer</Bouton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-neutral">Aucun assuré saisi (facultatif à ce stade).</p>
      )}
      <Bouton variante="secondaire" onClick={() => setLignes((x) => [...x, { nom: "", naissance: "", sexe: "", lien: "", identification: "", formule: "" }])}>
        + Ajouter un assuré
      </Bouton>
    </div>
  );
}

export type LigneRisque = { cle: string; valeur: string };

/** Champs propres au produit (risque.*) : nom en minuscules et valeur. */
export function LignesRisque({ initiales }: { initiales: LigneRisque[] }) {
  const [lignes, setLignes] = useState<LigneRisque[]>(initiales);
  const modifier = (i: number, champ: keyof LigneRisque, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="space-y-3">
      {lignes.map((l, i) => (
        // Une colonne sous sm : deux champs et un bouton ne tiennent pas côte à côte sur 390 px.
        <div key={i} className="flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1"><Champ name="risque_cle" value={l.cle} onChange={(e) => modifier(i, "cle", e.target.value)} aria-label="Nom du champ (risque.…)" placeholder="marque" /></div>
          <div className="min-w-0 flex-1"><Champ name="risque_valeur" value={l.valeur} onChange={(e) => modifier(i, "valeur", e.target.value)} aria-label="Valeur" /></div>
          <Bouton variante="secondaire" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))}>Retirer</Bouton>
        </div>
      ))}
      <Bouton variante="secondaire" onClick={() => setLignes((x) => [...x, { cle: "", valeur: "" }])}>
        + Ajouter un champ de risque
      </Bouton>
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
    <div className="space-y-3">
      {lignes.length > 0 ? (
        <div className={ZONE_TABLEAU}>
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className={ENTETE}>Nom et prénoms</th>
                <th scope="col" className={ENTETE}>Lien avec l'assuré</th>
                <th scope="col" className={ENTETE}>Contact</th>
                <th scope="col" className={ENTETE}>Quote-part (%)</th>
                <th scope="col" className={ENTETE}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className={CORPS}>
              {lignes.map((l, i) => (
                <tr key={i}>
                  <td className={CELLULE}><Champ name="benef_nom" value={l.nom} onChange={(e) => modifier(i, "nom", e.target.value)} aria-label="Nom et prénoms du bénéficiaire" /></td>
                  <td className={CELLULE}><Champ name="benef_lien" value={l.lien} onChange={(e) => modifier(i, "lien", e.target.value)} aria-label="Lien avec l'assuré" /></td>
                  <td className={CELLULE}><Champ name="benef_contact" value={l.contact} onChange={(e) => modifier(i, "contact", e.target.value)} aria-label="Contact" /></td>
                  <td className={CELLULE}><Champ name="benef_quote" value={l.quote} onChange={(e) => modifier(i, "quote", e.target.value)} inputMode="decimal" aria-label="Quote-part en pourcentage" placeholder="50" className="text-right tabular-nums" /></td>
                  <td className={CELLULE}><Bouton variante="secondaire" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))}>Retirer</Bouton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-neutral">Aucun bénéficiaire saisi.</p>
      )}
      <Bouton variante="secondaire" onClick={() => setLignes((x) => [...x, { nom: "", lien: "", contact: "", quote: "" }])}>
        + Ajouter un bénéficiaire
      </Bouton>
    </div>
  );
}

export type LigneContactUrgence = { nom: string; contact: string };

/** Contacts d'urgence (dictionnaire contacts_urgence[]) : nom et contact de chaque personne à prévenir. */
export function LignesContactsUrgence({ initiales }: { initiales: LigneContactUrgence[] }) {
  const [lignes, setLignes] = useState<LigneContactUrgence[]>(initiales);
  const modifier = (i: number, champ: keyof LigneContactUrgence, valeur: string) => setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: valeur } : x)));

  return (
    <div className="space-y-3">
      {lignes.map((l, i) => (
        <div key={i} className="flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1"><Champ name="urgence_nom" value={l.nom} onChange={(e) => modifier(i, "nom", e.target.value)} aria-label="Nom et prénoms du contact d'urgence" placeholder="Nom et prénoms" /></div>
          <div className="min-w-0 flex-1"><Champ name="urgence_contact" value={l.contact} onChange={(e) => modifier(i, "contact", e.target.value)} aria-label="Contact" placeholder="Téléphone" /></div>
          <Bouton variante="secondaire" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))}>Retirer</Bouton>
        </div>
      ))}
      <Bouton variante="secondaire" onClick={() => setLignes((x) => [...x, { nom: "", contact: "" }])}>
        + Ajouter un contact d'urgence
      </Bouton>
    </div>
  );
}
