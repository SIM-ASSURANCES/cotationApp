import "server-only";

import { CacheTemporaire } from "@/domaine/cache-temporaire";
import type { Periode } from "@/domaine/tableaux/indicateurs";

import { tableauAdmin, type TableauAdmin } from "./tableau-admin";
import { tableauCommercial, type TableauCommercial } from "./tableau-commercial";
import { tableauComptabilite, type TableauComptabilite } from "./tableau-comptabilite";
import { tableauDirectionGenerale, type TableauDirectionGenerale } from "./tableau-dg";
import { tableauProduction, type TableauProduction } from "./tableau-production";
import { tableauTechnique, type TableauTechnique } from "./tableau-technique";
import { exigerDroitTableauxDeBord, exigerLectureTableau, tableauDeBord, type TableauDeBord } from "./tableaux-de-bord";
import type { UtilisateurCourant } from "./types";

/**
 * Tableaux de bord de la page d'arrivée, gardés 60 secondes (audit M7) : leur calcul relit les agrégations à chaque
 * affichage. Les chiffres ont donc au plus une minute de retard (la période et le jour restent ceux demandés).
 */
export const DUREE_MEMOIRE_TABLEAUX_MS = 60_000;

const generaux = new CacheTemporaire<TableauDeBord>(DUREE_MEMOIRE_TABLEAUX_MS);
const commerciaux = new CacheTemporaire<TableauCommercial>(DUREE_MEMOIRE_TABLEAUX_MS);
const techniques = new CacheTemporaire<TableauTechnique>(DUREE_MEMOIRE_TABLEAUX_MS);
const comptas = new CacheTemporaire<TableauComptabilite>(DUREE_MEMOIRE_TABLEAUX_MS);
const dgs = new CacheTemporaire<TableauDirectionGenerale>(DUREE_MEMOIRE_TABLEAUX_MS);
const productions = new CacheTemporaire<TableauProduction>(DUREE_MEMOIRE_TABLEAUX_MS);
const admins = new CacheTemporaire<TableauAdmin>(DUREE_MEMOIRE_TABLEAUX_MS);

const clePeriode = (periode?: Partial<Periode>) => `${periode?.debut ?? ""}|${periode?.fin ?? ""}`;

/** Tableau général : les mêmes chiffres pour tous ceux qui en ont le droit, donc une seule entrée par période. */
export async function tableauDeBordMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauDeBord> {
  await exigerDroitTableauxDeBord(acteur);
  return generaux.obtenir(clePeriode(periode), Date.now(), () => tableauDeBord(acteur, periode));
}

/** Tableau du commercial : le droit est vérifié avant la mémoire ; une entrée par commercial ET par période, jamais partagée entre deux personnes. */
export async function tableauCommercialMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauCommercial> {
  await exigerLectureTableau(acteur, "commercial");
  return commerciaux.obtenir(`${acteur.identifiant}|${clePeriode(periode)}`, Date.now(), () => tableauCommercial(acteur, periode));
}

export async function tableauTechniqueMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauTechnique> {
  await exigerLectureTableau(acteur, "technique");
  return techniques.obtenir(clePeriode(periode), Date.now(), () => tableauTechnique(acteur, periode));
}

export async function tableauComptabiliteMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauComptabilite> {
  await exigerLectureTableau(acteur, "comptabilite");
  return comptas.obtenir(clePeriode(periode), Date.now(), () => tableauComptabilite(acteur, periode));
}

export async function tableauDGMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauDirectionGenerale> {
  await exigerLectureTableau(acteur, "direction");
  return dgs.obtenir(clePeriode(periode), Date.now(), () => tableauDirectionGenerale(acteur, periode));
}

export async function tableauProductionMemorise(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauProduction> {
  await exigerLectureTableau(acteur, "production");
  return productions.obtenir(clePeriode(periode), Date.now(), () => tableauProduction(acteur, periode));
}

export async function tableauAdminMemorise(acteur: UtilisateurCourant): Promise<TableauAdmin> {
  await exigerLectureTableau(acteur, "admin");
  return admins.obtenir("admin", Date.now(), () => tableauAdmin(acteur));
}

/** Vide toutes les mémoires (tests d'intégration). */
export function viderMemoireTableaux(): void {
  generaux.vider();
  commerciaux.vider();
  techniques.vider();
  comptas.vider();
  dgs.vider();
  productions.vider();
  admins.vider();
}
