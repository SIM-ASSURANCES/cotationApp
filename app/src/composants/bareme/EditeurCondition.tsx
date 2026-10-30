"use client";

import { ListeDeroulante } from "@/composants/ui";
import { champsPourCondition, conditionParDefaut, valeursPourCondition, type Bareme, type ConditionAffichage } from "@/domaine/bareme";

type Mode = "AUCUNE" | "EGAL" | "DIFFERENT" | "SOUSCRIT";

const modeDe = (si: ConditionAffichage | undefined): Mode => (!si ? "AUCUNE" : "souscrit" in si ? "SOUSCRIT" : "egal" in si ? "EGAL" : "DIFFERENT");

/** Références de souscription proposées : chaque garantie et chacune de ses composantes. */
function souscriptions(b: Bareme, sauf?: string): { valeur: string; libelle: string }[] {
  return b.garanties
    .filter((g) => g.code !== sauf)
    .flatMap((g) => [{ valeur: g.code, libelle: `Garantie « ${g.nom} »` }, ...(g.composantes.length > 1 ? g.composantes.map((c) => ({ valeur: `${g.code}.${c.code}`, libelle: `Composante « ${g.nom} — ${c.code} »` })) : [])]);
}

/**
 * Condition d'affichage (d'un champ) ou de souscription (d'une garantie) : un champ et une valeur choisis dans des listes, ou « telle
 * garantie est souscrite ». Jamais de texte libre. Un champ n'est comparable que s'il est une liste ou un oui / non.
 */
export function EditeurCondition({
  b,
  valeur,
  onChange,
  etiquette,
  sauf,
  sansSouscription,
  disabled,
}: {
  b: Bareme;
  valeur: ConditionAffichage | undefined;
  onChange: (v: ConditionAffichage | undefined) => void;
  etiquette: string;
  /** Champ qui porte la condition (il ne se lit pas lui-même). */
  sauf?: string;
  /** Garantie qui porte la condition : elle ne dépend pas de sa propre souscription. */
  sansSouscription?: string;
  disabled?: boolean;
}) {
  const mode = modeDe(valeur);
  const candidats = champsPourCondition(b, sauf);
  const garanties = souscriptions(b, sansSouscription);
  const choixMode = [
    { valeur: "AUCUNE", libelle: "Toujours" },
    { valeur: "EGAL", libelle: candidats.length === 0 ? "Si un champ vaut… (aucun champ liste ou oui/non)" : "Si un champ vaut…", desactive: candidats.length === 0 && mode !== "EGAL" },
    { valeur: "DIFFERENT", libelle: "Si un champ ne vaut pas…", desactive: candidats.length === 0 && mode !== "DIFFERENT" },
    { valeur: "SOUSCRIT", libelle: garanties.length === 0 ? "Si une garantie est souscrite… (aucune autre garantie)" : "Si une garantie est souscrite…", desactive: garanties.length === 0 && mode !== "SOUSCRIT" },
  ];
  const changerMode = (m: Mode) => {
    if (m === "AUCUNE") return onChange(undefined);
    if (m === "SOUSCRIT") return onChange({ souscrit: garanties[0]?.valeur ?? "" });
    const base = valeur && !("souscrit" in valeur) ? valeur : conditionParDefaut(b, sauf);
    if (!base || "souscrit" in base) return;
    const v = "egal" in base ? base.egal : base.different;
    onChange(m === "EGAL" ? { champ: base.champ, egal: v } : { champ: base.champ, different: v });
  };
  const champCourant = valeur && !("souscrit" in valeur) ? b.champs.find((c) => c.code === valeur.champ) : undefined;
  const valeursPossibles = champCourant ? valeursPourCondition(champCourant) : [];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <ListeDeroulante label={etiquette} value={mode} disabled={disabled} options={choixMode} onChange={(e) => changerMode(e.target.value as Mode)} />
      {valeur && "souscrit" in valeur ? (
        <ListeDeroulante
          label="Garantie ou composante"
          value={valeur.souscrit}
          disabled={disabled}
          options={[...(garanties.some((g) => g.valeur === valeur.souscrit) ? [] : [{ valeur: valeur.souscrit, libelle: `${valeur.souscrit} (introuvable)` }]), ...garanties]}
          onChange={(e) => onChange({ souscrit: e.target.value })}
        />
      ) : null}
      {valeur && !("souscrit" in valeur) ? (
        <>
          <ListeDeroulante
            label="Champ"
            value={valeur.champ}
            disabled={disabled}
            options={[...(candidats.some((c) => c.code === valeur.champ) ? [] : [{ valeur: valeur.champ, libelle: `${valeur.champ} (introuvable ou non comparable)` }]), ...candidats.map((c) => ({ valeur: c.code, libelle: c.libelle ?? c.code }))]}
            onChange={(e) => {
              const c = b.champs.find((x) => x.code === e.target.value);
              const premiere = c ? (valeursPourCondition(c)[0]?.code ?? "") : "";
              onChange(mode === "EGAL" ? { champ: e.target.value, egal: premiere } : { champ: e.target.value, different: premiere });
            }}
          />
          <ListeDeroulante
            label="Valeur"
            value={"egal" in valeur ? valeur.egal : valeur.different}
            disabled={disabled}
            options={[
              ...(valeursPossibles.some((v) => v.code === ("egal" in valeur ? valeur.egal : valeur.different)) ? [] : [{ valeur: "egal" in valeur ? valeur.egal : valeur.different, libelle: `${"egal" in valeur ? valeur.egal : valeur.different} (introuvable)` }]),
              ...valeursPossibles.map((v) => ({ valeur: v.code, libelle: v.libelle === v.code ? v.code : `${v.libelle} (${v.code})` })),
            ]}
            onChange={(e) => onChange("egal" in valeur ? { champ: valeur.champ, egal: e.target.value } : { champ: valeur.champ, different: e.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}
