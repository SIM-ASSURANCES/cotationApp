import "server-only";

import { CacheTemporaire } from "@/domaine/cache-temporaire";
import type { Periode } from "@/domaine/tableaux/indicateurs";

import { tableauCommercial, type TableauCommercial } from "./tableau-commercial";
import { exigerDroitTableauxDeBord, tableauDeBord, type TableauDeBord } from "./tableaux-de-bord";
import type { UtilisateurCourant } from "./types";

/**
 * Tableaux de bord de la page d'arrivée, gardés 60 secondes (audit M7) : leur calcul relit toutes les factures à chaque
 * affichage. Les chiffres ont donc au plus une minute de retard (la période et le jour restent ceux demandés). La mémoire est
 * celle du processus de l'application ; elle ne contourne jamais un droit : le droit est vérifié AVANT de la consulter.
 * Les fonctions de tableaux-de-bord.ts et tableau-commercial.ts, elles, recalculent toujours.
 */
export const DUREE_MEMOIRE_TABLEAUX_MS = 60_000;

const generaux = new CacheTemporaire<TableauDeBord>(DUREE_MEMOIRE_TABLEAUX_MS);
const commerciaux = new CacheTemporaire<TableauCommercial>(DUREE_MEMOIRE_TABLEAUX_MS);

const clePeriode = (periode?: Partial<Periode>) => `${periode?.debut ?? ""}|${periode?.fin ?? ""}`;

/** Tableau général : les mêmes chiffres pour tous ceux qui en ont le droit, donc une seule entrée par période. */
export async function tableauDeBordMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauDeBord> {
  await exigerDroitTableauxDeBord(acteur);
  return generaux.obtenir(clePeriode(periode), Date.now(), () => tableauDeBord(acteur, periode));
}

/** Tableau du commercial : une entrée par commercial ET par période, jamais partagée entre deux personnes. */
export function tableauCommercialMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauCommercial> {
  return commerciaux.obtenir(`${acteur.identifiant}|${clePeriode(periode)}`, Date.now(), () => tableauCommercial(acteur, periode));
}

/** Vide les deux mémoires (tests d'intégration). */
export function viderMemoireTableaux(): void {
  generaux.vider();
  commerciaux.vider();
}
