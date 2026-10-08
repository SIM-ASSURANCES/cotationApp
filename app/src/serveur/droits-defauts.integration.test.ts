// Droits par défaut ÉCRITS EN BASE par l'initialisation (npm run initialiser) = tableau du CDC §4.
// Le test unitaire droits-conformite-cdc.test.ts compare le code au CDC ; celui-ci compare ce que la base contient vraiment.
import { beforeAll, describe, expect, it } from "vitest";

import { ACTIONS, ACTIONS_HORS_CDC, PROFILS, droitsParDefaut, type CodeAction, type CodeProfil } from "@/domaine/droits";

import { matriceDuCdc } from "./droits-cdc-test";
import { initialiserProfilsEtDroits, lireMatrice } from "./droits";
import { obtenirPrisma } from "./prisma";

beforeAll(async () => {
  await initialiserProfilsEtDroits();
});

describe("droits par défaut en base = tableau du CDC §4", () => {
  it("chaque ligne de profils_droits correspond à la cellule du CDC (rien d'inventé, rien d'oublié)", async () => {
    const lignes = await obtenirPrisma().profilDroit.findMany({ include: { profil: { select: { code: true } } } });
    expect(lignes).toHaveLength(PROFILS.length * ACTIONS.length);

    const cdc = matriceDuCdc();
    const defauts = droitsParDefaut();
    for (const ligne of lignes) {
      const profil = ligne.profil.code as CodeProfil;
      const action = ligne.action as CodeAction;
      const attendu = ACTIONS_HORS_CDC.includes(action) ? defauts[profil][action] : cdc[profil][action];
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
