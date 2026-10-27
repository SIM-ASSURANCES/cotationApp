import type { Montant } from "../calcul/montant";
import { montant } from "../calcul/montant";

/**
 * Accessoires par tranche d'effectif (B6a, D51) : le montant des accessoires d'une garantie dépend du nombre d'assurés. Les tranches
 * sont bornées (de, a inclus), se suivent sans trou ni chevauchement et commencent à 1 ; un effectif hors tranches est refusé.
 */
export type Tranche = { de: number; a: number; montant: string };

/** Problèmes des tranches (vide si elles sont valides) : début à 1, aucun trou, aucun chevauchement, bornes dans l'ordre. */
export function problemesTranches(tranches: Tranche[]): { code: string; message: string }[] {
  const p: { code: string; message: string }[] = [];
  const triees = [...tranches].sort((x, y) => x.de - y.de);
  for (const t of triees) if (t.a < t.de) p.push({ code: "TRANCHE_INVERSEE", message: `la tranche ${t.de} à ${t.a} finit avant de commencer` });
  if (triees.length > 0 && triees[0].de !== 1) p.push({ code: "TRANCHES_DEBUT", message: `la première tranche doit commencer à 1 effectif (elle commence à ${triees[0].de})` });
  for (let i = 1; i < triees.length; i++) {
    const prec = triees[i - 1];
    const t = triees[i];
    if (t.de <= prec.a) p.push({ code: "TRANCHES_CHEVAUCHEMENT", message: `les tranches ${prec.de} à ${prec.a} et ${t.de} à ${t.a} se chevauchent` });
    else if (t.de > prec.a + 1) p.push({ code: "TRANCHES_TROU", message: `aucune tranche pour les effectifs ${prec.a + 1} à ${t.de - 1}` });
  }
  return p;
}

/** Montant des accessoires pour un effectif ; `undefined` si aucune tranche ne le contient. */
export function montantDeTranche(tranches: Tranche[], effectif: number): Montant | undefined {
  const t = tranches.find((x) => effectif >= x.de && effectif <= x.a);
  return t ? montant(t.montant) : undefined;
}

/** Écriture en cellule : « 1-5: 2500; 6-10: 4000 ». */
export const formaterTranches = (tranches: Tranche[]): string => tranches.map((t) => `${t.de}-${t.a}: ${t.montant}`).join("; ");

/** Lecture d'une cellule de tranches ; lève une `Error` au message français si une tranche est illisible. */
export function lireTranches(texte: string): Tranche[] {
  const morceaux = texte.split(/[;\n]/).map((x) => x.trim()).filter((x) => x !== "");
  if (morceaux.length === 0) throw new Error("aucune tranche");
  return morceaux.map((m) => {
    const r = /^(\d+)\s*(?:-|à|a)\s*(\d+)\s*[:=]\s*(\d+(?:[.,]\d+)?)$/.exec(m);
    if (!r) throw new Error(`tranche « ${m} » illisible (écrivez « 1-5: 2500 »)`);
    return { de: Number(r[1]), a: Number(r[2]), montant: r[3].replace(",", ".") };
  });
}
