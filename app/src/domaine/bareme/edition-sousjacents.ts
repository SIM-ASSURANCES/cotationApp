import { codeValide, feuilles, proposerCode, type Resultat } from "./edition";
import { clesPossibles, lecteursDeTable, lireCle } from "./edition-tables";
import type { Bareme, Condition, SousJacent } from "./schema";

/**
 * Édition des sous-jacents à l'écran (session B5, D59). Cinq effets, et seulement cinq (socle §2) :
 *  - E1 choisit le TAUX dans une table ;
 *  - E2 est un COEFFICIENT (ou, option, une RÉDUCTION en % de la prime de la garantie) ;
 *  - E3 donne l'ASSIETTE : elle n'est pas un sous-jacent du document, c'est l'assiette de chaque composante (valeur d'un champ, calcul
 *    ou valeur d'une table) ; l'écran la présente avec les autres effets mais elle s'écrit dans la composante (même document) ;
 *  - E4 est un REFUS avec le message saisi par la Technique ;
 *  - E5 est un MINIMUM, un PLAFOND ou un AJOUT lu dans une table.
 * Fonctions PURES sur le MÊME document que l'import : aucune règle de calcul ici, `verifierBareme` reste le seul juge.
 */

const ok = (bareme: Bareme): Resultat => ({ ok: true, bareme });
const refus = (...messages: string[]): Resultat => ({ ok: false, refus: messages });

export type EffetEcran = "E1" | "E2" | "E3" | "E4" | "E5";
export const EFFETS_ECRAN: readonly EffetEcran[] = ["E1", "E2", "E3", "E4", "E5"];

export const LIBELLE_EFFET: Record<EffetEcran, string> = {
  E1: "E1 — Choisit le taux dans une table",
  E2: "E2 — Coefficient (ou réduction en %)",
  E3: "E3 — Donne l'assiette (le capital)",
  E4: "E4 — Refuse le risque, avec un message",
  E5: "E5 — Minimum, plafond ou ajout d'un montant",
};

export const AIDE_EFFET: Record<EffetEcran, string> = {
  E1: "Le taux de la composante visée n'est plus fixe : il est lu dans une table selon la valeur d'un ou deux champs (classe de risque, âge…).",
  E2: "La prime de la composante est multipliée par la valeur lue dans la table (0,80 si gardien et extincteurs…). Avec l'option réduction, la valeur est un pourcentage retiré de la prime de la garantie.",
  E3: "L'assiette est le montant sur lequel le taux s'applique. Elle se règle dans chaque composante : un champ, un calcul, ou une valeur lue dans une table.",
  E4: "Quand la condition est vraie, la cotation est refusée et le Commercial lit le message que vous écrivez ici.",
  E5: "Un montant lu dans une table : minimum de prime, plafond de prime, ou montant ajouté à la prime de la composante.",
};

/** L'ordre dans lequel le moteur calcule : fixe, le même pour tous les produits (socle §6). Affiché, jamais modifiable. */
export const ORDRE_DE_CALCUL: readonly string[] = [
  "Contrôle des champs : obligatoires, bornes, valeurs des listes.",
  "Valeurs intermédiaires, dans l'ordre où elles sont définies.",
  "Pour chaque composante souscrite : l'assiette (E3), puis le taux de base ou lu dans une table (E1), puis les coefficients (E2), puis le minimum (fixe ou E5), le plafond (E5) et l'ajout (E5), puis × l'effectif si la composante est par tête.",
  "Pour chaque garantie : somme de ses composantes souscrites, puis réductions (E2 « réduction »), puis prorata de la période, puis accessoires.",
  "Contrôles de refus (E4) : un seul échec refuse la cotation avec son message.",
  "Taxe de chaque garantie, arrondi du produit, TTC, et lignes de composition (inchangés).",
];

// ---------------------------------------------------------------- Cibles

export type OptionCible = { valeur: string; libelle: string };

/**
 * Garanties et composantes qu'un effet peut viser. E1 : les composantes dont le taux est lu dans un sous-jacent. Réduction : une garantie
 * entière. Les autres : une garantie (toutes ses composantes) ou une composante.
 */
export function ciblesPossibles(b: Bareme, effet: "E1" | "E2" | "E5", reduction = false): OptionCible[] {
  const options: OptionCible[] = [];
  for (const g of b.garanties) {
    if (reduction) {
      options.push({ valeur: g.code, libelle: `Garantie « ${g.nom} »` });
      continue;
    }
    if (effet !== "E1" && g.composantes.length > 1) options.push({ valeur: g.code, libelle: `Garantie « ${g.nom} » (toutes ses composantes)` });
    for (const c of g.composantes) {
      if (effet === "E1" && !("source" in c.taux)) continue;
      options.push({ valeur: `${g.code}.${c.code}`, libelle: g.composantes.length > 1 ? `Composante « ${g.nom} — ${c.code} »` : `Garantie « ${g.nom} »` });
    }
  }
  return options;
}

// ---------------------------------------------------------------- Lecture

const nomDuChamp = (b: Bareme, code: string) => {
  const c = b.champs.find((x) => x.code === code);
  return c?.libelle ?? code;
};

/** Champs qu'un sous-jacent lit, pour l'affichage (« Gardien, Extincteurs »). Table : les clés de la table. E4 : les champs de la condition. */
export function champsLusParSousJacent(b: Bareme, s: SousJacent): string[] {
  if (s.effet === "E4") {
    const q: Condition = s.quand;
    const codes = Array.isArray(q) ? [...feuilles(q[1]), ...feuilles(q[2])] : [q.champ];
    return [...new Set(codes)].map((c) => nomDuChamp(b, c));
  }
  const t = b.tables.find((x) => x.code === s.table);
  return (t?.cles ?? []).map((spec) => lireCle(b, spec)?.libelle ?? spec);
}

// ---------------------------------------------------------------- Création

const sousJacentDe = (b: Bareme, code: string) => b.sousJacents.find((s) => s.code === code);
const remplacer = (b: Bareme, code: string, f: (s: SousJacent) => SousJacent): Bareme => ({ ...b, sousJacents: b.sousJacents.map((s) => (s.code === code ? f(s) : s)) });

export type DemandeSousJacent =
  | { effet: "E1" | "E2" | "E5"; nom: string; champs: string[]; cible: string; reduction?: boolean; mode?: "MINIMUM" | "PLAFOND" | "AJOUT" }
  | { effet: "E4"; nom: string; message: string };

/**
 * Ajoute un sous-jacent. E1, E2 et E5 lisent un ou deux champs : la table qui porte leurs valeurs est créée en même temps, VIDE (clés tirées
 * des champs choisis), à remplir dans l'onglet Tables. E4 est créé avec la première condition possible. Les codes sont proposés depuis le nom.
 */
export function ajouterSousJacent(b: Bareme, demande: DemandeSousJacent): Resultat {
  const nom = demande.nom.trim();
  if (nom === "") return refus("Donnez un nom au sous-jacent : son code en est proposé.");
  const code = proposerCode(nom, b.sousJacents.map((s) => s.code), "sous_jacent");
  if (demande.effet === "E4") {
    const message = demande.message.trim();
    if (message === "") return refus("Écrivez le message de refus : c'est lui que le Commercial lira.");
    const premier = b.champs.find((c) => c.type === "LISTE" || c.type === "OUI_NON");
    const quand: Condition = premier ? ({ champ: premier.code, egal: premier.type === "OUI_NON" ? "OUI" : codeDePremiereValeur(premier) } as Condition) : [">", "0", "0"];
    return ok({ ...b, sousJacents: [...b.sousJacents, { code, effet: "E4", quand, message }] });
  }
  if (demande.champs.length === 0) return refus("Choisissez le champ que ce sous-jacent lit.");
  if (demande.champs.length > 2) return refus("Un sous-jacent lit un ou deux champs au plus.");
  if (demande.cible === "") return refus("Choisissez la garantie ou la composante visée.");
  const disponibles = clesPossibles(b).map((c) => c.spec);
  const inconnu = demande.champs.find((c) => !disponibles.includes(c));
  if (inconnu) return refus(`« ${inconnu} » ne peut pas être lu par une table : seuls une liste, un oui / non ou un attribut de liste le sont.`);
  if (new Set(demande.champs).size !== demande.champs.length) return refus("Un sous-jacent ne lit pas deux fois le même champ.");

  const codeTable = proposerCode(nom, b.tables.map((t) => t.code), "table");
  const table = { code: codeTable, cles: demande.champs, lignes: {} };
  const commun = { code, table: codeTable, cibles: [demande.cible] };
  const sj: SousJacent =
    demande.effet === "E1"
      ? { ...commun, effet: "E1" }
      : demande.effet === "E2"
        ? { ...commun, effet: "E2", ...(demande.reduction ? { reduction: true } : {}) }
        : { ...commun, effet: "E5", mode: demande.mode ?? "MINIMUM" };
  return ok({ ...b, tables: [...b.tables, table], sousJacents: [...b.sousJacents, sj] });
}

function codeDePremiereValeur(c: NonNullable<Bareme["champs"][number]>): string {
  const v = (c.valeurs ?? [])[0];
  return v === undefined ? "" : typeof v === "string" ? v : v.v;
}

// ---------------------------------------------------------------- Modification

export function renommerSousJacent(b: Bareme, ancien: string, nouveau: string): Resultat {
  if (nouveau === ancien) return ok(b);
  if (!codeValide(nouveau)) return refus("Code : minuscules, chiffres et _, commence par une lettre (40 caractères au plus).");
  if (sousJacentDe(b, nouveau)) return refus(`Le code « ${nouveau} » est déjà utilisé par un sous-jacent.`);
  return ok(remplacer(b, ancien, (s) => ({ ...s, code: nouveau })));
}

export function changerTable(b: Bareme, code: string, table: string): Resultat {
  const s = sousJacentDe(b, code);
  if (!s || s.effet === "E4") return refus(`Le sous-jacent « ${code} » ne lit pas de table.`);
  if (!b.tables.some((t) => t.code === table)) return refus(`La table « ${table} » n'existe pas.`);
  return ok(remplacer(b, code, (x) => ({ ...x, table }) as SousJacent));
}

/** Cibles visées : au moins une. En mode réduction, des garanties entières seulement. */
export function changerCibles(b: Bareme, code: string, cibles: string[]): Resultat {
  const s = sousJacentDe(b, code);
  if (!s || s.effet === "E4") return refus(`Le sous-jacent « ${code} » n'a pas de cible.`);
  if (cibles.length === 0) return refus("Un sous-jacent vise au moins une garantie ou une composante : cochez-en une, ou supprimez le sous-jacent.");
  return ok(remplacer(b, code, (x) => ({ ...x, cibles }) as SousJacent));
}

/** Bascule coefficient ↔ réduction (E2). Passer en réduction ramène chaque cible à sa garantie entière. */
export function changerReduction(b: Bareme, code: string, reduction: boolean): Resultat {
  const s = sousJacentDe(b, code);
  if (!s || s.effet !== "E2") return refus(`Le sous-jacent « ${code} » n'est pas un coefficient (E2).`);
  const cibles = reduction ? [...new Set(s.cibles.map((c) => c.split(".")[0]))] : s.cibles;
  return ok(
    remplacer(b, code, (x) => {
      const reste = Object.fromEntries(Object.entries(x).filter(([k]) => k !== "reduction"));
      return { ...reste, cibles, ...(reduction ? { reduction: true } : {}) } as SousJacent;
    }),
  );
}

export function changerMode(b: Bareme, code: string, mode: "MINIMUM" | "PLAFOND" | "AJOUT"): Resultat {
  const s = sousJacentDe(b, code);
  if (!s || s.effet !== "E5") return refus(`Le sous-jacent « ${code} » n'est pas un minimum, un plafond ou un ajout (E5).`);
  return ok(remplacer(b, code, (x) => ({ ...x, mode }) as SousJacent));
}

export function changerMessage(b: Bareme, code: string, message: string): Resultat {
  const s = sousJacentDe(b, code);
  if (!s || s.effet !== "E4") return refus(`Le sous-jacent « ${code} » n'est pas un refus (E4).`);
  return ok(remplacer(b, code, (x) => ({ ...x, message }) as SousJacent));
}

export function changerCondition(b: Bareme, code: string, quand: Condition): Resultat {
  const s = sousJacentDe(b, code);
  if (!s || s.effet !== "E4") return refus(`Le sous-jacent « ${code} » n'est pas un refus (E4).`);
  return ok(remplacer(b, code, (x) => ({ ...x, quand }) as SousJacent));
}

/**
 * Supprime un sous-jacent. Refusé si une composante en attend son taux (E1 : la composante deviendrait sans taux) : on la nomme, et on dit
 * quoi faire. La table du sous-jacent est conservée (elle peut être lue ailleurs) ; une table orpheline se supprime dans l'onglet Tables.
 */
export function supprimerSousJacent(b: Bareme, code: string): Resultat {
  const s = sousJacentDe(b, code);
  if (!s) return refus(`Le sous-jacent « ${code} » n'existe pas.`);
  if (s.effet === "E1") {
    const attend = b.garanties.flatMap((g) => g.composantes.filter((c) => "source" in c.taux && (s.cibles.includes(g.code) || s.cibles.includes(`${g.code}.${c.code}`))).map((c) => `la composante « ${g.code}.${c.code} »`));
    if (attend.length > 0) return refus(`Suppression refusée : ${attend.join(", ")} attend son taux de ce sous-jacent. Donnez-lui d'abord un taux fixe (onglet Garanties), ou visez-la avec un autre sous-jacent E1.`);
  }
  return ok({ ...b, sousJacents: b.sousJacents.filter((x) => x.code !== code) });
}

/** Tables qu'aucun sous-jacent, assiette ou contrôle ne lit (signalées dans l'onglet Tables, supprimables). */
export const tablesOrphelines = (b: Bareme): string[] => b.tables.filter((t) => lecteursDeTable(b, t.code).length === 0).map((t) => t.code);
