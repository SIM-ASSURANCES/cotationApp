"use client";

import { useState } from "react";

import { Bouton, Champ } from "@/composants/ui";
import { PROFONDEUR_MAX, codesChampsEtIntermediaires, deplacer, profondeur, proposerCode, renommerIntermediaire, supprimerIntermediaire, MESSAGE_PROFONDEUR, type Operande } from "@/domaine/bareme";

import { ActionsElement, ChampCode, Depliable, SOUS_TITRE, useOuverts, type ContexteEdition } from "./commun";
import { EditeurOperande } from "./EditeurOperande";

/**
 * Onglet « Intermédiaires » : valeurs nommées calculées avant les garanties (capital immobilier, contenu…), réutilisables dans
 * les assiettes. Une valeur ne lit que celles qui la précèdent dans la liste.
 */
export function OngletIntermediaires({ ctx, disabled }: { ctx: ContexteEdition; disabled: boolean }) {
  const { doc, maj, appliquer, refuser } = ctx;
  const ouverts = useOuverts();
  const [nomNeuf, setNomNeuf] = useState("");

  const ajouter = () => {
    const nom = nomNeuf.trim();
    if (nom === "") return refuser(["Donnez un nom à la valeur intermédiaire : son code en est proposé."]);
    const code = proposerCode(nom, codesChampsEtIntermediaires(doc), "valeur");
    maj((b) => ({ ...b, intermediaires: [...b.intermediaires, { code, op: "0" }] }));
    ouverts.ouvrir(code);
    setNomNeuf("");
  };
  const changer = (code: string, op: Operande) => {
    if (profondeur(op) > PROFONDEUR_MAX) return refuser([MESSAGE_PROFONDEUR]);
    maj((b) => ({ ...b, intermediaires: b.intermediaires.map((i) => (i.code === code ? { ...i, op } : i)) }));
  };

  return (
    <section aria-labelledby="intermediaires" className="space-y-3">
      <h3 id="intermediaires" className={SOUS_TITRE}>
        Valeurs intermédiaires ({doc.intermediaires.length})
      </h3>
      <p className="text-sm text-muted-foreground">
        Un montant calculé une fois, nommé, que les assiettes des garanties peuvent reprendre. Une valeur ne peut lire que les valeurs placées avant elle. Au plus {PROFONDEUR_MAX} niveaux d&apos;opérations dans un calcul : au-delà, nommez une valeur intermédiaire.
      </p>
      {!disabled ? (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Champ label="Nouvelle valeur intermédiaire (nom)" value={nomNeuf} autoComplete="off" onChange={(e) => setNomNeuf(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ajouter())} />
          <Bouton onClick={ajouter}>Ajouter la valeur</Bouton>
        </div>
      ) : null}
      {doc.intermediaires.length === 0 ? <p className="text-sm text-muted-foreground">Aucune valeur intermédiaire.</p> : null}
      {doc.intermediaires.map((inter, i) => {
        const fige = ctx.figes.has(inter.code);
        return (
          <Depliable key={inter.code} ouvert={ouverts.estOuvert(inter.code)} onBascule={(o) => ouverts.bascule(inter.code, o)} titre={inter.code} sousTitre={`${i + 1}ᵉ valeur`}>
            <ChampCode
              key={inter.code}
              label="Code (balise risque.<code> des documents)"
              valeur={inter.code}
              disabled={disabled || fige}
              aide={fige ? "Cette valeur figure dans un barème publié : son code ne change plus." : undefined}
              valider={(nouveau) => {
                const r = renommerIntermediaire(doc, inter.code, nouveau, ctx.figes);
                appliquer(r);
                if (r.ok) ouverts.renommer(inter.code, nouveau);
                return r.ok;
              }}
            />
            <EditeurOperande
              b={doc}
              op={inter.op}
              etiquette="Cette valeur est"
              intermediaires={doc.intermediaires.slice(0, i).map((x) => x.code)}
              disabled={disabled}
              onChange={(op) => changer(inter.code, op)}
            />
            {!disabled ? (
              <ActionsElement
                nom={`la valeur ${inter.code}`}
                onMonter={i > 0 ? () => maj((b) => ({ ...b, intermediaires: deplacer(b.intermediaires, i, -1) })) : undefined}
                onDescendre={i < doc.intermediaires.length - 1 ? () => maj((b) => ({ ...b, intermediaires: deplacer(b.intermediaires, i, 1) })) : undefined}
                onSupprimer={() => appliquer(supprimerIntermediaire(doc, inter.code))}
              />
            ) : null}
          </Depliable>
        );
      })}
    </section>
  );
}
