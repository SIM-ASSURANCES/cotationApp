"use client";

import { useState } from "react";

import { Bouton, Champ, Pastille, ZoneTexte, ListeDeroulante, classesControle, useSaisieMontant } from "@/composants/ui";
import {
  analyserPlage,
  changerCles,
  clesAttendues,
  clesPossibles,
  cleDeCase,
  collerPlage,
  comptageDeTable,
  creerTable,
  decrireCase,
  grilleDeTable,
  lecteursDeTable,
  MESSAGE_CLES_MAX,
  poserCase,
  proposerCode,
  remplirCasesVides,
  renommerTable,
  supprimerTable,
  type Grille,
  type Table,
} from "@/domaine/bareme";

import { ChampCode, Depliable, SOUS_TITRE, useOuverts, type ContexteEdition } from "./commun";

const ENTETE = "border-b border-border bg-muted px-3 py-2 text-left font-medium text-neutral";

/**
 * Onglet « Tables » (B5, D59) : une table lit un champ (liste de valeurs) ou deux (grille lignes × colonnes). Les clés sont TIRÉES des
 * valeurs des champs : on les choisit, on ne les tape jamais. Les cases sont des nombres décimaux ; une case vide n'existe pas (aucun 0
 * silencieux) et se voit en rouge. Rien n'est jugé ici : `verifierBareme` reste le juge de la complétude (panneau de contrôles).
 */
export function OngletTables({ ctx, disabled }: { ctx: ContexteEdition; disabled: boolean }) {
  const { doc, appliquer, refuser } = ctx;
  const ouverts = useOuverts();
  const cles = clesPossibles(doc);
  const [nom, setNom] = useState("");
  const [cle1, setCle1] = useState("");
  const [cle2, setCle2] = useState("");

  const creer = () => {
    if (nom.trim() === "") return refuser(["Donnez un nom à la table : son code en est proposé."]);
    const choisies = [cle1, cle2].filter((c) => c !== "");
    const code = proposerCode(nom, doc.tables.map((t) => t.code), "table");
    const r = creerTable(doc, code, choisies);
    appliquer(r);
    if (r.ok) {
      ouverts.ouvrir(code);
      setNom("");
      setCle1("");
      setCle2("");
    }
  };

  return (
    <section aria-labelledby="tables" className="space-y-3">
      <h3 id="tables" className={SOUS_TITRE}>
        Tables ({doc.tables.length})
      </h3>
      <p className="text-sm text-muted-foreground">
        Une table donne un nombre (taux, coefficient, limite…) selon la valeur d&apos;un champ, ou de deux champs en grille. Choisissez les champs lus : leurs valeurs deviennent les lignes. Une case vide n&apos;est jamais un zéro : la publication est bloquée tant qu&apos;il en manque une.
      </p>
      {!disabled ? (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Champ label="Nouvelle table (nom)" value={nom} autoComplete="off" onChange={(e) => setNom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), creer())} />
          <ListeDeroulante label="Champ lu (lignes)" value={cle1} options={[{ valeur: "", libelle: cles.length === 0 ? "Aucune liste ni oui/non" : "Choisir…" }, ...cles.map((c) => ({ valeur: c.spec, libelle: c.libelle }))]} onChange={(e) => setCle1(e.target.value)} />
          <ListeDeroulante label="Second champ lu (colonnes, facultatif)" value={cle2} options={[{ valeur: "", libelle: "Aucun (liste simple)" }, ...cles.filter((c) => c.spec !== cle1).map((c) => ({ valeur: c.spec, libelle: c.libelle }))]} onChange={(e) => setCle2(e.target.value)} />
          <Bouton onClick={creer}>Créer la table</Bouton>
          <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">{MESSAGE_CLES_MAX}</p>
        </div>
      ) : null}
      {doc.tables.length === 0 ? <p className="text-sm text-muted-foreground">Aucune table.</p> : null}
      {doc.tables.map((t) => (
        <FicheTable key={t.code} t={t} ctx={ctx} disabled={disabled} ouvert={ouverts.estOuvert(t.code)} onBascule={(o) => ouverts.bascule(t.code, o)} onRenomme={(nouveau) => ouverts.renommer(t.code, nouveau)} />
      ))}
    </section>
  );
}

function FicheTable({ t, ctx, disabled, ouvert, onBascule, onRenomme }: { t: Table; ctx: ContexteEdition; disabled: boolean; ouvert: boolean; onBascule: (o: boolean) => void; onRenomme: (nouveau: string) => void }) {
  const { doc, appliquer } = ctx;
  const grille = grilleDeTable(doc, t);
  const comptage = comptageDeTable(doc, t);
  const lecteurs = lecteursDeTable(doc, t.code);
  const cles = clesPossibles(doc);
  const complet = comptage !== null && comptage.manquantes.length === 0 && comptage.inconnues.length === 0;

  const choixCle = (position: 0 | 1) => {
    const courante = t.cles[position] ?? "";
    const autres = t.cles.filter((_, i) => i !== position);
    return [
      ...(position === 1 ? [{ valeur: "", libelle: "Aucun (liste simple)" }] : []),
      ...(courante !== "" && !cles.some((c) => c.spec === courante) ? [{ valeur: courante, libelle: `${courante} (introuvable)` }] : []),
      ...cles.filter((c) => !autres.includes(c.spec)).map((c) => ({ valeur: c.spec, libelle: c.libelle })),
    ];
  };
  const changerCle = (position: 0 | 1, valeur: string) => {
    const nouvelles = [...t.cles];
    if (valeur === "") nouvelles.splice(position, 1);
    else nouvelles[position] = valeur;
    appliquer(changerCles(doc, t.code, nouvelles));
  };

  return (
    <Depliable
      ouvert={ouvert}
      onBascule={onBascule}
      titre={t.code}
      sousTitre={`clés : ${t.cles.join(" × ")}`}
      pastilles={
        comptage === null ? (
          <Pastille ton="danger">Champ lu introuvable</Pastille>
        ) : (
          <>
            <Pastille ton={complet ? "succes" : "danger"}>
              {comptage.remplies} / {comptage.total} cases remplies
            </Pastille>
            {lecteurs.length === 0 ? <Pastille ton="avertissement">Lue par aucun sous-jacent</Pastille> : null}
          </>
        )
      }
    >
      <ChampCode
        key={t.code}
        label="Code de la table"
        valeur={t.code}
        disabled={disabled}
        valider={(nouveau) => {
          const r = renommerTable(doc, t.code, nouveau);
          appliquer(r);
          if (r.ok) onRenomme(nouveau);
          return r.ok;
        }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ListeDeroulante label="Champ lu (lignes)" value={t.cles[0] ?? ""} disabled={disabled} options={choixCle(0)} onChange={(e) => changerCle(0, e.target.value)} />
        <ListeDeroulante label="Second champ lu (colonnes, facultatif)" value={t.cles[1] ?? ""} disabled={disabled} options={choixCle(1)} onChange={(e) => changerCle(1, e.target.value)} />
      </div>
      <p className="text-sm text-muted-foreground">{lecteurs.length > 0 ? `Lue par ${lecteurs.join(", ")}.` : "Aucun sous-jacent ni assiette ne lit cette table pour le moment."}</p>

      {grille === null || comptage === null ? (
        <p role="alert" className="text-sm text-danger">
          Un des champs lus n&apos;existe plus ou n&apos;est plus une liste : choisissez d&apos;autres champs pour cette table.
        </p>
      ) : (
        <>
          <GrilleDeCases t={t} grille={grille} ctx={ctx} disabled={disabled} />
          <p role="status" className="text-sm text-neutral">
            {comptage.remplies} / {comptage.total} cases remplies.
            {comptage.manquantes.length > 0 ? ` Absente${comptage.manquantes.length > 1 ? "s" : ""} : ${comptage.manquantes.slice(0, 6).map((k) => decrireCase(grille, k)).join(" ; ")}${comptage.manquantes.length > 6 ? ` … et ${comptage.manquantes.length - 6} autre(s)` : ""}.` : ""}
            {comptage.inconnues.length > 0 ? ` Ligne(s) sans valeur correspondante : ${comptage.inconnues.join(", ")} (changez les champs lus pour les retirer).` : ""}
          </p>
          {!disabled ? (
            <div className="flex flex-wrap gap-2">
              <Bouton variante="secondaire" onClick={() => appliquer(remplirCasesVides(doc, t.code, "1"))} disabled={comptage.manquantes.length === 0}>
                Remplir les cases vides avec 1
              </Bouton>
            </div>
          ) : null}
          {!disabled ? <CollerUnePlage
              grille={grille}
              onColler={(plage) => {
                const r = collerPlage(doc, t.code, plage);
                appliquer(r);
                return r.ok;
              }}
            /> : null}
        </>
      )}
      {!disabled ? (
        <div>
          <Bouton variante="danger" onClick={() => appliquer(supprimerTable(doc, t.code))} aria-label={`Supprimer la table ${t.code}`}>
            Supprimer la table
          </Bouton>
        </div>
      ) : null}
    </Depliable>
  );
}

/** Grille : une colonne de valeurs (1 clé), ou lignes × colonnes (2 clés). Chaque case est un champ décimal ; vide = rouge. */
function GrilleDeCases({ t, grille, ctx, disabled }: { t: Table; grille: Grille; ctx: ContexteEdition; disabled: boolean }) {
  const { doc, appliquer } = ctx;
  const poser = (cle: string, texte: string): boolean => {
    const r = poserCase(doc, t.code, cle, texte);
    appliquer(r);
    return r.ok;
  };
  const cellule = (cle: string, nom: string) => <CaseDeTable key={`${cle}:${t.lignes[cle] ?? ""}`} nom={nom} valeur={t.lignes[cle]} disabled={disabled} onCommit={(texte) => poser(cle, texte)} />;

  return (
    <div tabIndex={0} role="region" aria-label={`Cases de la table ${t.code}`} className="relative overflow-x-auto rounded-md border border-border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Valeurs de la table {t.code}</caption>
        <thead>
          <tr>
            <th scope="col" className={ENTETE}>
              {grille.dimension === 1 ? grille.cleLignes.libelle : `${grille.cleLignes.libelle} \\ ${grille.cleColonnes!.libelle}`}
            </th>
            {grille.dimension === 1 ? (
              <th scope="col" className={`${ENTETE} text-right`}>
                Valeur
              </th>
            ) : (
              grille.colonnes.map((c) => (
                <th key={c.v} scope="col" className={`${ENTETE} text-right`}>
                  {c.l}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody className="bg-surface">
          {grille.lignes.map((l) => (
            <tr key={l.v}>
              <th scope="row" className="border-b border-border px-3 py-2 text-left font-medium text-foreground">
                {l.l}
              </th>
              {grille.dimension === 1 ? (
                <td className="min-w-32 border-b border-border px-2 py-1">{cellule(l.v, decrireCase(grille, l.v))}</td>
              ) : (
                grille.colonnes.map((c) => (
                  <td key={c.v} className="min-w-28 border-b border-border px-2 py-1">
                    {cellule(cleDeCase(l.v, c.v), decrireCase(grille, cleDeCase(l.v, c.v)))}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Une case : le texte est jugé à la sortie du champ (ou à Entrée) ; un nombre refusé revient à la valeur enregistrée. */
function CaseDeTable({ nom, valeur, disabled, onCommit }: { nom: string; valeur: string | undefined; disabled: boolean; onCommit: (texte: string) => boolean }) {
  const [texte, setTexte] = useState(valeur ?? "");
  const saisie = useSaisieMontant({ value: texte, onChange: setTexte });
  const finir = () => {
    if (texte !== (valeur ?? "") && !onCommit(texte)) setTexte(valeur ?? "");
  };
  const vide = (valeur ?? "") === "";
  return (
    <input
      type="text"
      {...saisie}
      aria-label={nom}
      aria-invalid={vide ? true : undefined}
      disabled={disabled}
      onBlur={finir}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finir();
        }
      }}
      className={classesControle(vide, "text-right tabular-nums")}
    />
  );
}

/** Zone où l'on colle une plage copiée d'un tableur (cases seules, ou avec leurs en-têtes) ; appliquée en entier ou refusée en entier. */
function CollerUnePlage({ grille, onColler }: { grille: Grille; onColler: (plage: string[][]) => boolean }) {
  const [texte, setTexte] = useState("");
  const attendu = clesAttendues(grille).length;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <ZoneTexte
        label="Coller une plage copiée depuis un tableur"
        rows={3}
        value={texte}
        spellCheck={false}
        onChange={(e) => setTexte(e.target.value)}
        aide={
          grille.dimension === 1
            ? `Une colonne de ${grille.lignes.length} nombre(s) dans l'ordre de la liste, ou deux colonnes (valeur, nombre). Virgule ou point.`
            : `Les ${attendu} cases (${grille.lignes.length} ligne(s) × ${grille.colonnes.length} colonne(s)), avec ou sans leurs en-têtes. La plage s'applique à partir de la première case.`
        }
      />
      <Bouton
        variante="secondaire"
        disabled={texte.trim() === ""}
        onClick={() => {
          // Plage refusée : le texte collé reste là, pour être corrigé (D53).
          if (onColler(analyserPlage(texte))) setTexte("");
        }}
      >
        Appliquer la plage
      </Bouton>
    </div>
  );
}
