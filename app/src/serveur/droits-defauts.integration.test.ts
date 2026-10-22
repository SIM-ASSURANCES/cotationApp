// Droits par défaut ÉCRITS EN BASE par l'initialisation (npm run initialiser) = tableau du CDC §4.
// Le test unitaire droits-conformite-cdc.test.ts compare le code au CDC ; celui-ci compare ce que la base contient vraiment.
// Le tableau attendu est écrit ici : le test ne lit pas docs/cdc.md à l'exécution (le dossier docs/ n'est pas dans l'image Docker).
import { beforeAll, describe, expect, it } from "vitest";

import { ACTIONS, ACTIONS_HORS_CDC, PROFILS, droitsParDefaut, type CodeAction, type CodeNiveau, type CodeProfil } from "@/domaine/droits";

import { initialiserProfilsEtDroits, lireMatrice } from "./droits";
import { obtenirPrisma } from "./prisma";

/**
 * Tableau du CDC §4, une ligne par action, colonnes dans l'ordre de PROFILS : Commercial, Gestionnaire production, Technique,
 * Comptabilité, Direction Générale, Admin système. Deux écarts consignés : « Taxes (proposition) » = LECTURE (D21) et la
 * Direction Générale valide contrats et factures (étape 3, fin de l'écart D21).
 */
const ATTENDU_CDC: Record<string, readonly CodeNiveau[]> = {
  CREER_COTATION: ["OUI", "OUI", "OUI", "AUCUN", "LECTURE", "AUCUN"],
  FORCER_PRIME: ["DEMANDE", "DEMANDE", "VALIDE", "AUCUN", "VALIDE", "AUCUN"],
  EMETTRE_CONTRAT: ["AUCUN", "OUI_SOUS_SEUIL", "OUI", "AUCUN", "VALIDE", "AUCUN"],
  EMETTRE_FACTURE: ["AUCUN", "OUI_SOUS_SEUIL", "OUI", "OUI", "VALIDE", "AUCUN"],
  EMETTRE_AVOIR: ["AUCUN", "AUCUN", "VALIDE", "OUI", "VALIDE", "AUCUN"],
  ENREGISTRER_PAIEMENT: ["AUCUN", "OUI", "AUCUN", "OUI", "AUCUN", "AUCUN"],
  DEPOSER_MODELE: ["AUCUN", "AUCUN", "OUI", "AUCUN", "AUCUN", "AUCUN"],
  PUBLIER_MODELE: ["AUCUN", "AUCUN", "AUCUN", "AUCUN", "OUI", "AUCUN"],
  PARAMETRER_PRODUITS: ["AUCUN", "AUCUN", "OUI", "LECTURE", "VALIDE", "AUCUN"],
  GERER_UTILISATEURS: ["AUCUN", "AUCUN", "AUCUN", "AUCUN", "AUCUN", "OUI"],
  CONSULTER_AUDIT: ["AUCUN", "AUCUN", "LECTURE", "AUCUN", "LECTURE", "LECTURE"],
};

beforeAll(async () => {
  await initialiserProfilsEtDroits();
});

describe("droits par défaut en base = tableau du CDC §4", () => {
  it("chaque ligne de profils_droits correspond à la cellule du CDC (rien d'inventé, rien d'oublié)", async () => {
    const lignes = await obtenirPrisma().profilDroit.findMany({ include: { profil: { select: { code: true } } } });
    expect(lignes).toHaveLength(PROFILS.length * ACTIONS.length);

    expect(Object.keys(ATTENDU_CDC)).toEqual(ACTIONS.map((a) => a.code).filter((code) => !ACTIONS_HORS_CDC.includes(code)));
    const defauts = droitsParDefaut();
    for (const ligne of lignes) {
      const profil = ligne.profil.code as CodeProfil;
      const action = ligne.action as CodeAction;
      const attendu = ACTIONS_HORS_CDC.includes(action) ? defauts[profil][action] : ATTENDU_CDC[action][PROFILS.findIndex((p) => p.code === profil)];
      expect(ligne.niveau, `${profil} / ${action}`).toBe(attendu);
    }
  });

  it("le Commercial peut créer une cotation (« Oui »), la Comptabilité ne fait que consulter le paramétrage", async () => {
    const matrice = await lireMatrice();
    expect(matrice.COMMERCIAL.CREER_COTATION).toBe("OUI");
    expect(matrice.COMPTABILITE.PARAMETRER_PRODUITS).toBe("LECTURE");
  });

  it("aucun droit stocké n'a la valeur « Proposition » (retirée, D21)", async () => {
    expect(await obtenirPrisma().profilDroit.count({ where: { niveau: "PROPOSITION" } })).toBe(0);
  });
});
