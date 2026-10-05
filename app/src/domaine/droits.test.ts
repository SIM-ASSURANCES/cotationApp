import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  PROFILS,
  droitsParDefaut,
  estCodeAction,
  modificationDroitInterdite,
  peutAgir,
  peutLire,
  peutValider,
} from "./droits";

describe("matrice par défaut (CDC §4)", () => {
  const matrice = droitsParDefaut();

  it("couvre chaque profil et chaque action", () => {
    for (const profil of PROFILS) {
      for (const action of ACTIONS) {
        expect(matrice[profil.code][action.code], `${profil.code} / ${action.code}`).toBeDefined();
      }
    }
  });

  it("seul l'Admin système gère les utilisateurs", () => {
    for (const profil of PROFILS) {
      expect(matrice[profil.code].GERER_UTILISATEURS).toBe(profil.code === "ADMIN_SYSTEME" ? "OUI" : "AUCUN");
    }
  });

  it("le valideur de forçage de prime est Technique ou Direction Générale, jamais le commercial", () => {
    expect(matrice.TECHNIQUE.FORCER_PRIME).toBe("VALIDE");
    expect(matrice.DIRECTION_GENERALE.FORCER_PRIME).toBe("VALIDE");
    expect(matrice.COMMERCIAL.FORCER_PRIME).toBe("DEMANDE");
  });

  it("la Technique dépose les modèles mais ne les publie pas (séparation auteur / valideur)", () => {
    expect(matrice.TECHNIQUE.DEPOSER_MODELE).toBe("OUI");
    expect(matrice.TECHNIQUE.PUBLIER_MODELE).toBe("AUCUN");
    expect(matrice.DIRECTION_GENERALE.PUBLIER_MODELE).toBe("OUI");
  });
});

describe("niveaux", () => {
  it("distingue lire, agir et valider", () => {
    expect(peutLire("AUCUN")).toBe(false);
    expect(peutLire("LECTURE")).toBe(true);
    expect(peutLire("DEMANDE")).toBe(true);
    expect(peutAgir("LECTURE")).toBe(false);
    expect(peutAgir("DEMANDE")).toBe(false);
    expect(peutAgir("OUI")).toBe(true);
    expect(peutAgir("OUI_SOUS_SEUIL")).toBe(true);
    expect(peutValider("OUI")).toBe(false);
    expect(peutValider("VALIDE")).toBe(true);
  });

  it("reconnaît les codes d'action valides uniquement", () => {
    expect(estCodeAction("CREER_COTATION")).toBe(true);
    expect(estCodeAction("n_importe_quoi")).toBe(false);
  });
});

describe("garde-fou contre le verrouillage de l'administration", () => {
  it("interdit de retirer à l'Admin système la gestion des utilisateurs", () => {
    expect(modificationDroitInterdite("ADMIN_SYSTEME", "GERER_UTILISATEURS", "AUCUN")).not.toBeNull();
    expect(modificationDroitInterdite("ADMIN_SYSTEME", "GERER_UTILISATEURS", "OUI")).toBeNull();
    expect(modificationDroitInterdite("COMMERCIAL", "GERER_UTILISATEURS", "OUI")).toBeNull();
  });
});
