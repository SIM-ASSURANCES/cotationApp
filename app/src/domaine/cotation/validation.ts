import { exigeDoubleValidation } from "../calcul/validation";
import type { EntreeMontant, Montant } from "../calcul/montant";
import { montant } from "../calcul/montant";

/** Forçage de prime et double validation (CDC §4.1, T13). Règles pures. */

export type RaisonValidation = "PRIME_FORCEE" | "SEUIL_DEPASSE";

export const LIBELLE_RAISON: Record<RaisonValidation, string> = {
  PRIME_FORCEE: "Prime forcée",
  SEUIL_DEPASSE: "Seuil de TTC dépassé",
};

/** Une prime est « forcée » seulement si elle DIFFÈRE du tarif calculé (CDC §4.1 : « écart »). */
export type Forcage = { code: string; primeTarif: Montant; primeForcee: Montant; ecart: Montant };

export function detecterForcages(
  lignes: { code: string; primeTarif: EntreeMontant; primeForcee: EntreeMontant | null }[],
): Forcage[] {
  const forcages: Forcage[] = [];
  for (const l of lignes) {
    if (l.primeForcee === null) continue;
    const tarif = montant(l.primeTarif);
    const forcee = montant(l.primeForcee);
    if (!forcee.eq(tarif)) {
      forcages.push({ code: l.code, primeTarif: tarif, primeForcee: forcee, ecart: forcee.minus(tarif) });
    }
  }
  return forcages;
}

export const MOTIF_FORCAGE_LONGUEUR_MIN = 5;

/** Un forçage exige un motif, quel que soit le montant. Renvoie les problèmes (vide si correct). */
export function problemesForcage(forcages: Forcage[], motif: string | null): string[] {
  if (forcages.length === 0) return [];
  if (motif === null || motif.trim().length < MOTIF_FORCAGE_LONGUEUR_MIN) {
    return [`Le motif du forçage de prime est obligatoire (${MOTIF_FORCAGE_LONGUEUR_MIN} caractères au moins).`];
  }
  return [];
}

/** Pourquoi la cotation doit passer en « À valider » : prime forcée (toujours) ou TTC au-dessus du seuil. */
export function raisonsDeValidation(options: { forcages: Forcage[]; ttc: EntreeMontant; seuil: EntreeMontant | null }): RaisonValidation[] {
  const raisons: RaisonValidation[] = [];
  if (options.forcages.length > 0) raisons.push("PRIME_FORCEE");
  if (exigeDoubleValidation(options.ttc, options.seuil)) raisons.push("SEUIL_DEPASSE");
  return raisons;
}

export { valideurAutorise } from "../calcul/validation";
