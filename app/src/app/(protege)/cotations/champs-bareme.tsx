"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { creerCalculDiffere, DELAI_CALCUL_MS } from "@/composants/bareme/calculDiffere";
import { FormulaireCotation, type ChangementSaisie } from "@/composants/bareme/FormulaireCotation";
import { composantesAMontrer, libelleSousLigne, montantSousLigne } from "@/composants/bareme/sousLignes";
import { Bandeau, Bouton, Carte, Tableau } from "@/composants/ui";
import { champsHorsPlage, champsManquants, etatDepuisSaisie, type DescripteurSaisie } from "@/domaine/bareme/formulaire";
import type { Saisie } from "@/domaine/bareme/schema";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { libelleDureeEtProrata } from "@/domaine/calcul/libelle-prorata";

import { calculerLaPrimeBareme, type EtatCalculBareme } from "./actions";

const f = (texte: string) => formaterMontant(montant(texte));

/** Champs du formulaire parent dont le calcul a besoin (le serveur refuse sans eux) : libellés des manquants. */
function manquantsDuFormulaire(formulaire: HTMLFormElement): string[] {
  const donnees = new FormData(formulaire);
  const rempli = (nom: string) => String(donnees.get(nom) ?? "").trim() !== "";
  const manquants: string[] = [];
  if (!rempli("typeContrat") && !rempli("regimeTaxe")) manquants.push("Type de contrat");
  if (!rempli("dateEffet")) manquants.push("Date d'effet");
  return manquants;
}

/**
 * Écran de cotation généré depuis le barème publié (B6a, D51) : un bloc par rubrique du barème, les champs avec leur condition
 * d'affichage, les cases de souscription par garantie et par composante. Le calcul est AUTOMATIQUE (D62) : après chaque modification,
 * une fois la frappe terminée (≈ 600 ms), le serveur calcule si les champs obligatoires visibles sont remplis ; sinon l'écran dit
 * « Complétez : … » sans rien envoyer. Le bouton « Calculer » reste (secours, et touche Entrée). Rien ici ne connaît un taux ni ne calcule
 * un montant : le serveur est la seule source (D4) et l'enregistrement recalcule toujours. Le descripteur ne porte que ce que le Commercial voit.
 */
export function ChampsBareme({ descripteur, initiale }: { descripteur: DescripteurSaisie; initiale?: Saisie }) {
  const [etat, setEtat] = useState<EtatCalculBareme>({});
  const [manquants, setManquants] = useState<string[]>([]);
  // D64 : valeurs saisies hors de la plage du barème ; tant qu'il y en a, aucun calcul ne part.
  const [horsPlage, setHorsPlage] = useState<string[]>([]);
  const [attente, setAttente] = useState(false);
  const [panne, setPanne] = useState(false);
  // Le formulaire parent (celui du champ caché ci-dessous), connu après le premier rendu.
  const [formulaire, setFormulaire] = useState<HTMLFormElement | null>(null);
  // Dernier état connu des champs du barème (le formulaire le signale à chaque changement) ; celui de départ vient de la saisie enregistrée.
  const dernier = useRef<ChangementSaisie>({ etat: etatDepuisSaisie(initiale), effectif: initiale?.effectif !== undefined ? String(initiale.effectif) : "" });
  const descripteurCourant = useRef(descripteur);
  useEffect(() => {
    descripteurCourant.current = descripteur;
  }, [descripteur]);

  // Le calcul lit le formulaire AU DÉPART de la requête (saisie du moment) ; le formulaire parent n'est jamais soumis ni remis à zéro.
  const calcul = useMemo(
    () =>
      creerCalculDiffere<EtatCalculBareme>({
        delaiMs: DELAI_CALCUL_MS,
        executer: async () => (formulaire ? calculerLaPrimeBareme({}, new FormData(formulaire)) : {}),
        surResultat: (r) => {
          setPanne(false);
          setEtat(r);
        },
        surErreur: () => setPanne(true),
        surAttente: setAttente,
      }),
    [formulaire],
  );
  useEffect(() => () => calcul.annuler(), [calcul]);

  // Une modification : incomplet → message neutre et rien ne part ; complet → calcul différé.
  const evaluer = useCallback(() => {
    if (!formulaire) return;
    const manque = [...manquantsDuFormulaire(formulaire), ...champsManquants(descripteurCourant.current, dernier.current.etat, dernier.current.effectif)];
    const hors = champsHorsPlage(descripteurCourant.current, dernier.current.etat);
    setManquants(manque);
    setHorsPlage(hors);
    if (manque.length > 0 || hors.length > 0) {
      calcul.annuler();
      setEtat({});
      setPanne(false);
    } else calcul.planifier();
  }, [formulaire, calcul]);

  // Les champs hors du barème (type de contrat, dates…) changent aussi le calcul : on écoute le formulaire, sauf les champs du barème
  // (leur changement arrive par `onChangeSaisie`, avec l'état à jour).
  useEffect(() => {
    if (!formulaire) return;
    const ecouteur = (e: Event) => {
      if (e.target instanceof Element && e.target.closest("[data-formulaire-bareme]")) return;
      evaluer();
    };
    formulaire.addEventListener("input", ecouteur);
    formulaire.addEventListener("change", ecouteur);
    return () => {
      formulaire.removeEventListener("input", ecouteur);
      formulaire.removeEventListener("change", ecouteur);
    };
  }, [formulaire, evaluer]);

  return (
    <>
      <input ref={(el) => setFormulaire(el?.form ?? null)} type="hidden" name="baremeProduit" value="1" />
      <FormulaireCotation
        descripteur={descripteur}
        initiale={initiale}
        onChangeSaisie={(changement) => {
          dernier.current = changement;
          evaluer();
        }}
        apres={
          <Carte titre="Prime">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Bouton type="button" data-calculer onClick={() => calcul.maintenant()} variante="secondaire">
                Calculer
              </Bouton>
              <span role="status" className="min-h-5 text-sm text-neutral">
                {attente && manquants.length === 0 ? "Calcul en cours…" : ""}
              </span>
            </div>
            <p className="mb-3 text-sm text-neutral">Le calcul se fait tout seul quand la saisie est complète ; l&apos;enregistrement du brouillon recalcule toujours depuis le barème publié.</p>
            {panne ? (
              <Bandeau ton="danger" role="alert">
                Le calcul n&apos;a pas abouti. Réessayez avec « Calculer ».
              </Bandeau>
            ) : etat.erreur ? (
              <Bandeau ton="danger" role="alert" titre={etat.erreur}>
                {etat.details?.length ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {etat.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </Bandeau>
            ) : null}
            {horsPlage.length > 0 ? (
              <Bandeau ton="danger" role="alert" titre="Une valeur est hors de sa plage : le calcul ne part pas.">
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {horsPlage.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </Bandeau>
            ) : null}
            {manquants.length > 0 && horsPlage.length === 0 && !etat.resultat ? <p className="text-sm text-neutral">Complétez : {manquants.join(", ")}.</p> : null}
            {etat.resultat ? (
              <div aria-live="polite" aria-busy={attente} className={attente ? "opacity-60" : undefined}>
                <Tableau
                  legende="Primes calculées au barème"
                  lignes={[
                    ...etat.resultat.lignes.flatMap((l, i) => [
                      { sous: false, cle: String(i), ...l },
                      // H173 : sous la ligne d'une garantie à plusieurs composantes, une sous-ligne par composante (sans accessoires ni taxe).
                      ...composantesAMontrer(l.composantes).map((c) => ({ sous: true, cle: `${i}-${c.code}`, libelle: c.libelle, branche: "", montantGaranti: c.montantGaranti, nette: c.primeNette, accessoires: "", taxe: "", ttc: "" })),
                    ]),
                    { sous: false, cle: "TOTAL", libelle: "Total", branche: "", montantGaranti: null, ...etat.resultat.totaux },
                  ]}
                  cleLigne={(l) => l.cle}
                  colonnes={[
                    { cle: "libelle", entete: "Garantie", className: "font-medium", rendu: (l) => (l.sous ? libelleSousLigne(l.libelle) : l.libelle) },
                    { cle: "garanti", entete: "Montant garanti", alignement: "droite", rendu: (l) => (l.montantGaranti ? (l.sous ? montantSousLigne(f(l.montantGaranti)) : f(l.montantGaranti)) : "—") },
                    { cle: "nette", entete: "Prime nette", alignement: "droite", rendu: (l) => (l.sous ? montantSousLigne(f(l.nette)) : f(l.nette)) },
                    { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => (l.sous ? null : f(l.accessoires)) },
                    { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => (l.sous ? null : f(l.taxe)) },
                    { cle: "ttc", entete: "TTC", alignement: "droite", className: "font-semibold", rendu: (l) => (l.sous ? null : f(l.ttc)) },
                  ]}
                />
                <p className="mt-2 text-sm text-neutral">{libelleDureeEtProrata(etat.resultat.prorata.jours, etat.resultat.prorata.coefficient, etat.resultat.prorata.actif)}.</p>
                <p className="mt-2 text-sm text-neutral">Barème publié (empreinte {etat.resultat.empreinte.slice(0, 16)}…). Ces montants sont recalculés à l&apos;enregistrement.</p>
              </div>
            ) : null}
          </Carte>
        }
      />
    </>
  );
}
