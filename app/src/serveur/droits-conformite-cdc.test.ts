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

  it("VALIDER_COTATION (D18) : réservé au profil Technique par défaut", () => {
    const m = droitsParDefaut();
    expect(PROFILS.map((p) => m[p.code].VALIDER_COTATION)).toEqual(["AUCUN", "AUCUN", "VALIDE", "AUCUN", "AUCUN", "AUCUN"]);
  });

  it("chaque cellule correspond à la matrice par défaut (une seule traduction retouchée : « Taxes (proposition) » = Lecture, D21)", () => {
    const matrice = droitsParDefaut();
    corps.forEach((ligne, i) => {
      PROFILS.forEach((profil, colonne) => {
        expect(matrice[profil.code][ACTIONS_DU_CDC[i]], `${ligne[0]} / ${entete[colonne + 1]}`).toBe(niveauDeLaCellule(ligne[colonne + 1]));
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
