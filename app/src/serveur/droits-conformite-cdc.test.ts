import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTIONS, ACTIONS_HORS_CDC, PROFILS, droitsParDefaut, type CodeNiveau } from "@/domaine/droits";

/** Traduit une cellule du tableau du CDC §4 en niveau de droit. */
function niveauDeLaCellule(cellule: string): CodeNiveau {
  switch (cellule.trim()) {
    case "–":
    case "Non (auteur)":
      return "AUCUN";
    case "Lecture":
      return "LECTURE";
    case "Demande":
      return "DEMANDE";
    case "Taxes (proposition)":
      return "PROPOSITION";
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

describe("matrice par défaut = tableau du CDC §4 (docs/cdc.md)", () => {
  const cdc = readFileSync(fileURLToPath(new URL("../../../docs/cdc.md", import.meta.url)), "utf8");
  const debut = cdc.indexOf("# 4. Acteurs, profils et droits");
  const fin = cdc.indexOf("## 4.1");
  const lignes = cdc
    .slice(debut, fin)
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.startsWith("|---"))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  const [entete, ...corps] = lignes;

  // Les actions ajoutées par une décision (VALIDER_COTATION, D18) ne sont pas dans le tableau du CDC.
  const actionsDuCdc = ACTIONS.filter((a) => !ACTIONS_HORS_CDC.includes(a.code));

  it("le tableau lu a 1 colonne d'action, 6 profils et 11 lignes", () => {
    expect(entete).toHaveLength(7);
    expect(corps).toHaveLength(actionsDuCdc.length);
  });

  it("VALIDER_COTATION (D18) : réservé au profil Technique par défaut", () => {
    const m = droitsParDefaut();
    expect(PROFILS.map((p) => m[p.code].VALIDER_COTATION)).toEqual(["AUCUN", "AUCUN", "VALIDE", "AUCUN", "AUCUN", "AUCUN"]);
  });

  it("chaque cellule correspond à la matrice par défaut", () => {
    const matrice = droitsParDefaut();
    corps.forEach((ligne, i) => {
      PROFILS.forEach((profil, colonne) => {
        expect(matrice[profil.code][actionsDuCdc[i].code], `${ligne[0]} / ${entete[colonne + 1]}`).toBe(
          niveauDeLaCellule(ligne[colonne + 1]),
        );
      });
    });
  });
});
