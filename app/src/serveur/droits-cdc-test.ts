// Aide des tests : lit le tableau des droits du CDC §4 (docs/cdc.md) pour le comparer aux droits par défaut,
// qu'ils soient dans le code (domaine/droits.ts) ou écrits en base par l'initialisation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ACTIONS, ACTIONS_HORS_CDC, PROFILS, type CodeAction, type CodeNiveau, type CodeProfil } from "@/domaine/droits";

/**
 * Traduit une cellule du tableau du CDC §4 en niveau de droit.
 * Écart consigné (D21, décision de Thierry du 08/10/2026) : « Taxes (proposition) » devient LECTURE, la valeur
 * « Proposition » n'existant plus.
 */
export function niveauDeLaCellule(cellule: string): CodeNiveau {
  switch (cellule.trim()) {
    case "–":
    case "Non (auteur)":
      return "AUCUN";
    case "Lecture":
    case "Taxes (proposition)":
      return "LECTURE";
    case "Demande":
      return "DEMANDE";
    case "Oui (sous seuil)":
      return "OUI_SOUS_SEUIL";
    case "Oui":
      return "OUI";
    case "Valide":
      return "VALIDE";
    default:
      throw new Error(`cellule inconnue dans le CDC : « ${cellule} »`);
  }
}

/** Actions du tableau du CDC, dans l'ordre des lignes (les actions ajoutées par une décision n'y figurent pas). */
export const ACTIONS_DU_CDC: readonly CodeAction[] = ACTIONS.map((a) => a.code).filter((code) => !ACTIONS_HORS_CDC.includes(code));

/** Le tableau §4 : l'en-tête et une ligne par action (la première cellule est le libellé de l'action). */
export function lireTableauCdc(): { entete: string[]; corps: string[][] } {
  const cdc = readFileSync(fileURLToPath(new URL("../../../docs/cdc.md", import.meta.url)), "utf8");
  const lignes = cdc
    .slice(cdc.indexOf("# 4. Acteurs, profils et droits"), cdc.indexOf("## 4.1"))
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.startsWith("|---"))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  const [entete, ...corps] = lignes;
  return { entete, corps };
}

/** Niveau attendu par le CDC pour chaque (profil, action) du tableau. */
export function matriceDuCdc(): Record<CodeProfil, Partial<Record<CodeAction, CodeNiveau>>> {
  const { corps } = lireTableauCdc();
  const matrice = {} as Record<CodeProfil, Partial<Record<CodeAction, CodeNiveau>>>;
  PROFILS.forEach((profil, colonne) => {
    matrice[profil.code] = {};
    corps.forEach((ligne, i) => {
      matrice[profil.code][ACTIONS_DU_CDC[i]] = niveauDeLaCellule(ligne[colonne + 1]);
    });
  });
  return matrice;
}
