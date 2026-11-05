import { normaliserDateSaisie } from "../calcul/dates";
import { codeValeur } from "./contexte";
import { horsPlage, messageHorsPlage } from "./plage";
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

const accParTete = (a: Bareme["produit"]["accessoires"]) => a?.mode === "PAR_TETE" || a?.mode === "PAR_TRANCHE";

/** Le barème tarife par effectif : un accessoire par tête ou par tranche, ou une composante par tête (B6b, D52 : plafond de l'import en masse). */
export const baremeTarifeParEffectif = (b: Bareme): boolean => b.garanties.some((g) => accParTete(g.accessoires ?? b.produit.accessoires) || g.composantes.some((c) => c.parTete === true));

export function descripteurSaisie(b: Bareme): DescripteurSaisie {
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
    effectif: baremeTarifeParEffectif(b),
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

/** Clés des cases de souscription que l'écran peut porter : `vol` (la garantie) et `vol.caisse` (une composante). */
const clesDeCases = (d: DescripteurSaisie): Set<string> => new Set(d.garanties.flatMap((g) => [g.code, ...g.composantes.map((c) => `${g.code}.${c.code}`)]));

/**
 * Où un champ s'affiche (ergonomie du formulaire de cotation, D62). Un champ dont la condition est « la garantie (ou la composante)
 * est souscrite » s'affiche SOUS la case de cette garantie ; un champ qui dépend d'un tel champ le suit. Les autres restent dans
 * leur bloc. Le descripteur ne change pas : seul l'endroit où l'écran pose le champ change, la condition d'affichage reste celle du moteur.
 */
export function ancrageDesChamps(d: DescripteurSaisie): { parCase: Map<string, DescripteurChamp[]>; dansBloc: DescripteurChamp[] } {
  const valides = clesDeCases(d);
  const cleDe = (c: DescripteurChamp, profondeur = 0): string | null => {
    if (!c.si || profondeur > 20) return null;
    if ("souscrit" in c.si) return valides.has(c.si.souscrit) ? c.si.souscrit : null;
    const codeParent = c.si.champ;
    const parent = d.champs.find((x) => x.code === codeParent);
    return parent ? cleDe(parent, profondeur + 1) : null;
  };
  const parCase = new Map<string, DescripteurChamp[]>();
  const dansBloc: DescripteurChamp[] = [];
  for (const c of d.champs) {
    const cle = cleDe(c);
    if (cle === null) dansBloc.push(c);
    else parCase.set(cle, [...(parCase.get(cle) ?? []), c]);
  }
  return { parCase, dansBloc };
}

/**
 * Libellés des champs obligatoires VISIBLES (condition d'affichage vraie) qui ne sont pas remplis, plus l'effectif s'il est demandé.
 * Le calcul automatique ne part que si cette liste est vide ; sinon l'écran dit « Complétez : … » sans rien envoyer au serveur.
 */
export function champsManquants(d: DescripteurSaisie, e: EtatSaisie, effectif: string): string[] {
  const manquants = d.champs.filter((c) => c.obligatoire && champActif(d, e, c.code) && !(e.champs[c.code] ?? []).some((v) => v.trim() !== "")).map((c) => c.libelle);
  if (d.effectif && effectif.trim() === "") manquants.push("Nombre d'assurés");
  return manquants;
}

/**
 * Messages des champs montant ou nombre VISIBLES dont la valeur saisie sort de la plage du barème (D64) : ils nomment le champ et la plage.
 * Le calcul automatique ne part pas tant que la liste n'est pas vide ; le serveur refuse de même (même texte, `contexte.ts`).
 */
export function champsHorsPlage(d: DescripteurSaisie, e: EtatSaisie): string[] {
  const messages: string[] = [];
  for (const c of d.champs) {
    if ((c.type !== "MONTANT" && c.type !== "NOMBRE") || !champActif(d, e, c.code)) continue;
    const saisi = texteDe(e.champs[c.code]);
    const hors = saisi === undefined ? null : horsPlage(c, saisi);
    if (hors) messages.push(messageHorsPlage(c.libelle, hors.valeur, hors.plage));
  }
  return messages;
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
