import { describe, expect, it } from "vitest";

import { ACTIONS, ACTIONS_HORS_CDC, PROFILS, droitsParDefaut, estCodeNiveau, NIVEAUX } from "@/domaine/droits";

import { ACTIONS_DU_CDC, lireTableauCdc, niveauDeLaCellule } from "./droits-cdc-test";

describe("matrice par défaut = tableau du CDC §4 (docs/cdc.md)", () => {
  const { entete, corps } = lireTableauCdc();

  it("le tableau lu a 1 colonne d'action, 6 profils et 11 lignes", () => {
    expect(entete).toHaveLength(7);
    expect(corps).toHaveLength(ACTIONS_DU_CDC.length);
    expect(ACTIONS_DU_CDC).toHaveLength(ACTIONS.length - ACTIONS_HORS_CDC.length);
  });

  it("les colonnes du CDC sont les profils du code, dans le même ordre (la comparaison se fait par position)", () => {
    expect(entete.slice(1)).toEqual(PROFILS.map((p) => p.libelle));
  });

  it("VALIDER_COTATION : Technique et Direction Générale par défaut (étape 3, fin écart D21)", () => {
    const m = droitsParDefaut();
    expect(PROFILS.map((p) => m[p.code].VALIDER_COTATION)).toEqual(["AUCUN", "AUCUN", "VALIDE", "AUCUN", "VALIDE", "AUCUN"]);
  });

  it("chaque cellule correspond à la matrice par défaut (traductions retouchées : « Taxes (proposition) » = Lecture, D21 ; fin écart D21 : DG valide contrat et facture)", () => {
    const matrice = droitsParDefaut();
    corps.forEach((ligne, i) => {
      PROFILS.forEach((profil, colonne) => {
        const action = ACTIONS_DU_CDC[i];
        if (profil.code === "DIRECTION_GENERALE" && (action === "EMETTRE_CONTRAT" || action === "EMETTRE_FACTURE")) {
          expect(matrice[profil.code][action]).toBe("VALIDE");
        } else {
          expect(matrice[profil.code][action], `${ligne[0]} / ${entete[colonne + 1]}`).toBe(niveauDeLaCellule(ligne[colonne + 1]));
        }
      });
    });
  });

  it("le Commercial crée une cotation (« Oui »)", () => {
    expect(droitsParDefaut().COMMERCIAL.CREER_COTATION).toBe("OUI");
  });

  it("la valeur « Proposition » n'existe plus : la Comptabilité consulte le paramétrage", () => {
    expect(NIVEAUX.map((n) => n.code)).not.toContain("PROPOSITION");
    expect(estCodeNiveau("PROPOSITION")).toBe(false);
    expect(droitsParDefaut().COMPTABILITE.PARAMETRER_PRODUITS).toBe("LECTURE");
  });
});
