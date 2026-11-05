"use client";

import { useState } from "react";

import { Bouton, Champ, ChampMontant, ListeDeroulante, Pastille, ZoneTexte } from "@/composants/ui";
import {
  MESSAGE_PROFONDEUR,
  PROFONDEUR_MAX,
  codesChampsEtIntermediaires,
  deplacer,
  garantieNeuve,
  profondeur,
  proposerCode,
  renommerComposante,
  renommerGarantie,
  supprimerComposante,
  supprimerGarantie,
  type Bareme,
  type Composante,
  type Garantie,
  type Operande,
} from "@/domaine/bareme";

import { ActionsElement, CaseACocher, ChampCode, Depliable, SOUS_TITRE, decimalSaisi, useOuverts, type ContexteEdition } from "./commun";
import { EditeurCondition } from "./EditeurCondition";
import { EditeurOperande } from "./EditeurOperande";

type Accessoires = NonNullable<Bareme["produit"]["accessoires"]>;
const MODES = [
  { valeur: "PAR_GARANTIE", libelle: "Par garantie souscrite" },
  { valeur: "PAR_CONTRAT", libelle: "Par contrat" },
  { valeur: "PAR_TETE", libelle: "Par tête (effectif)" },
  { valeur: "PAR_TRANCHE", libelle: "Par tranche d'effectif" },
];

/**
 * Accessoires : du produit (valeur par défaut des garanties) ou d'une garantie (qui remplace ceux du produit). Les quatre modes qui
 * existent : par garantie, par contrat, par tête, par tranche d'effectif.
 */
function EditeurAccessoires({ valeur, onChange, aucun, disabled, etiquette }: { valeur: Accessoires | undefined; onChange: (a: Accessoires | undefined) => void; aucun: string; disabled: boolean; etiquette: string }) {
  const mode = valeur?.mode ?? "";
  const changerMode = (m: string) => {
    if (m === "") return onChange(undefined);
    if (m === "PAR_TRANCHE") return onChange({ mode: "PAR_TRANCHE", tranches: [{ de: 1, a: 10, montant: "0" }] });
    onChange({ mode: m as "PAR_GARANTIE" | "PAR_CONTRAT" | "PAR_TETE", montant: valeur && "montant" in valeur ? valeur.montant : "0" });
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ListeDeroulante label={etiquette} value={mode} disabled={disabled} options={[{ valeur: "", libelle: aucun }, ...MODES]} onChange={(e) => changerMode(e.target.value)} />
        {valeur && valeur.mode !== "PAR_TRANCHE" ? (
          <ChampMontant label="Montant (F CFA)" disabled={disabled} value={valeur.montant} onChange={(v) => onChange({ mode: valeur.mode, montant: decimalSaisi(v) })} />
        ) : null}
      </div>
      {valeur?.mode === "PAR_TRANCHE" ? (
        <div className="space-y-3">
          {valeur.tranches.map((t, i) => {
            const remplacer = (patch: Partial<typeof t>) => onChange({ mode: "PAR_TRANCHE", tranches: valeur.tranches.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
            return (
              <div key={i} className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <Champ label={`Tranche ${i + 1} : de (assurés)`} inputMode="numeric" disabled={disabled} value={String(t.de)} onChange={(e) => remplacer({ de: Number(e.target.value) })} />
                <Champ label="à (assurés)" inputMode="numeric" disabled={disabled} value={String(t.a)} onChange={(e) => remplacer({ a: Number(e.target.value) })} />
                <ChampMontant label="Montant (F CFA)" disabled={disabled} value={t.montant} onChange={(v) => remplacer({ montant: decimalSaisi(v) })} />
                {!disabled && valeur.tranches.length > 1 ? (
                  <Bouton variante="danger" onClick={() => onChange({ mode: "PAR_TRANCHE", tranches: valeur.tranches.filter((_, k) => k !== i) })} aria-label={`Supprimer la tranche ${i + 1}`}>
                    Supprimer
                  </Bouton>
                ) : null}
              </div>
            );
          })}
          {!disabled ? (
            <Bouton
              variante="secondaire"
              onClick={() => {
                const derniere = valeur.tranches[valeur.tranches.length - 1];
                const de = (derniere?.a ?? 0) + 1;
                onChange({ mode: "PAR_TRANCHE", tranches: [...valeur.tranches, { de, a: de + 9, montant: "0" }] });
              }}
            >
              Ajouter une tranche
            </Bouton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Onglet « Garanties » : nom, définition, souscription, taxe et accessoires (hérités du produit ou remplacés), composantes de prime. */
export function OngletGaranties({ ctx, disabled }: { ctx: ContexteEdition; disabled: boolean }) {
  const { doc, maj, appliquer, refuser } = ctx;
  const ouverts = useOuverts();
  const [nomNeuf, setNomNeuf] = useState("");

  const majGarantie = (code: string, f: (g: Garantie) => Garantie) => maj((b) => ({ ...b, garanties: b.garanties.map((g) => (g.code === code ? f(g) : g)) }));
  const ajouter = () => {
    const nom = nomNeuf.trim();
    if (nom === "") return refuser(["Donnez un nom à la garantie : son code en est proposé."]);
    const code = proposerCode(nom, doc.garanties.map((g) => g.code), "garantie");
    maj((b) => ({ ...b, garanties: [...b.garanties, garantieNeuve(code, nom)] }));
    ouverts.ouvrir(code);
    setNomNeuf("");
  };
  const taxes = (courante: string | undefined) => [...(courante && !ctx.categoriesTaxe.includes(courante) ? [courante] : []), ...ctx.categoriesTaxe];

  return (
    <div className="space-y-6">
      <section aria-labelledby="produit" className="space-y-3">
        <h3 id="produit" className={SOUS_TITRE}>
          Taxe et accessoires du produit
        </h3>
        <p className="text-sm text-muted-foreground">Valeurs par défaut de toutes les garanties ; une garantie peut les remplacer.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ListeDeroulante
            label="Catégorie de taxe du produit"
            value={doc.produit.taxe}
            disabled={disabled}
            options={taxes(doc.produit.taxe).map((t) => ({ valeur: t, libelle: t }))}
            onChange={(e) => maj((b) => ({ ...b, produit: { ...b.produit, taxe: e.target.value } }))}
          />
        </div>
        <EditeurAccessoires etiquette="Accessoires du produit" aucun="Aucun accessoire" valeur={doc.produit.accessoires} disabled={disabled} onChange={(a) => maj((b) => ({ ...b, produit: { ...b.produit, accessoires: a } }))} />
      </section>

      <section aria-labelledby="garanties" className="space-y-3">
        <h3 id="garanties" className={SOUS_TITRE}>
          Garanties ({doc.garanties.length})
        </h3>
        {!disabled ? (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Champ label="Nouvelle garantie (nom)" value={nomNeuf} autoComplete="off" onChange={(e) => setNomNeuf(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), ajouter())} />
            <Bouton onClick={ajouter}>Ajouter la garantie</Bouton>
          </div>
        ) : null}
        {doc.garanties.map((g, i) => (
          <Depliable
            key={g.code}
            ouvert={ouverts.estOuvert(g.code)}
            onBascule={(o) => ouverts.bascule(g.code, o)}
            titre={g.nom}
            sousTitre={g.code}
            pastilles={
              <>
                <Pastille ton="info">{g.souscription === "OBLIGATOIRE" ? "Obligatoire" : g.souscription === "OPTIONNELLE" ? "Optionnelle" : "Conditionnelle"}</Pastille>
                <Pastille>{g.composantes.length} composante{g.composantes.length > 1 ? "s" : ""}</Pastille>
              </>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Champ label="Nom (libellé de la ligne de prime)" value={g.nom} disabled={disabled} autoComplete="off" onChange={(e) => majGarantie(g.code, (x) => ({ ...x, nom: e.target.value }))} />
              <ChampCode
                key={g.code}
                label="Code"
                valeur={g.code}
                disabled={disabled}
                valider={(nouveau) => {
                  const r = renommerGarantie(doc, g.code, nouveau);
                  appliquer(r);
                  if (r.ok) ouverts.renommer(g.code, nouveau);
                  return r.ok;
                }}
              />
            </div>
            <ZoneTexte label="Définition" rows={3} value={g.definition ?? ""} disabled={disabled} onChange={(e) => majGarantie(g.code, (x) => ({ ...x, definition: e.target.value === "" ? undefined : e.target.value }))} />
            <CaseACocher libelle="Afficher la définition sur les documents" coche={g.afficherSurDocuments === true} disabled={disabled} onChange={(v) => majGarantie(g.code, (x) => ({ ...x, afficherSurDocuments: v ? true : undefined }))} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ListeDeroulante
                label="Souscription"
                value={g.souscription}
                disabled={disabled}
                options={[
                  { valeur: "OBLIGATOIRE", libelle: "Obligatoire" },
                  { valeur: "OPTIONNELLE", libelle: "Optionnelle (case à cocher à la cotation)" },
                  { valeur: "CONDITION", libelle: "Conditionnelle (selon une condition)" },
                ]}
                onChange={(e) => majGarantie(g.code, (x) => ({ ...x, souscription: e.target.value as Garantie["souscription"], si: e.target.value === "CONDITION" ? x.si : undefined }))}
              />
              <ListeDeroulante
                label="Catégorie de taxe"
                value={g.taxe ?? ""}
                disabled={disabled}
                options={[{ valeur: "", libelle: `Celle du produit (${doc.produit.taxe})` }, ...taxes(g.taxe).map((t) => ({ valeur: t, libelle: t }))]}
                onChange={(e) => majGarantie(g.code, (x) => ({ ...x, taxe: e.target.value === "" ? undefined : e.target.value }))}
              />
            </div>
            {g.souscription === "CONDITION" ? (
              <EditeurCondition b={doc} etiquette="Garantie souscrite" sansSouscription={g.code} disabled={disabled} valeur={g.si} onChange={(si) => majGarantie(g.code, (x) => ({ ...x, si }))} />
            ) : null}
            <EditeurAccessoires
              etiquette="Accessoires de la garantie"
              aucun={doc.produit.accessoires ? `Ceux du produit (${libelleAccessoires(doc.produit.accessoires)})` : "Ceux du produit (aucun)"}
              valeur={g.accessoires}
              disabled={disabled}
              onChange={(a) => majGarantie(g.code, (x) => ({ ...x, accessoires: a }))}
            />

            <Composantes ctx={ctx} garantie={g} disabled={disabled} majGarantie={majGarantie} />

            {!disabled ? (
              <ActionsElement
                nom={`la garantie ${g.nom}`}
                onMonter={i > 0 ? () => maj((b) => ({ ...b, garanties: deplacer(b.garanties, i, -1) })) : undefined}
                onDescendre={i < doc.garanties.length - 1 ? () => maj((b) => ({ ...b, garanties: deplacer(b.garanties, i, 1) })) : undefined}
                onSupprimer={() => appliquer(supprimerGarantie(doc, g.code))}
              />
            ) : null}
          </Depliable>
        ))}
      </section>
    </div>
  );
}

const libelleAccessoires = (a: Accessoires): string => (a.mode === "PAR_TRANCHE" ? "par tranche d'effectif" : `${a.montant} F ${a.mode === "PAR_TETE" ? "par tête" : a.mode === "PAR_CONTRAT" ? "par contrat" : "par garantie"}`);

/** Composantes d'une garantie : chacune a sa souscription, son assiette (mêmes listes que les valeurs intermédiaires), son taux, son minimum. */
function Composantes({ ctx, garantie, disabled, majGarantie }: { ctx: ContexteEdition; garantie: Garantie; disabled: boolean; majGarantie: (code: string, f: (g: Garantie) => Garantie) => void }) {
  const { doc, appliquer, refuser } = ctx;
  const [nomNeuf, setNomNeuf] = useState("");
  const majComposante = (code: string, f: (c: Composante) => Composante) => majGarantie(garantie.code, (g) => ({ ...g, composantes: g.composantes.map((c) => (c.code === code ? f(c) : c)) }));
  const ajouter = () => {
    const nom = nomNeuf.trim();
    if (nom === "") return refuser(["Donnez un nom à la composante : son code en est proposé."]);
    const code = proposerCode(nom, garantie.composantes.map((c) => c.code), "composante");
    majGarantie(garantie.code, (g) => ({ ...g, composantes: [...g.composantes, { code, assiette: "0", taux: { unite: "POURCENT", fixe: "0" } }] }));
    setNomNeuf("");
  };

  return (
    <section aria-label={`Composantes de ${garantie.nom}`} className="space-y-3">
      <h4 className={SOUS_TITRE}>Composantes de prime ({garantie.composantes.length})</h4>
      <p className="text-sm text-muted-foreground">Prime d&apos;une composante = assiette × taux (puis minimum, puis × effectif si « par tête »). La prime de la garantie est la somme de ses composantes souscrites.</p>
      {garantie.composantes.map((c, i) => (
        <div key={c.code} className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ChampCode
              key={c.code}
              label="Code de la composante"
              valeur={c.code}
              disabled={disabled}
              valider={(nouveau) => {
                const r = renommerComposante(doc, garantie.code, c.code, nouveau);
                appliquer(r);
                return r.ok;
              }}
            />
            <ListeDeroulante
              label="Souscription de la composante"
              value={c.souscription ?? "OBLIGATOIRE"}
              disabled={disabled}
              options={[
                { valeur: "OBLIGATOIRE", libelle: "Obligatoire (avec la garantie)" },
                { valeur: "OPTIONNELLE", libelle: "Optionnelle (case à cocher à la cotation)" },
              ]}
              onChange={(e) => majComposante(c.code, (x) => ({ ...x, souscription: e.target.value === "OPTIONNELLE" ? "OPTIONNELLE" : undefined }))}
            />
          </div>
          <EditeurOperande
            b={doc}
            op={c.assiette}
            etiquette="Assiette (le montant sur lequel le taux s'applique)"
            intermediaires={doc.intermediaires.map((x) => x.code)}
            disabled={disabled}
            onChange={(op: Operande) => (profondeur(op) > PROFONDEUR_MAX ? refuser([MESSAGE_PROFONDEUR]) : majComposante(c.code, (x) => ({ ...x, assiette: op })))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ListeDeroulante
              label="Taux"
              value={"source" in c.taux ? "E1" : "FIXE"}
              disabled={disabled}
              options={[
                { valeur: "FIXE", libelle: "Taux fixe" },
                { valeur: "E1", libelle: "Taux lu dans une table (sous-jacent)" },
              ]}
              onChange={(e) => majComposante(c.code, (x) => ({ ...x, taux: e.target.value === "E1" ? { unite: x.taux.unite, source: "E1" } : { unite: x.taux.unite, fixe: "0" } }))}
            />
            <ListeDeroulante
              label="Unité du taux"
              value={c.taux.unite}
              disabled={disabled}
              options={[
                { valeur: "POURCENT", libelle: "Pourcentage (%)" },
                { valeur: "PERMILLE", libelle: "Pour mille (‰)" },
              ]}
              onChange={(e) => majComposante(c.code, (x) => ({ ...x, taux: { ...x.taux, unite: e.target.value as "POURCENT" | "PERMILLE" } }))}
            />
            {"fixe" in c.taux ? (
              <Champ label="Valeur du taux" inputMode="decimal" autoComplete="off" disabled={disabled} value={c.taux.fixe} onChange={(e) => majComposante(c.code, (x) => ({ ...x, taux: { unite: x.taux.unite, fixe: decimalSaisi(e.target.value) } }))} />
            ) : (
              <p className="self-end text-sm text-muted-foreground">Le taux vient d&apos;un sous-jacent E1 (onglet Sous-jacents).</p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ChampMontant label="Minimum de prime (facultatif)" disabled={disabled} value={c.minimum ?? ""} onChange={(v) => majComposante(c.code, (x) => ({ ...x, minimum: v === "" ? undefined : decimalSaisi(v) }))} />
            <div className="flex flex-col gap-2 self-end">
              <CaseACocher libelle="Minimum appliqué avant les coefficients" coche={c.minimumAvantCoefficients === true} disabled={disabled} onChange={(v) => majComposante(c.code, (x) => ({ ...x, minimumAvantCoefficients: v ? true : undefined }))} />
              <CaseACocher libelle="Par tête (multipliée par l'effectif)" coche={c.parTete === true} disabled={disabled} onChange={(v) => majComposante(c.code, (x) => ({ ...x, parTete: v ? true : undefined }))} />
            </div>
          </div>
          {!disabled ? (
            <ActionsElement
              nom={`la composante ${c.code}`}
              onMonter={i > 0 ? () => majGarantie(garantie.code, (g) => ({ ...g, composantes: deplacer(g.composantes, i, -1) })) : undefined}
              onDescendre={i < garantie.composantes.length - 1 ? () => majGarantie(garantie.code, (g) => ({ ...g, composantes: deplacer(g.composantes, i, 1) })) : undefined}
              onSupprimer={() => appliquer(supprimerComposante(doc, garantie.code, c.code))}
            />
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Champ label="Nouvelle composante (nom)" value={nomNeuf} autoComplete="off" onChange={(e) => setNomNeuf(e.target.value)} />
          <Bouton variante="secondaire" onClick={ajouter}>
            Ajouter la composante
          </Bouton>
        </div>
      ) : null}
    </section>
  );
}

void codesChampsEtIntermediaires;
