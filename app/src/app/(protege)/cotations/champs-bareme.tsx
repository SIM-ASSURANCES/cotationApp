"use client";

import { startTransition, useActionState, useState, type MouseEvent } from "react";

import { FormulaireCotation } from "@/composants/bareme/FormulaireCotation";
import { Bandeau, Bouton, Carte, Tableau } from "@/composants/ui";
import type { DescripteurSaisie } from "@/domaine/bareme/formulaire";
import type { Saisie } from "@/domaine/bareme/schema";
import { formaterMontant, montant } from "@/domaine/calcul/montant";

import { calculerLaPrimeBareme, type EtatCalculBareme } from "./actions";

const f = (texte: string) => formaterMontant(montant(texte));

/**
 * Écran de cotation généré depuis le barème publié (B6a, D51) : un bloc par rubrique du barème, les champs avec leur condition
 * d'affichage, les cases de souscription par garantie et par composante. Le bouton « Calculer » appelle le serveur (même calcul
 * que l'enregistrement) ; toute modification d'un champ efface le résultat affiché. Rien ici ne connaît un taux : le descripteur
 * ne porte que ce que le Commercial voit.
 */
export function ChampsBareme({ descripteur, initiale }: { descripteur: DescripteurSaisie; initiale?: Saisie }) {
  const [etat, calculer, enCours] = useActionState<EtatCalculBareme, FormData>(calculerLaPrimeBareme, {});
  // Le résultat est celui d'un état précis du formulaire : une modification le périme (l'objet d'état reçu n'est plus affiché).
  const [perime, setPerime] = useState<EtatCalculBareme | null>(null);
  const resultat = etat === perime ? {} : etat;

  // « Calculer » ne soumet PAS le formulaire : React 19 le remettrait à zéro à la fin de l'action (les champs saisis seraient perdus).
  // Le bouton lit les valeurs (FormData) et lance le calcul dans une transition ; aucun champ n'est touché.
  const lancerLeCalcul = (e: MouseEvent<HTMLButtonElement>) => {
    const formulaire = e.currentTarget.form;
    if (!formulaire) return;
    const donnees = new FormData(formulaire);
    startTransition(() => calculer(donnees));
  };

  return (
    <>
      <input type="hidden" name="baremeProduit" value="1" />
      <FormulaireCotation
        descripteur={descripteur}
        initiale={initiale}
        onChangeSaisie={() => setPerime(etat)}
        apres={
          <Carte titre="Prime">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Bouton type="button" data-calculer onClick={lancerLeCalcul} variante="secondaire" attente={enCours} disabled={enCours}>
                {enCours ? "Calcul en cours…" : "Calculer"}
              </Bouton>
              <span className="text-sm text-neutral">Le calcul vérifie la saisie ; l&apos;enregistrement du brouillon recalcule toujours depuis le barème publié.</span>
            </div>
            {resultat.erreur ? (
              <Bandeau ton="danger" role="alert" titre={resultat.erreur}>
                {resultat.details?.length ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {resultat.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </Bandeau>
            ) : null}
            {resultat.resultat ? (
              <div aria-live="polite">
                <Tableau
                  legende="Primes calculées au barème"
                  lignes={[...resultat.resultat.lignes.map((l, i) => ({ cle: String(i), ...l })), { cle: "TOTAL", libelle: "Total", branche: "", montantGaranti: null, ...resultat.resultat.totaux }]}
                  cleLigne={(l) => l.cle}
                  colonnes={[
                    { cle: "libelle", entete: "Garantie", className: "font-medium", rendu: (l) => l.libelle },
                    { cle: "garanti", entete: "Montant garanti", alignement: "droite", rendu: (l) => (l.montantGaranti ? f(l.montantGaranti) : "—") },
                    { cle: "nette", entete: "Prime nette", alignement: "droite", rendu: (l) => f(l.nette) },
                    { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => f(l.accessoires) },
                    { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => f(l.taxe) },
                    { cle: "ttc", entete: "TTC", alignement: "droite", className: "font-semibold", rendu: (l) => f(l.ttc) },
                  ]}
                />
                <p className="mt-2 text-sm text-neutral">Barème publié (empreinte {resultat.resultat.empreinte.slice(0, 16)}…). Ces montants sont recalculés à l&apos;enregistrement.</p>
              </div>
            ) : perime !== null && etat === perime ? (
              <p className="text-sm text-neutral">La saisie a changé : calculez de nouveau.</p>
            ) : null}
          </Carte>
        }
      />
    </>
  );
}
