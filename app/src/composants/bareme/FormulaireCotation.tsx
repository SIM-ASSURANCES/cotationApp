"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { ChampDate } from "@/composants/FormulaireAction";
import { Carte, Champ, ListeDeroulante } from "@/composants/ui";
import { champActif, etatDepuisSaisie, garantieSouscrite, type DescripteurChamp, type DescripteurSaisie, type EtatSaisie } from "@/domaine/bareme/formulaire";
import type { ConditionAffichage, Saisie } from "@/domaine/bareme/schema";

const SANS_BLOC = "__sans_bloc__";

/** Ce que le formulaire sait de sa saisie après un changement : les valeurs des champs (ceux qui s'affichent), les cases cochées, l'effectif tapé. */
export type ChangementSaisie = { etat: EtatSaisie; effectif: string };

/**
 * Formulaire de cotation GÉNÉRÉ depuis un descripteur de barème (B6a, D51), un seul composant pour trois usages : la cotation du Commercial,
 * l'aperçu « Aperçu Commercial » de la Technique (B5) et la saisie d'un jeu d'essai (B5). Un bloc par rubrique du barème, les champs avec
 * leur condition d'affichage, les cases de souscription par garantie et composante, l'effectif. Rien ici ne connaît un taux : le
 * descripteur ne porte que ce que le Commercial voit.
 *
 * Les champs gardent leurs attributs `name` (`bareme_<code>`, `souscrit`, `effectif`) : dans la cotation, le formulaire parent envoie les
 * mêmes données qu'avant. Les valeurs sont lues dans le conteneur (pas dans un <form> : l'éditeur du barème n'en a pas, et la cotation en a déjà un).
 * `apres` : contenu placé sous les cartes (la carte « Prime » de la cotation).
 */
export function FormulaireCotation({
  descripteur,
  initiale,
  effectifInitial,
  onChangeSaisie,
  montrerConditions = false,
  apres,
}: {
  descripteur: DescripteurSaisie;
  initiale?: Saisie;
  effectifInitial?: string;
  onChangeSaisie?: (changement: ChangementSaisie) => void;
  /** Aperçu de la Technique : sous chaque champ conditionnel, la condition qui le fait apparaître. */
  montrerConditions?: boolean;
  apres?: ReactNode;
}) {
  const [saisie, setSaisie] = useState<EtatSaisie>(() => etatDepuisSaisie(initiale));
  const racine = useRef<HTMLDivElement>(null);

  // Un changement d'un champ relit les champs du barème visibles ; ceux qui sont masqués gardent leur valeur.
  const aChange = (e: ChangeEvent<HTMLElement>) => {
    const conteneur = racine.current;
    if (!conteneur || !(e.target instanceof HTMLElement) || !conteneur.contains(e.target)) return;
    const lire = (nom: string): string[] =>
      Array.from(conteneur.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="${nom}"]`))
        .filter((el) => !(el instanceof HTMLInputElement && el.type === "checkbox" && !el.checked))
        .map((el) => el.value);
    const champs = { ...saisie.champs };
    for (const c of descripteur.champs) if (champActif(descripteur, saisie, c.code)) champs[c.code] = lire(`bareme_${c.code}`);
    const etat: EtatSaisie = { champs, souscrit: lire("souscrit") };
    setSaisie(etat);
    onChangeSaisie?.({ etat, effectif: lire("effectif")[0] ?? "" });
  };

  const blocs = [...descripteur.blocs.map((b) => ({ code: b.code, libelle: b.libelle })), ...(descripteur.champs.some((c) => !c.bloc) ? [{ code: SANS_BLOC, libelle: "Risque" }] : [])];

  return (
    <div ref={racine} className="space-y-6" onChange={aChange}>
      {blocs.map((bloc) => {
        const champs = descripteur.champs.filter((c) => (c.bloc ?? SANS_BLOC) === bloc.code && champActif(descripteur, saisie, c.code));
        if (champs.length === 0) return null;
        return (
          <Carte key={bloc.code} titre={bloc.libelle}>
            <div className="grid max-w-4xl gap-x-6 gap-y-1 sm:grid-cols-2">
              {champs.map((c) => (
                <ChampDuBareme key={c.code} champ={c} valeurs={saisie.champs[c.code] ?? []} condition={montrerConditions && c.si ? decrireCondition(descripteur, c.si) : undefined} />
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
                {montrerConditions && g.si ? <p className="text-sm text-muted-foreground">Incluse si {decrireCondition(descripteur, g.si)}.</p> : null}
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
            <Champ label="Nombre d'assurés *" name="effectif" inputMode="numeric" defaultValue={effectifInitial ?? (initiale?.effectif !== undefined ? String(initiale.effectif) : "")} autoComplete="off" />
          </div>
        </Carte>
      ) : null}

      {apres}
    </div>
  );
}

/** La condition d'un champ ou d'une garantie, en français (« « Occupation » vaut « Locataire » »). */
export function decrireCondition(d: DescripteurSaisie, si: ConditionAffichage): string {
  if ("souscrit" in si) {
    const [g, c] = si.souscrit.split(".");
    const garantie = d.garanties.find((x) => x.code === g);
    return `la garantie « ${garantie?.nom ?? g} »${c ? ` (composante ${c})` : ""} est souscrite`;
  }
  const champ = d.champs.find((x) => x.code === si.champ);
  const valeur = "egal" in si ? si.egal : si.different;
  const libelle = champ?.type === "OUI_NON" ? (valeur === "OUI" ? "Oui" : valeur === "NON" ? "Non" : valeur) : (champ?.valeurs?.find((v) => v.v === valeur)?.l ?? valeur);
  return `« ${champ?.libelle ?? si.champ} » ${"egal" in si ? "vaut" : "ne vaut pas"} « ${libelle} »`;
}

function Case({ nom, valeur, cochee, libelle }: { nom: string; valeur: string; cochee: boolean; libelle: string }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
      <input type="checkbox" name={nom} value={valeur} defaultChecked={cochee} className="size-4 accent-primary" /> {libelle}
    </label>
  );
}

function ChampDuBareme({ champ, valeurs, condition }: { champ: DescripteurChamp; valeurs: string[]; condition?: string }) {
  const nom = `bareme_${champ.code}`;
  const libelle = `${champ.libelle}${champ.obligatoire ? " *" : ""}`;
  const aide = champ.aide;
  const premiere = valeurs[0] ?? "";
  const note = condition ? <p className="-mt-3 mb-4 text-sm text-muted-foreground">Affiché si {condition}.</p> : null;
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
          {note}
        </div>
      );
    case "LISTE":
      return (
        <div className="mb-4">
          <ListeDeroulante label={libelle} aide={aide} name={nom} defaultValue={premiere} options={[{ valeur: "", libelle: "—" }, ...(champ.valeurs ?? []).map((v) => ({ valeur: v.v, libelle: v.l }))]} />
          {note}
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
          {note}
        </fieldset>
      );
    case "DATE":
      return (
        <>
          <ChampDate nom={nom} libelle={libelle} requis={false} valeur={premiere} />
          {note}
        </>
      );
    default:
      return (
        <div className="mb-4">
          <Champ label={libelle} aide={aide} name={nom} defaultValue={premiere} inputMode={champ.type === "TEXTE" ? undefined : "decimal"} autoComplete="off" />
          {note}
        </div>
      );
  }
}
