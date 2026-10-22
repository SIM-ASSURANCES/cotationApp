// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration). Les erreurs ci-dessous sont provoquées pour de bon :
// le filtre de refus-base.ts doit montrer le message de NOS déclencheurs et rien de ce que PostgreSQL dit des autres erreurs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initialiserProfilsEtDroits } from "./droits";
import { obtenirPrisma } from "./prisma";
import { MESSAGE_ERREUR_BASE_GENERIQUE, messagePourErreurDeBase, refusDuDeclencheur } from "./refus-base";
import { creerAdministrateurInitial } from "./utilisateurs";

const erreurDe = (operation: () => Promise<unknown>) => operation().then(() => undefined, (e: unknown) => e);

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  await creerAdministrateurInitial({ identifiant: `refus-base-${Date.now()}`, nom: "Compte de test", motDePasse: "phrase-de-passe-inventee-2026" });
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("déclencheurs réels : message montré tel quel", () => {
  it("restrict_violation (23001) : le journal est en ajout seul", async () => {
    const erreur = await erreurDe(() => obtenirPrisma().$executeRawUnsafe("DELETE FROM journal_audit"));
    expect(erreur).toBeDefined();
    expect(messagePourErreurDeBase(erreur)).toBe("journal_audit est en ajout seul : DELETE interdit");
  });

  it("RAISE EXCEPTION sans code (P0001) : une branche fiscale ne se supprime pas", async () => {
    // SQL direct sur une branche de la migration : les autres fichiers de tests créent des branches en parallèle, et le « delete »
    // de Prisma relit la ligne avant de la supprimer (erreur « introuvable » possible si elle change entre-temps).
    const erreur = await erreurDe(() => obtenirPrisma().$executeRawUnsafe("DELETE FROM branches WHERE code = (SELECT code FROM branches ORDER BY code LIMIT 1)"));
    expect(messagePourErreurDeBase(erreur)).toBe("branche fiscale : suppression interdite, désactivez-la");
  });

  it("check_violation (23514) levée par une fonction PL/pgSQL, sans champ réservé aux erreurs natives", async () => {
    const erreur = await erreurDe(() => obtenirPrisma().$executeRawUnsafe(`DO $$ BEGIN RAISE EXCEPTION 'refus de test : état incohérent' USING ERRCODE = 'check_violation'; END $$`));
    expect(messagePourErreurDeBase(erreur)).toBe("refus de test : état incohérent");
  });
});

describe("autres erreurs de base : message générique, rien de PostgreSQL à l'écran", () => {
  const verifierGenerique = (erreur: unknown, texteDeLaBase: RegExp) => {
    expect(erreur, "une erreur était attendue").toBeDefined();
    expect(refusDuDeclencheur(erreur)).toBeNull();
    expect(messagePourErreurDeBase(erreur)).toBe(MESSAGE_ERREUR_BASE_GENERIQUE);
    // Le texte d'origine (tables, contraintes, ligne en échec) est bien dans l'erreur, donc il aurait fui sans le filtre.
    expect(JSON.stringify((erreur as { meta?: unknown }).meta)).toMatch(texteDeLaBase);
  };

  it("clé étrangère ON DELETE RESTRICT native (même code 23001 que nos déclencheurs)", async () => {
    const profil = await obtenirPrisma().profil.findFirstOrThrow({ where: { utilisateurs: { some: {} } } });
    verifierGenerique(await erreurDe(() => obtenirPrisma().profil.delete({ where: { id: profil.id } })), /utilisateurs_profil_id_fkey/);
  });

  it("contrainte CHECK native (même code 23514 que certains déclencheurs, avec la ligne en échec dans le détail)", async () => {
    const erreur = await erreurDe(() => obtenirPrisma().$executeRawUnsafe(`DO $$ BEGIN CREATE TEMP TABLE zz_test (n int CHECK (n > 0)) ON COMMIT DROP; INSERT INTO zz_test VALUES (-42); END $$`));
    verifierGenerique(erreur, /-42/);
  });

  it("doublon sur une clé unique", async () => {
    const profil = await obtenirPrisma().profil.findFirstOrThrow();
    verifierGenerique(await erreurDe(() => obtenirPrisma().profil.create({ data: { code: profil.code, libelle: "doublon" } })), /profils_code_key/);
  });

  it("requête invalide (table inexistante) et erreur de calcul de la base", async () => {
    verifierGenerique(await erreurDe(() => obtenirPrisma().$queryRawUnsafe("SELECT * FROM table_inexistante")), /table_inexistante/);
    expect(messagePourErreurDeBase(await erreurDe(() => obtenirPrisma().$queryRawUnsafe("SELECT 1 / 0")))).toBe(MESSAGE_ERREUR_BASE_GENERIQUE);
  });
});
