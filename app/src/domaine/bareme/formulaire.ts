import { normaliserDateSaisie } from "../calcul/dates";
import { codeValeur } from "./contexte";
import type { Bareme, Champ, ConditionAffichage, Saisie, ValeurSaisie } from "./schema";

/**
 * Écran de cotation généré depuis un barème publié (B6a, D51 ; propositions-bareme.md §5). Le descripteur ne porte QUE ce que le
 * Commercial doit voir : blocs, champs (type, aide, bornes, listes, condition d'affichage) et choix de souscription. Il ne contient
 * ni taux, ni table, ni coefficient, ni assiette (Q6 : le détail du tarif est réservé à la Technique). Les fonctions sont pures :
 * le navigateur s'en sert pour afficher, le serveur recontrôle tout avec le moteur (`calculerBareme`).
 */

export type DescripteurChamp = {
  code: string;
  libelle: string;
  aide?: string;
  type: Champ["type"];
  bloc?: string;
  obligatoire: boolean;
  valeurs?: { v: string; l: string }[];
  min?: string;
  max?: string;
  si?: ConditionAffichage;
};

export type DescripteurGarantie = {
  code: string;
  nom: string;
  definition?: string;
  souscription: "OBLIGATOIRE" | "OPTIONNELLE" | "CONDITION";
  si?: ConditionAffichage;
  composantes: { code: string; optionnelle: boolean }[];
};

export type DescripteurSaisie = {
  blocs: { code: string; libelle: string }[];
  champs: DescripteurChamp[];
  garanties: DescripteurGarantie[];
  /** L'effectif assuré est demandé (accessoire par tête ou par tranche, composante par tête). */
  effectif: boolean;
};

export function descripteurSaisie(b: Bareme): DescripteurSaisie {
  const accParTete = (a: Bareme["produit"]["accessoires"]) => a?.mode === "PAR_TETE" || a?.mode === "PAR_TRANCHE";
  return {
    blocs: b.blocs.map((x) => ({ code: x.code, libelle: x.libelle })),
    champs: b.champs.map((c) => ({
      code: c.code,
      libelle: c.libelle ?? c.code,
      ...(c.aide !== undefined ? { aide: c.aide } : {}),
      type: c.type,
      ...(c.bloc !== undefined ? { bloc: c.bloc } : {}),
      obligatoire: c.obligatoire !== false,
      ...(c.valeurs ? { valeurs: c.valeurs.map((v) => ({ v: codeValeur(v), l: typeof v === "string" ? v : (v.l ?? v.v) })) } : {}),
      ...(c.min !== undefined ? { min: c.min } : {}),
      ...(c.max !== undefined ? { max: c.max } : {}),
      ...(c.si ? { si: c.si } : {}),
    })),
    garanties: b.garanties.map((g) => ({
      code: g.code,
      nom: g.nom,
      ...(g.definition !== undefined ? { definition: g.definition } : {}),
      souscription: g.souscription,
      ...(g.si ? { si: g.si } : {}),
      composantes: g.composantes.map((c) => ({ code: c.code, optionnelle: c.souscription === "OPTIONNELLE" })),
    })),
    effectif: b.garanties.some((g) => accParTete(g.accessoires ?? b.produit.accessoires) || g.composantes.some((c) => c.parTete === true)),
  };
}

/** État du formulaire : valeurs saisies (toujours des listes de textes) et souscriptions cochées (`vol`, `vol.caisse`). */
export type EtatSaisie = { champs: Record<string, string[]>; souscrit: string[] };

const texteDe = (valeurs: string[] | undefined): string | undefined => {
  const v = (valeurs ?? []).find((x) => x.trim() !== "");
  return v === undefined ? undefined : v.trim();
};

/** Même règle que le moteur : une garantie obligatoire est souscrite, « selon une condition » suit sa condition, sinon elle est cochée. */
export function garantieSouscrite(d: DescripteurSaisie, e: EtatSaisie, code: string): boolean {
  const g = d.garanties.find((x) => x.code === code);
  if (!g) return false;
  if (g.souscription === "OBLIGATOIRE") return true;
  if (g.souscription === "CONDITION") return g.si ? conditionVraie(d, e, g.si) : false;
  return e.souscrit.some((s) => s === g.code || s.startsWith(`${g.code}.`));
}

export function composanteSouscrite(d: DescripteurSaisie, e: EtatSaisie, garantie: string, composante: string): boolean {
  const g = d.garanties.find((x) => x.code === garantie);
  const c = g?.composantes.find((x) => x.code === composante);
  if (!g || !c || !garantieSouscrite(d, e, garantie)) return false;
  return !c.optionnelle || e.souscrit.includes(`${garantie}.${composante}`);
}

function conditionVraie(d: DescripteurSaisie, e: EtatSaisie, si: ConditionAffichage): boolean {
  if ("souscrit" in si) {
    const [g, c] = si.souscrit.split(".");
    return c === undefined ? garantieSouscrite(d, e, g) : composanteSouscrite(d, e, g, c);
  }
  const champ = d.champs.find((x) => x.code === si.champ);
  if (!champ || !champActif(d, e, champ.code)) return false;
  const valeur = texteDe(e.champs[si.champ]);
  if (valeur === undefined) return false;
  return "egal" in si ? valeur === si.egal : valeur !== si.different;
}

/** Un champ s'affiche si sa condition d'affichage est vraie (le serveur le recontrôle et ignore un champ non applicable). */
export function champActif(d: DescripteurSaisie, e: EtatSaisie, code: string, profondeur = 0): boolean {
  const c = d.champs.find((x) => x.code === code);
  if (!c || profondeur > 20) return false;
  return c.si ? conditionVraie(d, e, c.si) : true;
}

/**
 * Saisie du moteur depuis les champs bruts d'un formulaire (noms `bareme_<code>`, cases `souscrit`, `effectif`). Un champ vide est
 * omis (le moteur dit s'il était obligatoire) ; un oui/non devient un booléen, un choix multiple une liste, une date est normalisée.
 */
export function saisieDepuisFormulaire(b: Bareme, brut: { champs: Record<string, string[]>; souscrit: string[]; effectif?: string }): Saisie {
  const champs: Record<string, ValeurSaisie> = {};
  for (const c of b.champs) {
    const valeurs = brut.champs[c.code];
    if (c.type === "CHOIX_MULTIPLES") {
      const liste = (valeurs ?? []).map((v) => v.trim()).filter((v) => v !== "");
      if (liste.length > 0) champs[c.code] = liste;
      continue;
    }
    const t = texteDe(valeurs);
    if (t === undefined) continue;
    if (c.type === "OUI_NON") {
      if (t === "OUI") champs[c.code] = true;
      else if (t === "NON") champs[c.code] = false;
    } else if (c.type === "DATE") champs[c.code] = normaliserDateSaisie(t);
    else champs[c.code] = t;
  }
  const effectifTexte = (brut.effectif ?? "").trim();
  return {
    champs,
    souscrit: [...new Set(brut.souscrit.map((s) => s.trim()).filter((s) => s !== ""))],
    ...(effectifTexte !== "" ? { effectif: /^\d+$/.test(effectifTexte) ? Number(effectifTexte) : Number.NaN } : {}),
  };
}

/** Valeurs d'un formulaire à partir d'une saisie enregistrée (modification d'un brouillon). */
export function etatDepuisSaisie(s: Saisie | undefined): EtatSaisie {
  const champs: Record<string, string[]> = {};
  for (const [code, v] of Object.entries(s?.champs ?? {})) champs[code] = Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v];
  return { champs, souscrit: [...(s?.souscrit ?? [])] };
}
