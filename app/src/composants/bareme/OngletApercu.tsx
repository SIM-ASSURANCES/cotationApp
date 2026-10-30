"use client";

import { useMemo } from "react";

import { Bandeau } from "@/composants/ui";
import { descripteurSaisie, type Bareme } from "@/domaine/bareme";

import { SOUS_TITRE } from "./commun";
import { decrireCondition, FormulaireCotation } from "./FormulaireCotation";

/**
 * Onglet « Aperçu Commercial » (B5, D59) : le formulaire de cotation tel que le Commercial le verra, généré depuis le BROUILLON affiché
 * (même composant que la cotation). Aucun calcul, aucune cotation, rien d'enregistré : on peut y répondre pour voir apparaître ou
 * disparaître les champs conditionnels (la condition de chacun est écrite sous son champ), mais les réponses ne vont nulle part. Le
 * descripteur ne porte ni taux, ni table, ni assiette : le Commercial ne les voit jamais.
 */
export function OngletApercu({ doc }: { doc: Bareme }) {
  const descripteur = useMemo(() => descripteurSaisie(doc), [doc]);
  // Si la structure du formulaire change (champ ajouté, bloc renommé…), l'aperçu repart d'un formulaire vierge.
  const structure = useMemo(() => JSON.stringify(descripteur), [descripteur]);
  const conditionnels = [
    ...descripteur.champs.filter((c) => c.si).map((c) => ({ cle: `champ-${c.code}`, nom: `Champ « ${c.libelle} »`, condition: decrireCondition(descripteur, c.si!) })),
    ...descripteur.garanties.filter((g) => g.si).map((g) => ({ cle: `garantie-${g.code}`, nom: `Garantie « ${g.nom} »`, condition: decrireCondition(descripteur, g.si!) })),
  ];
  return (
    <section aria-labelledby="apercu" className="space-y-3">
      <h3 id="apercu" className={SOUS_TITRE}>
        Aperçu Commercial
      </h3>
      <Bandeau ton="info">Aperçu du brouillon affiché, sans enregistrement ni calcul : vos réponses ne sont pas conservées. Répondez pour voir les champs conditionnels apparaître.</Bandeau>
      {descripteur.champs.length === 0 ? <p className="text-sm text-muted-foreground">Aucun champ : le Commercial ne verrait que les garanties.</p> : null}
      {conditionnels.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-border p-3">
          <h4 className="text-sm font-bold text-foreground">Ce qui s&apos;affiche selon les réponses</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {conditionnels.map((c) => (
              <li key={c.cle}>
                {c.nom} : affiché si {c.condition}.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-lg border border-dashed border-border p-3">
        <FormulaireCotation key={structure} descripteur={descripteur} montrerConditions />
      </div>
    </section>
  );
}
