"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { creerCalculDiffere, DELAI_CALCUL_MS } from "@/composants/bareme/calculDiffere";
import { Bandeau, Bouton, Tableau } from "@/composants/ui";
import { libelleDureeEtProrata } from "@/domaine/calcul/libelle-prorata";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { champsManquantsFormules, nomChangeLeCalcul } from "@/domaine/cotation/calcul-automatique";

import { calculerLaPrimeFormules, type EtatCalculFormules } from "./actions";

const f = (texte: string) => formaterMontant(montant(texte));

type Ligne = { cle: string; libelle: string; effectif: string; nette: string; accessoires: string; taxe: string; ttc: string };

/** Ce que l'écran lit dans le formulaire pour décider d'envoyer : texte brut, jamais interprété. */
function manquantsDuFormulaire(formulaire: HTMLFormElement): string[] {
  const donnees = new FormData(formulaire);
  const texte = (nom: string) => String(donnees.get(nom) ?? "");
  return champsManquantsFormules({
    typeContrat: texte("typeContrat"),
    dateEffet: texte("dateEffet"),
    dateEcheance: texte("dateEcheance"),
    effectifs: [...donnees.entries()].filter(([nom]) => nom.startsWith("eff_")).map(([, v]) => String(v)),
  });
}

/**
 * Calcul automatique d'une cotation par formules (D63), avec le MÊME mécanisme que la cotation au barème (D62, `calculDiffere`) : après
 * chaque modification d'un champ du calcul, une fois la frappe terminée (≈ 600 ms), le serveur calcule si la saisie est complète ; sinon
 * « Complétez : … » sans rien envoyer. Une seule requête en vol, réponse périmée ignorée, bouton « Calculer » conservé (secours, et touche
 * Entrée). Jamais de calcul dans le navigateur : le serveur est la seule source des montants (D4) et l'enregistrement recalcule toujours.
 */
export function CalculFormules({ calculerAuDepart = false }: { calculerAuDepart?: boolean }) {
  const [etat, setEtat] = useState<EtatCalculFormules>({});
  const [manquants, setManquants] = useState<string[]>([]);
  const [attente, setAttente] = useState(false);
  const [panne, setPanne] = useState(false);
  // Le formulaire parent, connu après le premier rendu.
  const [formulaire, setFormulaire] = useState<HTMLFormElement | null>(null);

  // Le calcul lit le formulaire AU DÉPART de la requête (saisie du moment) ; le formulaire parent n'est jamais soumis ni remis à zéro.
  const calcul = useMemo(
    () =>
      creerCalculDiffere<EtatCalculFormules>({
        delaiMs: DELAI_CALCUL_MS,
        executer: async () => (formulaire ? calculerLaPrimeFormules({}, new FormData(formulaire)) : {}),
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

  // Une modification : incomplet → message neutre et rien ne part ; complet → calcul différé (ou immédiat : bouton « Calculer »).
  const evaluer = useCallback(
    (immediat = false) => {
      if (!formulaire) return;
      const manque = manquantsDuFormulaire(formulaire);
      setManquants(manque);
      if (manque.length > 0) {
        calcul.annuler();
        setEtat({});
        setPanne(false);
      } else if (immediat) calcul.maintenant();
      else calcul.planifier();
    },
    [formulaire, calcul],
  );

  useEffect(() => {
    if (!formulaire) return;
    const ecouteur = (e: Event) => {
      if (e.target instanceof HTMLElement && "name" in e.target && nomChangeLeCalcul(String(e.target.name))) evaluer();
    };
    formulaire.addEventListener("input", ecouteur);
    formulaire.addEventListener("change", ecouteur);
    return () => {
      formulaire.removeEventListener("input", ecouteur);
      formulaire.removeEventListener("change", ecouteur);
    };
  }, [formulaire, evaluer]);

  // Modification d'un brouillon : les montants du moment s'affichent à l'ouverture.
  useEffect(() => {
    if (!calculerAuDepart || !formulaire) return;
    const depart = setTimeout(() => evaluer(), 0);
    return () => clearTimeout(depart);
  }, [calculerAuDepart, formulaire, evaluer]);

  const lignes: Ligne[] = etat.resultat
    ? [
        ...etat.resultat.lignes.map((l) => ({ cle: l.code, libelle: `${l.code} — ${l.libelle}`, effectif: String(l.effectif), nette: l.nette, accessoires: l.accessoires, taxe: l.taxe, ttc: l.ttc })),
        ...(etat.resultat.fraisFractionnement ? [{ cle: "FRAIS", libelle: "Frais de fractionnement", effectif: "", nette: "0", ...etat.resultat.fraisFractionnement }] : []),
        { cle: "TOTAL", libelle: "Total", effectif: "", ...etat.resultat.totaux },
      ]
    : [];

  return (
    <div className="mt-4">
      <span ref={(el) => setFormulaire(el?.closest("form") ?? null)} hidden />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Bouton type="button" data-calculer onClick={() => evaluer(true)} variante="secondaire">
          Calculer
        </Bouton>
        <span role="status" className="min-h-5 text-sm text-neutral">
          {attente && manquants.length === 0 ? "Calcul en cours…" : ""}
        </span>
      </div>
      <p className="mb-3 text-sm text-neutral">Le calcul se fait tout seul quand la saisie est complète ; l&apos;enregistrement du brouillon recalcule toujours.</p>
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
      {manquants.length > 0 && !etat.resultat ? <p className="text-sm text-neutral">Complétez : {manquants.join(", ")}.</p> : null}
      {etat.resultat ? (
        <div aria-live="polite" aria-busy={attente} className={attente ? "opacity-60" : undefined}>
          <Tableau
            legende="Primes calculées par formule"
            lignes={lignes}
            cleLigne={(l) => l.cle}
            colonnes={[
              { cle: "libelle", entete: "Formule", className: "font-medium", rendu: (l) => l.libelle },
              { cle: "effectif", entete: "Effectif", alignement: "droite", rendu: (l) => l.effectif },
              { cle: "nette", entete: "Prime nette", alignement: "droite", rendu: (l) => f(l.nette) },
              { cle: "accessoires", entete: "Accessoires", alignement: "droite", rendu: (l) => f(l.accessoires) },
              { cle: "taxe", entete: "Taxe", alignement: "droite", rendu: (l) => f(l.taxe) },
              { cle: "ttc", entete: "TTC", alignement: "droite", className: "font-semibold", rendu: (l) => f(l.ttc) },
            ]}
          />
          <p className="mt-2 text-sm text-neutral">{libelleDureeEtProrata(etat.resultat.prorata.jours, etat.resultat.prorata.coefficient, etat.resultat.prorata.actif)}.</p>
          {etat.resultat.validation.length > 0 ? (
            <Bandeau ton="avertissement" role="status" className="mt-3">
              Cette cotation passerait « À valider » ({etat.resultat.validation.join(", ").toLowerCase()}).
            </Bandeau>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
