"use client";

import { useState } from "react";

import { Bouton, Champ, ListeDeroulante, Pastille, ZoneTexte } from "@/composants/ui";
import {
  TYPES_CHAMP,
  attributsDuChamp,
  champNeuf,
  changerValeur,
  codeValeur,
  codesChampsEtIntermediaires,
  codeValide,
  deplacer,
  normaliserValeur,
  proposerCode,
  renommerChamp,
  renommerValeur,
  supprimerAttribut,
  supprimerBloc,
  supprimerChamp,
  supprimerValeur,
  type Champ as ChampBareme,
} from "@/domaine/bareme";

import { ActionsElement, CaseACocher, ChampCode, Depliable, LIBELLE_TYPE, SOUS_TITRE, decimalSaisi, useOuverts, type ContexteEdition } from "./commun";
import { EditeurCondition } from "./EditeurCondition";

const estListe = (c: ChampBareme) => c.type === "LISTE" || c.type === "CHOIX_MULTIPLES";

/** Onglet « Champs » : ce que le Commercial remplit. Ajouter, modifier, ordonner, supprimer ; les blocs regroupent les champs à l'écran. */
export function OngletChamps({ ctx, disabled }: { ctx: ContexteEdition; disabled: boolean }) {
  const { doc, maj, appliquer, refuser } = ctx;
  const ouverts = useOuverts();
  const [libelleNeuf, setLibelleNeuf] = useState("");
  const [typeNeuf, setTypeNeuf] = useState<ChampBareme["type"]>("TEXTE");
  const [blocNeuf, setBlocNeuf] = useState("");

  const majChamp = (code: string, f: (c: ChampBareme) => ChampBareme) => maj((b) => ({ ...b, champs: b.champs.map((c) => (c.code === code ? f(c) : c)) }));

  const ajouter = () => {
    const libelle = libelleNeuf.trim();
    if (libelle === "") return refuser(["Donnez un libellé au champ : le code en est proposé."]);
    const code = proposerCode(libelle, codesChampsEtIntermediaires(doc), "champ");
    maj((b) => ({ ...b, champs: [...b.champs, champNeuf(code, libelle, typeNeuf)] }));
    ouverts.ouvrir(code);
    setLibelleNeuf("");
  };
  const ajouterBloc = () => {
    const libelle = blocNeuf.trim();
    if (libelle === "") return refuser(["Donnez un libellé au bloc."]);
    const code = proposerCode(libelle, doc.blocs.map((x) => x.code), "bloc");
    maj((b) => ({ ...b, blocs: [...b.blocs, { code, libelle }] }));
    setBlocNeuf("");
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="blocs" className="space-y-3">
        <h3 id="blocs" className={SOUS_TITRE}>
          Blocs d&apos;affichage
        </h3>
        <p className="text-sm text-muted-foreground">Un bloc regroupe des champs sous un intertitre, sur l&apos;écran de cotation. Sans bloc, les champs se suivent.</p>
        {doc.blocs.map((bloc, i) => (
          <div key={bloc.code} className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            <Champ label="Libellé du bloc" value={bloc.libelle} disabled={disabled} autoComplete="off" onChange={(e) => maj((b) => ({ ...b, blocs: b.blocs.map((x) => (x.code === bloc.code ? { ...x, libelle: e.target.value } : x)) }))} />
            <ChampCode
              key={bloc.code}
              label="Code du bloc"
              valeur={bloc.code}
              disabled={disabled}
              valider={(nouveau) => {
                if (!codeValide(nouveau)) return refuser(["Code : minuscules, chiffres et _, commence par une lettre."]), false;
                if (doc.blocs.some((x) => x.code === nouveau)) return refuser([`Le bloc « ${nouveau} » existe déjà.`]), false;
                maj((b) => ({ ...b, blocs: b.blocs.map((x) => (x.code === bloc.code ? { ...x, code: nouveau } : x)), champs: b.champs.map((c) => (c.bloc === bloc.code ? { ...c, bloc: nouveau } : c)) }));
                return true;
              }}
            />
            {!disabled ? (
              <ActionsElement
                nom={`le bloc ${bloc.libelle}`}
                onMonter={i > 0 ? () => maj((b) => ({ ...b, blocs: deplacer(b.blocs, i, -1) })) : undefined}
                onDescendre={i < doc.blocs.length - 1 ? () => maj((b) => ({ ...b, blocs: deplacer(b.blocs, i, 1) })) : undefined}
                onSupprimer={() => appliquer(supprimerBloc(doc, bloc.code))}
              />
            ) : null}
          </div>
        ))}
        {!disabled ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-80">
              <Champ label="Nouveau bloc (libellé)" value={blocNeuf} autoComplete="off" onChange={(e) => setBlocNeuf(e.target.value)} />
            </div>
            <Bouton variante="secondaire" onClick={ajouterBloc}>
              Ajouter le bloc
            </Bouton>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="champs" className="space-y-3">
        <h3 id="champs" className={SOUS_TITRE}>
          Champs ({doc.champs.length})
        </h3>
        {!disabled ? (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
            <Champ label="Nouveau champ (libellé)" value={libelleNeuf} autoComplete="off" onChange={(e) => setLibelleNeuf(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ajouter())} />
            <ListeDeroulante label="Type" value={typeNeuf} options={TYPES_CHAMP.map((t) => ({ valeur: t, libelle: LIBELLE_TYPE[t] }))} onChange={(e) => setTypeNeuf(e.target.value as ChampBareme["type"])} />
            <Bouton onClick={ajouter}>Ajouter le champ</Bouton>
          </div>
        ) : null}
        {doc.champs.length === 0 ? <p className="text-sm text-muted-foreground">Aucun champ : le formulaire de cotation ne demandera rien.</p> : null}
        {doc.champs.map((c, i) => {
          const fige = ctx.figes.has(c.code);
          return (
            <Depliable
              key={c.code}
              ouvert={ouverts.estOuvert(c.code)}
              onBascule={(o) => ouverts.bascule(c.code, o)}
              titre={c.libelle ?? c.code}
              sousTitre={c.code}
              pastilles={
                <>
                  <Pastille ton="info">{LIBELLE_TYPE[c.type]}</Pastille>
                  {c.obligatoire !== false ? <Pastille>Obligatoire</Pastille> : null}
                  {c.si ? <Pastille ton="avertissement">Conditionnel</Pastille> : null}
                </>
              }
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Champ label="Libellé" value={c.libelle ?? ""} disabled={disabled} autoComplete="off" onChange={(e) => majChamp(c.code, (x) => ({ ...x, libelle: e.target.value }))} />
                <div className="space-y-2">
                  <ChampCode
                    key={c.code}
                    label="Code (balise risque.<code> des documents)"
                    valeur={c.code}
                    disabled={disabled || fige}
                    aide={fige ? "Ce champ figure dans un barème publié : son code ne change plus." : undefined}
                    valider={(nouveau) => {
                      const r = renommerChamp(doc, c.code, nouveau, ctx.figes);
                      appliquer(r);
                      if (r.ok) ouverts.renommer(c.code, nouveau);
                      return r.ok;
                    }}
                  />
                  {!disabled && !fige && c.libelle ? (
                    <Bouton
                      variante="secondaire"
                      onClick={() => {
                        const code = proposerCode(c.libelle ?? "", codesChampsEtIntermediaires(doc).filter((x) => x !== c.code), "champ");
                        const r = renommerChamp(doc, c.code, code, ctx.figes);
                        appliquer(r);
                        if (r.ok) ouverts.renommer(c.code, code);
                      }}
                    >
                      Proposer le code depuis le libellé
                    </Bouton>
                  ) : null}
                </div>
                <ListeDeroulante
                  label="Type"
                  value={c.type}
                  disabled={disabled}
                  options={TYPES_CHAMP.map((t) => ({ valeur: t, libelle: LIBELLE_TYPE[t] }))}
                  onChange={(e) =>
                    majChamp(c.code, (x) => {
                      const type = e.target.value as ChampBareme["type"];
                      const avecValeurs = type === "LISTE" || type === "CHOIX_MULTIPLES";
                      const borne = type === "NOMBRE" || type === "MONTANT";
                      return { ...x, type, valeurs: avecValeurs ? (x.valeurs ?? []) : undefined, numerique: type === "LISTE" ? x.numerique : undefined, min: borne ? x.min : undefined, max: borne ? x.max : undefined };
                    })
                  }
                />
                <ListeDeroulante
                  label="Bloc"
                  value={c.bloc ?? ""}
                  disabled={disabled}
                  options={[{ valeur: "", libelle: "Aucun bloc" }, ...(c.bloc && !doc.blocs.some((x) => x.code === c.bloc) ? [{ valeur: c.bloc, libelle: `${c.bloc} (bloc inconnu)` }] : []), ...doc.blocs.map((x) => ({ valeur: x.code, libelle: x.libelle }))]}
                  onChange={(e) => majChamp(c.code, (x) => ({ ...x, bloc: e.target.value === "" ? undefined : e.target.value }))}
                />
              </div>
              <ZoneTexte label="Aide (sous le champ, à la cotation)" rows={2} value={c.aide ?? ""} disabled={disabled} onChange={(e) => majChamp(c.code, (x) => ({ ...x, aide: e.target.value === "" ? undefined : e.target.value }))} />
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <CaseACocher libelle="Obligatoire" coche={c.obligatoire !== false} disabled={disabled} onChange={(v) => majChamp(c.code, (x) => ({ ...x, obligatoire: v ? undefined : false }))} />
                <CaseACocher libelle="Imprimable sur les documents (balise risque.<code>)" coche={c.surDocuments !== false} disabled={disabled} onChange={(v) => majChamp(c.code, (x) => ({ ...x, surDocuments: v ? undefined : false }))} />
                {c.type === "LISTE" ? <CaseACocher libelle="Liste de montants (les valeurs sont des nombres)" coche={c.numerique === true} disabled={disabled} onChange={(v) => majChamp(c.code, (x) => ({ ...x, numerique: v ? true : undefined }))} /> : null}
              </div>
              {c.type === "NOMBRE" || c.type === "MONTANT" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Champ label="Minimum (facultatif)" inputMode="decimal" autoComplete="off" value={c.min ?? ""} disabled={disabled} onChange={(e) => majChamp(c.code, (x) => ({ ...x, min: e.target.value === "" ? undefined : decimalSaisi(e.target.value) }))} />
                  <Champ label="Maximum (facultatif)" inputMode="decimal" autoComplete="off" value={c.max ?? ""} disabled={disabled} onChange={(e) => majChamp(c.code, (x) => ({ ...x, max: e.target.value === "" ? undefined : decimalSaisi(e.target.value) }))} />
                </div>
              ) : null}
              <EditeurCondition b={doc} etiquette="Afficher ce champ" sauf={c.code} disabled={disabled} valeur={c.si} onChange={(si) => majChamp(c.code, (x) => ({ ...x, si }))} />
              {estListe(c) ? <ValeursListe ctx={ctx} champ={c} disabled={disabled} majChamp={majChamp} /> : null}
              {!disabled ? (
                <ActionsElement
                  nom={`le champ ${c.libelle ?? c.code}`}
                  onMonter={i > 0 ? () => maj((b) => ({ ...b, champs: deplacer(b.champs, i, -1) })) : undefined}
                  onDescendre={i < doc.champs.length - 1 ? () => maj((b) => ({ ...b, champs: deplacer(b.champs, i, 1) })) : undefined}
                  onSupprimer={() => appliquer(supprimerChamp(doc, c.code))}
                />
              ) : null}
            </Depliable>
          );
        })}
      </section>
    </div>
  );
}

/** Valeurs d'une liste : code, libellé et attributs tarifaires (ex. la classe), un code par valeur. */
function ValeursListe({ ctx, champ, disabled, majChamp }: { ctx: ContexteEdition; champ: ChampBareme; disabled: boolean; majChamp: (code: string, f: (c: ChampBareme) => ChampBareme) => void }) {
  const { doc, appliquer, refuser } = ctx;
  const [libelleNeuf, setLibelleNeuf] = useState("");
  const [codeNeuf, setCodeNeuf] = useState("");
  const [attributNeuf, setAttributNeuf] = useState("");
  const valeurs = champ.valeurs ?? [];
  const attributs = attributsDuChamp(champ);
  const numerique = champ.numerique === true;

  const ajouter = () => {
    const code = numerique ? decimalSaisi(codeNeuf) : codeNeuf.trim() !== "" ? codeNeuf.trim() : proposerCode(libelleNeuf, valeurs.map(codeValeur), "valeur").toUpperCase();
    if (code === "" || (!numerique && libelleNeuf.trim() === "" && codeNeuf.trim() === "")) return refuser(["Donnez un libellé ou un code à la valeur."]);
    if (valeurs.some((v) => codeValeur(v) === code)) return refuser([`La valeur « ${code} » existe déjà dans cette liste.`]);
    const libelle = libelleNeuf.trim();
    majChamp(champ.code, (c) => ({ ...c, valeurs: [...(c.valeurs ?? []), normaliserValeur(libelle !== "" && !numerique ? { v: code, l: libelle } : code)] }));
    setLibelleNeuf("");
    setCodeNeuf("");
  };
  const remplacerValeur = (code: string, f: (v: (typeof valeurs)[number]) => (typeof valeurs)[number]) => majChamp(champ.code, (c) => ({ ...c, valeurs: (c.valeurs ?? []).map((v) => (codeValeur(v) === code ? f(v) : v)) }));

  return (
    <section aria-label={`Valeurs de ${champ.libelle ?? champ.code}`} className="space-y-3">
      <h4 className={SOUS_TITRE}>Valeurs de la liste ({valeurs.length})</h4>
      {valeurs.map((v, i) => {
        const code = codeValeur(v);
        const objet = typeof v === "string" ? undefined : v;
        return (
          <div key={code} className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChampCode
                key={code}
                label="Code"
                valeur={code}
                disabled={disabled}
                valider={(nouveau) => {
                  const r = renommerValeur(doc, champ.code, code, nouveau);
                  appliquer(r);
                  return r.ok;
                }}
              />
              {numerique ? null : <Champ label="Libellé" value={objet?.l ?? ""} disabled={disabled} autoComplete="off" onChange={(e) => remplacerValeur(code, (x) => changerValeur(x, "l", e.target.value))} />}
              {attributs.map((a) => (
                <Champ key={a} label={`Attribut « ${a} »`} value={String(objet?.[a] ?? "")} disabled={disabled} autoComplete="off" onChange={(e) => remplacerValeur(code, (x) => changerValeur(x, { attribut: a }, e.target.value))} />
              ))}
            </div>
            {!disabled ? (
              <ActionsElement
                nom={`la valeur ${code}`}
                onMonter={i > 0 ? () => majChamp(champ.code, (c) => ({ ...c, valeurs: deplacer(c.valeurs ?? [], i, -1) })) : undefined}
                onDescendre={i < valeurs.length - 1 ? () => majChamp(champ.code, (c) => ({ ...c, valeurs: deplacer(c.valeurs ?? [], i, 1) })) : undefined}
                onSupprimer={() => appliquer(supprimerValeur(doc, champ.code, code))}
              />
            ) : null}
          </div>
        );
      })}
      {!disabled ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {numerique ? null : <Champ label="Nouvelle valeur (libellé)" value={libelleNeuf} autoComplete="off" onChange={(e) => setLibelleNeuf(e.target.value)} />}
            <Champ label={numerique ? "Nouveau montant" : "Code (facultatif, proposé depuis le libellé)"} inputMode={numerique ? "decimal" : undefined} value={codeNeuf} autoComplete="off" onChange={(e) => setCodeNeuf(e.target.value)} />
            <Bouton variante="secondaire" onClick={ajouter}>
              Ajouter la valeur
            </Bouton>
          </div>
          {!numerique ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <Champ label="Nouvel attribut tarifaire (ex. classe)" value={attributNeuf} autoComplete="off" onChange={(e) => setAttributNeuf(e.target.value)} aide="Une colonne de plus pour toutes les valeurs ; une table peut la lire comme clé." />
              <Bouton
                variante="secondaire"
                onClick={() => {
                  const nom = attributNeuf.trim();
                  if (!/^[a-z][a-z0-9_]*$/.test(nom) || nom === "v" || nom === "l") return refuser(["Nom d'attribut : minuscules, chiffres et _, commence par une lettre."]);
                  if (attributs.includes(nom)) return refuser([`L'attribut « ${nom} » existe déjà.`]);
                  // Chaque valeur reçoit « 0 », à modifier ensuite.
                  majChamp(champ.code, (c) => ({ ...c, valeurs: (c.valeurs ?? []).map((v) => ({ ...(typeof v === "string" ? { v } : v), [nom]: "0" })) }));
                  setAttributNeuf("");
                }}
              >
                Ajouter l&apos;attribut
              </Bouton>
              {attributs.length > 0 ? (
                <ListeDeroulante label="Retirer un attribut" value="" invite="Choisir…" options={attributs.map((a) => ({ valeur: a, libelle: a }))} onChange={(e) => appliquer(supprimerAttribut(doc, champ.code, e.target.value))} />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
