"use client";

import { useState } from "react";

import { Bandeau, Bouton, Champ, ListeDeroulante, Pastille, ZoneTexte } from "@/composants/ui";
import {
  AIDE_EFFET,
  EFFETS_ECRAN,
  LIBELLE_EFFET,
  LIBELLE_GENRE,
  MESSAGE_PROFONDEUR,
  ORDRE_DE_CALCUL,
  PROFONDEUR_MAX,
  ajouterSousJacent,
  changerCibles,
  changerCondition,
  changerMessage,
  changerMode,
  changerReduction,
  changerTable,
  champsLusParSousJacent,
  champsPourCondition,
  ciblesPossibles,
  clesPossibles,
  genreDe,
  profondeur,
  renommerSousJacent,
  supprimerSousJacent,
  valeursPourCondition,
  type Bareme,
  type Condition,
  type EffetEcran,
  type Operande,
  type SousJacent,
} from "@/domaine/bareme";

import { CaseACocher, ChampCode, Depliable, SOUS_TITRE, useOuverts, type ContexteEdition } from "./commun";
import { EditeurOperande } from "./EditeurOperande";

const MODES_E5 = [
  { valeur: "MINIMUM", libelle: "Minimum de prime (la prime ne descend pas sous la valeur)" },
  { valeur: "PLAFOND", libelle: "Plafond de prime (la prime ne dépasse pas la valeur)" },
  { valeur: "AJOUT", libelle: "Ajout (la valeur s'ajoute à la prime)" },
];
const LIBELLE_EFFET_COURT: Record<SousJacent["effet"], string> = { E1: "E1 — taux", E2: "E2 — coefficient", E4: "E4 — refus", E5: "E5 — minimum, plafond, ajout" };

/**
 * Onglet « Sous-jacents » (B5, D59) : les cinq effets, et seulement eux. Le formulaire d'ajout dépend de l'effet choisi (les champs inutiles
 * n'existent pas). L'ordre de calcul est affiché, jamais modifiable. L'effet E3 (l'assiette) se règle dans chaque composante : il est présenté
 * ici avec les autres, sur le même document.
 */
export function OngletSousJacents({ ctx, disabled }: { ctx: ContexteEdition; disabled: boolean }) {
  const { doc } = ctx;
  const ouverts = useOuverts();
  const [effet, setEffet] = useState<EffetEcran>("E1");

  return (
    <section aria-labelledby="sous-jacents" className="space-y-4">
      <h3 id="sous-jacents" className={SOUS_TITRE}>
        Sous-jacents ({doc.sousJacents.length})
      </h3>
      <p className="text-sm text-muted-foreground">
        Un sous-jacent fait varier le calcul selon la réponse à un ou deux champs. Il agit d&apos;une seule des cinq façons ci-dessous, sur une ou plusieurs garanties ou composantes. Il n&apos;existe pas de formule libre.
      </p>
      <Depliable ouvert={ouverts.estOuvert("__ordre")} onBascule={(o) => ouverts.bascule("__ordre", o)} titre="Ordre de calcul (fixe, le même pour tous les produits)">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
          {ORDRE_DE_CALCUL.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">Cet ordre n&apos;est pas modifiable : il garantit qu&apos;un même barème donne le même montant partout.</p>
      </Depliable>

      {!disabled ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <ListeDeroulante label="Effet à ajouter" value={effet} options={EFFETS_ECRAN.map((e) => ({ valeur: e, libelle: LIBELLE_EFFET[e] }))} onChange={(e) => setEffet(e.target.value as EffetEcran)} />
          <p className="text-sm text-muted-foreground">{AIDE_EFFET[effet]}</p>
          <FormulaireAjout key={effet} effet={effet} ctx={ctx} onAjoute={(code) => ouverts.ouvrir(code)} />
        </div>
      ) : null}

      {effet === "E3" || doc.garanties.length > 0 ? <Assiettes ctx={ctx} disabled={disabled} remonte={effet === "E3"} /> : null}

      <h4 className="text-sm font-bold text-foreground">Sous-jacents du barème (E1, E2, E4, E5)</h4>
      {doc.sousJacents.length === 0 ? <p className="text-sm text-muted-foreground">Aucun sous-jacent.</p> : null}
      {doc.sousJacents.map((s) => (
        <FicheSousJacent key={s.code} s={s} ctx={ctx} disabled={disabled} ouvert={ouverts.estOuvert(s.code)} onBascule={(o) => ouverts.bascule(s.code, o)} onRenomme={(nouveau) => ouverts.renommer(s.code, nouveau)} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- Ajout, guidé par l'effet

function FormulaireAjout({ effet, ctx, onAjoute }: { effet: EffetEcran; ctx: ContexteEdition; onAjoute: (code: string) => void }) {
  const { doc, appliquer } = ctx;
  const [nom, setNom] = useState("");
  const [champ1, setChamp1] = useState("");
  const [champ2, setChamp2] = useState("");
  const [cible, setCible] = useState("");
  const [reduction, setReduction] = useState(false);
  const [mode, setMode] = useState<"MINIMUM" | "PLAFOND" | "AJOUT">("MINIMUM");
  const [message, setMessage] = useState("");

  if (effet === "E3") {
    return <p className="text-sm text-neutral">Rien à ajouter ici : l&apos;assiette de chaque composante se règle dans la liste « E3 — Assiettes » ci-dessous.</p>;
  }
  const cles = clesPossibles(doc);
  const cibles = effet === "E4" ? [] : ciblesPossibles(doc, effet, effet === "E2" && reduction);
  const absence =
    effet === "E4"
      ? null
      : cles.length === 0
        ? "Aucun champ ne peut être lu : créez d'abord une liste, un oui / non ou une liste à attributs dans l'onglet Champs."
        : cibles.length === 0
          ? effet === "E1"
            ? "Aucune composante n'a son taux lu dans un sous-jacent : dans l'onglet Garanties, choisissez « Taux lu dans une table » pour la composante concernée."
            : "Aucune garantie à viser."
          : null;

  const ajouter = () => {
    const r =
      effet === "E4"
        ? ajouterSousJacent(doc, { effet: "E4", nom, message })
        : ajouterSousJacent(doc, { effet, nom, champs: [champ1, champ2].filter((c) => c !== ""), cible, ...(effet === "E2" ? { reduction } : {}), ...(effet === "E5" ? { mode } : {}) });
    appliquer(r);
    if (r.ok) onAjoute(r.bareme.sousJacents[r.bareme.sousJacents.length - 1].code);
    if (r.ok) {
      setNom("");
      setMessage("");
      setCible("");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Champ label="Nom du sous-jacent" value={nom} autoComplete="off" onChange={(e) => setNom(e.target.value)} aide="Son code est proposé depuis le nom." />
      {effet === "E4" ? (
        <ZoneTexte label="Message de refus (lu par le Commercial)" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className="sm:col-span-2" />
      ) : (
        <>
          <ListeDeroulante label="Champ lu" value={champ1} options={[{ valeur: "", libelle: "Choisir…" }, ...cles.map((c) => ({ valeur: c.spec, libelle: c.libelle }))]} onChange={(e) => setChamp1(e.target.value)} />
          <ListeDeroulante label="Second champ lu (facultatif, grille à deux entrées)" value={champ2} options={[{ valeur: "", libelle: "Aucun" }, ...cles.filter((c) => c.spec !== champ1).map((c) => ({ valeur: c.spec, libelle: c.libelle }))]} onChange={(e) => setChamp2(e.target.value)} />
          {effet === "E2" ? (
            <div className="self-end">
              <CaseACocher
                libelle="Réduction en % de la prime de la garantie (la valeur de la table est un pourcentage)"
                coche={reduction}
                onChange={(v) => {
                  setReduction(v);
                  setCible("");
                }}
              />
            </div>
          ) : null}
          {effet === "E5" ? <ListeDeroulante label="Ce que fait la valeur" value={mode} options={MODES_E5} onChange={(e) => setMode(e.target.value as typeof mode)} /> : null}
          <ListeDeroulante label={effet === "E2" && reduction ? "Garantie visée" : "Garantie ou composante visée"} value={cible} options={[{ valeur: "", libelle: "Choisir…" }, ...cibles.map((c) => ({ valeur: c.valeur, libelle: c.libelle }))]} onChange={(e) => setCible(e.target.value)} />
        </>
      )}
      {absence ? <p className="text-sm text-danger sm:col-span-2">{absence}</p> : null}
      {effet !== "E4" ? <p className="text-sm text-muted-foreground sm:col-span-2">La table qui porte les valeurs est créée vide avec les champs lus : remplissez-la dans l&apos;onglet Tables. D&apos;autres garanties peuvent être visées ensuite.</p> : null}
      <div className="sm:col-span-2">
        <Bouton onClick={ajouter} disabled={absence !== null}>
          Ajouter le sous-jacent
        </Bouton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- E3 : assiettes

function Assiettes({ ctx, disabled, remonte }: { ctx: ContexteEdition; disabled: boolean; remonte: boolean }) {
  const { doc, maj, refuser } = ctx;
  const ouverts = useOuverts();
  const intermediaires = doc.intermediaires.map((i) => i.code);
  const changer = (garantie: string, composante: string, op: Operande) => {
    if (profondeur(op) > PROFONDEUR_MAX) return refuser([MESSAGE_PROFONDEUR]);
    maj((b) => ({ ...b, garanties: b.garanties.map((g) => (g.code !== garantie ? g : { ...g, composantes: g.composantes.map((c) => (c.code !== composante ? c : { ...c, assiette: op })) })) }));
  };
  return (
    <div className={remonte ? "space-y-2 rounded-lg border-2 border-primary-border p-3" : "space-y-2"}>
      <h4 className="text-sm font-bold text-foreground">E3 — Assiettes (le capital sur lequel le taux s&apos;applique)</h4>
      {doc.garanties.flatMap((g) =>
        g.composantes.map((c) => {
          const id = `${g.code}.${c.code}`;
          const genre = genreDe(c.assiette, doc);
          return (
            <Depliable key={id} ouvert={ouverts.estOuvert(id)} onBascule={(o) => ouverts.bascule(id, o)} titre={g.composantes.length > 1 ? `${g.nom} — ${c.code}` : g.nom} sousTitre={genre ? LIBELLE_GENRE[genre] : "assiette illisible"}>
              <EditeurOperande b={doc} op={c.assiette} etiquette="L'assiette est" intermediaires={intermediaires} disabled={disabled} onChange={(op) => changer(g.code, c.code, op)} />
            </Depliable>
          );
        }),
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Un sous-jacent existant

function FicheSousJacent({ s, ctx, disabled, ouvert, onBascule, onRenomme }: { s: SousJacent; ctx: ContexteEdition; disabled: boolean; ouvert: boolean; onBascule: (o: boolean) => void; onRenomme: (nouveau: string) => void }) {
  const { doc, appliquer } = ctx;
  const lus = champsLusParSousJacent(doc, s);
  return (
    <Depliable
      ouvert={ouvert}
      onBascule={onBascule}
      titre={s.code}
      sousTitre={LIBELLE_EFFET_COURT[s.effet] + (s.effet === "E2" && s.reduction ? " (réduction)" : "")}
      pastilles={lus.length > 0 ? <Pastille ton="principal">Lit : {lus.join(" × ")}</Pastille> : undefined}
    >
      <ChampCode
        key={s.code}
        label="Code du sous-jacent"
        valeur={s.code}
        disabled={disabled}
        valider={(nouveau) => {
          const r = renommerSousJacent(doc, s.code, nouveau);
          appliquer(r);
          if (r.ok) onRenomme(nouveau);
          return r.ok;
        }}
      />
      {s.effet === "E4" ? <DetailRefus s={s} ctx={ctx} disabled={disabled} /> : <DetailTable s={s} ctx={ctx} disabled={disabled} />}
      {!disabled ? (
        <div>
          <Bouton variante="danger" onClick={() => appliquer(supprimerSousJacent(doc, s.code))} aria-label={`Supprimer le sous-jacent ${s.code}`}>
            Supprimer le sous-jacent
          </Bouton>
        </div>
      ) : null}
    </Depliable>
  );
}

function DetailTable({ s, ctx, disabled }: { s: Exclude<SousJacent, { effet: "E4" }>; ctx: ContexteEdition; disabled: boolean }) {
  const { doc, appliquer } = ctx;
  const reduction = s.effet === "E2" && s.reduction === true;
  const proposees = ciblesPossibles(doc, s.effet, reduction);
  const options = [...proposees, ...s.cibles.filter((c) => !proposees.some((p) => p.valeur === c)).map((c) => ({ valeur: c, libelle: `${c} (non proposée ici)` }))];
  const basculer = (cible: string, coche: boolean) => appliquer(changerCibles(doc, s.code, coche ? [...s.cibles, cible] : s.cibles.filter((c) => c !== cible)));

  return (
    <>
      <ListeDeroulante
        label="Table de valeurs"
        value={s.table}
        disabled={disabled}
        options={[...(doc.tables.some((t) => t.code === s.table) ? [] : [{ valeur: s.table, libelle: `${s.table} (introuvable)` }]), ...doc.tables.map((t) => ({ valeur: t.code, libelle: `${t.code} — lit ${t.cles.join(" × ")}` }))]}
        onChange={(e) => appliquer(changerTable(doc, s.code, e.target.value))}
      />
      {s.effet === "E2" ? (
        <CaseACocher libelle="Réduction en % de la prime de la garantie (la valeur de la table est un pourcentage)" coche={reduction} disabled={disabled} onChange={(v) => appliquer(changerReduction(doc, s.code, v))} />
      ) : null}
      {s.effet === "E5" ? <ListeDeroulante label="Ce que fait la valeur" value={s.mode} disabled={disabled} options={MODES_E5} onChange={(e) => appliquer(changerMode(doc, s.code, e.target.value as "MINIMUM" | "PLAFOND" | "AJOUT"))} /> : null}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-foreground">{reduction ? "Garantie visée" : "Garanties et composantes visées"}</legend>
        {options.length === 0 ? <p className="text-sm text-muted-foreground">Aucune cible possible.</p> : null}
        {options.map((o) => (
          <CaseACocher key={o.valeur} libelle={o.libelle} coche={s.cibles.includes(o.valeur)} disabled={disabled} onChange={(v) => basculer(o.valeur, v)} />
        ))}
      </fieldset>
    </>
  );
}

type ModeCondition = "EGAL" | "DIFFERENT" | "COMPARAISON";
const modeDeCondition = (q: Condition): ModeCondition => (Array.isArray(q) ? "COMPARAISON" : "egal" in q ? "EGAL" : "DIFFERENT");
const COMPARATEURS = [
  { valeur: ">", libelle: "est supérieur à" },
  { valeur: ">=", libelle: "est supérieur ou égal à" },
  { valeur: "<", libelle: "est inférieur à" },
  { valeur: "<=", libelle: "est inférieur ou égal à" },
  { valeur: "=", libelle: "est égal à" },
  { valeur: "!=", libelle: "est différent de" },
];

function DetailRefus({ s, ctx, disabled }: { s: Extract<SousJacent, { effet: "E4" }>; ctx: ContexteEdition; disabled: boolean }) {
  const { doc, appliquer } = ctx;
  const q = s.quand;
  const mode = modeDeCondition(q);
  const candidats = champsPourCondition(doc);
  const intermediaires = doc.intermediaires.map((i) => i.code);

  const changerMode = (m: ModeCondition) => {
    if (m === "COMPARAISON") return appliquer(changerCondition(doc, s.code, [">", "0", "0"]));
    const base = candidats[0];
    const courant = !Array.isArray(q) ? q : base ? { champ: base.code, egal: valeursPourCondition(base)[0]?.code ?? "" } : null;
    if (!courant) return;
    const valeur = "egal" in courant ? courant.egal : courant.different;
    appliquer(changerCondition(doc, s.code, m === "EGAL" ? { champ: courant.champ, egal: valeur } : { champ: courant.champ, different: valeur }));
  };
  const champCourant = !Array.isArray(q) ? doc.champs.find((c) => c.code === q.champ) : undefined;
  const valeursPossibles = champCourant ? valeursPourCondition(champCourant) : [];

  return (
    <>
      <ZoneTexte label="Message de refus (lu par le Commercial)" rows={2} disabled={disabled} value={s.message} onChange={(e) => appliquer(changerMessage(doc, s.code, e.target.value))} />
      {s.message.trim() === "" ? <Bandeau ton="avertissement">Le message de refus est vide : le Commercial ne saurait pas pourquoi le risque est refusé.</Bandeau> : null}
      <ListeDeroulante
        label="Le risque est refusé quand"
        value={mode}
        disabled={disabled}
        options={[
          { valeur: "EGAL", libelle: "un champ vaut une valeur", desactive: candidats.length === 0 && mode !== "EGAL" },
          { valeur: "DIFFERENT", libelle: "un champ ne vaut pas une valeur", desactive: candidats.length === 0 && mode !== "DIFFERENT" },
          { valeur: "COMPARAISON", libelle: "une comparaison de deux montants est vraie" },
        ]}
        onChange={(e) => changerMode(e.target.value as ModeCondition)}
      />
      {Array.isArray(q) ? (
        <div className="space-y-3 border-l-2 border-border pl-3">
          <EditeurOperande b={doc} op={q[1]} etiquette="Montant à comparer" intermediaires={intermediaires} disabled={disabled} onChange={(op) => appliquer(changerCondition(doc, s.code, [q[0], op, q[2]]))} />
          <ListeDeroulante label="Ce montant" value={q[0]} disabled={disabled} options={COMPARATEURS} onChange={(e) => appliquer(changerCondition(doc, s.code, [e.target.value as (typeof q)[0], q[1], q[2]]))} />
          <EditeurOperande b={doc} op={q[2]} etiquette="Montant de référence" intermediaires={intermediaires} disabled={disabled} onChange={(op) => appliquer(changerCondition(doc, s.code, [q[0], q[1], op]))} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ListeDeroulante
            label="Champ"
            value={q.champ}
            disabled={disabled}
            options={[...(candidats.some((c) => c.code === q.champ) ? [] : [{ valeur: q.champ, libelle: `${q.champ} (introuvable ou non comparable)` }]), ...candidats.map((c) => ({ valeur: c.code, libelle: c.libelle ?? c.code }))]}
            onChange={(e) => {
              const c = doc.champs.find((x) => x.code === e.target.value);
              const premiere = c ? (valeursPourCondition(c)[0]?.code ?? "") : "";
              appliquer(changerCondition(doc, s.code, mode === "EGAL" ? { champ: e.target.value, egal: premiere } : { champ: e.target.value, different: premiere }));
            }}
          />
          <ListeDeroulante
            label="Valeur"
            value={"egal" in q ? q.egal : q.different}
            disabled={disabled}
            options={[
              ...(valeursPossibles.some((v) => v.code === ("egal" in q ? q.egal : q.different)) ? [] : [{ valeur: "egal" in q ? q.egal : q.different, libelle: `${"egal" in q ? q.egal : q.different} (introuvable)` }]),
              ...valeursPossibles.map((v) => ({ valeur: v.code, libelle: v.libelle === v.code ? v.code : `${v.libelle} (${v.code})` })),
            ]}
            onChange={(e) => appliquer(changerCondition(doc, s.code, "egal" in q ? { champ: q.champ, egal: e.target.value } : { champ: q.champ, different: e.target.value }))}
          />
        </div>
      )}
    </>
  );
}

export type { Bareme };
