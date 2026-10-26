"use client";

import { useActionState, useState, type ChangeEvent } from "react";

import { ChampDate } from "@/composants/FormulaireAction";
import { Bandeau, Bouton, Carte, Champ, ListeDeroulante, Tableau } from "@/composants/ui";
import { champActif, etatDepuisSaisie, garantieSouscrite, type DescripteurChamp, type DescripteurSaisie, type EtatSaisie } from "@/domaine/bareme/formulaire";
import type { Saisie } from "@/domaine/bareme/schema";
import { formaterMontant, montant } from "@/domaine/calcul/montant";

import { calculerLaPrimeBareme, type EtatCalculBareme } from "./actions";

const SANS_BLOC = "__sans_bloc__";
const f = (texte: string) => formaterMontant(montant(texte));

/**
 * Écran de cotation généré depuis le barème publié (B6a, D51) : un bloc par rubrique du barème, les champs avec leur condition
 * d'affichage, les cases de souscription par garantie et par composante. Le bouton « Calculer » appelle le serveur (même calcul
 * que l'enregistrement) ; toute modification d'un champ efface le résultat affiché. Rien ici ne connaît un taux : le descripteur
 * ne porte que ce que le Commercial voit.
 */
export function ChampsBareme({ descripteur, initiale }: { descripteur: DescripteurSaisie; initiale?: Saisie }) {
  const [saisie, setSaisie] = useState<EtatSaisie>(() => etatDepuisSaisie(initiale));
  const [etat, calculer, enCours] = useActionState<EtatCalculBareme, FormData>(calculerLaPrimeBareme, {});
  // Le résultat est celui d'un état précis du formulaire : une modification le périme (l'objet d'état reçu n'est plus affiché).
  const [perime, setPerime] = useState<EtatCalculBareme | null>(null);
  const resultat = etat === perime ? {} : etat;

  // Un changement d'un champ du formulaire relit les champs du barème visibles ; ceux qui sont masqués gardent leur valeur.
  const aChange = (e: ChangeEvent<HTMLElement>) => {
    const formulaire = (e.target as HTMLElement).closest("form");
    if (!formulaire) return;
    const donnees = new FormData(formulaire);
    setSaisie((avant) => {
      const champs = { ...avant.champs };
      for (const c of descripteur.champs) if (champActif(descripteur, avant, c.code)) champs[c.code] = donnees.getAll(`bareme_${c.code}`).map(String);
      return { champs, souscrit: donnees.getAll("souscrit").map(String) };
    });
    setPerime(etat);
  };

  const blocs = [...descripteur.blocs.map((b) => ({ code: b.code, libelle: b.libelle })), ...(descripteur.champs.some((c) => !c.bloc) ? [{ code: SANS_BLOC, libelle: "Risque" }] : [])];

  return (
    <div className="space-y-6" onChange={aChange}>
      <input type="hidden" name="baremeProduit" value="1" />
      {blocs.map((bloc) => {
        const champs = descripteur.champs.filter((c) => (c.bloc ?? SANS_BLOC) === bloc.code && champActif(descripteur, saisie, c.code));
        if (champs.length === 0) return null;
        return (
          <Carte key={bloc.code} titre={bloc.libelle}>
            <div className="grid max-w-4xl gap-x-6 gap-y-1 sm:grid-cols-2">
              {champs.map((c) => (
                <ChampDuBareme key={c.code} champ={c} valeurs={saisie.champs[c.code] ?? []} />
              ))}
            </div>
          </Carte>
        );
      })}

      <Carte titre="Garanties" description="Cochez les garanties (ou composantes) souscrites ; les garanties obligatoires sont toujours calculées.">
        <div className="space-y-4">
          {descripteur.garanties.map((g) => {
            const optionnelles = g.composantes.filter((c) => c.optionnelle);
            const souscrite = garantieSouscrite(descripteur, saisie, g.code);
            return (
              <div key={g.code}>
                <p className="font-medium">
                  {g.nom}{" "}
                  <span className="text-sm font-normal text-neutral">
                    {g.souscription === "OBLIGATOIRE" ? "(obligatoire)" : g.souscription === "CONDITION" ? (souscrite ? "(incluse selon vos réponses)" : "(non applicable selon vos réponses)") : ""}
                  </span>
                </p>
                {g.definition ? <p className="text-sm text-muted-foreground">{g.definition}</p> : null}
                {g.souscription === "OPTIONNELLE" && optionnelles.length === 0 ? (
                  <Case nom="souscrit" valeur={g.code} cochee={saisie.souscrit.includes(g.code)} libelle={`Souscrire ${g.nom}`} />
                ) : (
                  optionnelles.map((c) => (
                    <Case
                      key={c.code}
                      nom="souscrit"
                      valeur={`${g.code}.${c.code}`}
                      cochee={saisie.souscrit.includes(`${g.code}.${c.code}`)}
                      libelle={g.composantes.length > 1 ? `${g.nom} : ${c.code}` : `Souscrire ${g.nom}`}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </Carte>

      {descripteur.effectif ? (
        <Carte titre="Effectif assuré">
          <div className="max-w-xs">
            <Champ label="Nombre d'assurés *" name="effectif" inputMode="numeric" defaultValue={initiale?.effectif !== undefined ? String(initiale.effectif) : ""} autoComplete="off" />
          </div>
        </Carte>
      ) : null}

      <Carte titre="Prime">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Bouton type="submit" formAction={calculer} formNoValidate variante="secondaire" attente={enCours} disabled={enCours}>
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
    </div>
  );
}

function Case({ nom, valeur, cochee, libelle }: { nom: string; valeur: string; cochee: boolean; libelle: string }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
      <input type="checkbox" name={nom} value={valeur} defaultChecked={cochee} className="size-4 accent-primary" /> {libelle}
    </label>
  );
}

function ChampDuBareme({ champ, valeurs }: { champ: DescripteurChamp; valeurs: string[] }) {
  const nom = `bareme_${champ.code}`;
  const libelle = `${champ.libelle}${champ.obligatoire ? " *" : ""}`;
  const aide = champ.aide;
  const premiere = valeurs[0] ?? "";
  switch (champ.type) {
    case "OUI_NON":
      return (
        <div className="mb-4">
          <ListeDeroulante
            label={libelle}
            aide={aide}
            name={nom}
            defaultValue={premiere}
            options={[
              { valeur: "", libelle: "—" },
              { valeur: "OUI", libelle: "Oui" },
              { valeur: "NON", libelle: "Non" },
            ]}
          />
        </div>
      );
    case "LISTE":
      return (
        <div className="mb-4">
          <ListeDeroulante label={libelle} aide={aide} name={nom} defaultValue={premiere} options={[{ valeur: "", libelle: "—" }, ...(champ.valeurs ?? []).map((v) => ({ valeur: v.v, libelle: v.l }))]} />
        </div>
      );
    case "CHOIX_MULTIPLES":
      return (
        <fieldset className="mb-4">
          <legend className="mb-1 text-sm font-medium">{libelle}</legend>
          {(champ.valeurs ?? []).map((v) => (
            <label key={v.v} className="flex min-h-10 items-center gap-2 text-sm lg:min-h-0">
              <input type="checkbox" name={nom} value={v.v} defaultChecked={valeurs.includes(v.v)} className="size-4 accent-primary" /> {v.l}
            </label>
          ))}
          {aide ? <p className="text-sm text-muted-foreground">{aide}</p> : null}
        </fieldset>
      );
    case "DATE":
      return <ChampDate nom={nom} libelle={libelle} requis={false} valeur={premiere} />;
    default:
      return <Champ label={libelle} aide={aide} name={nom} defaultValue={premiere} inputMode={champ.type === "TEXTE" ? undefined : "decimal"} autoComplete="off" />;
  }
}
