import { describe, expect, it } from "vitest";

import { MESSAGE_ERREUR_BASE_GENERIQUE, estErreurDeBase, messagePourErreurDeBase, refusDuDeclencheur } from "./refus-base";

// Formes réelles des erreurs de Prisma 7.10 avec @prisma/adapter-pg, relevées sur PostgreSQL (voir refus-base.integration.test.ts,
// qui les provoque pour de bon). Les messages sont ceux d'une base en français.
const erreurPrisma = (nom: string, code: string, cause: object) => Object.assign(new Error("message de Prisma, jamais montré"), { name: nom, code, meta: { driverAdapterError: { name: "DriverAdapterError", cause } } });
const connue = (code: string, cause: object) => erreurPrisma("PrismaClientKnownRequestError", code, cause);

const declencheurRestrict = connue("P2003", { originalCode: "23001", originalMessage: "facture FAC-2026-10-0001 : émise, elle ne se modifie plus (correction : avoir puis nouvelle facture)", kind: "RestrictViolation" });
const declencheurCheck = connue("P2010", { originalCode: "23514", originalMessage: "version de modèle publiée : aucune modification possible", kind: "postgres", code: "23514", severity: "ERREUR" });
const declencheurSansCode = connue("P2039", { originalCode: "P0001", originalMessage: "branche fiscale : suppression interdite, désactivez-la", kind: "postgres", code: "P0001" });

const cleEtrangereNative = connue("P2003", { originalCode: "23001", originalMessage: 'update or delete on table "profils" violates RESTRICT setting of foreign key constraint "utilisateurs_profil_id_fkey" on table "utilisateurs"', kind: "RestrictViolation", constraint: { index: "utilisateurs_profil_id_fkey" } });
const checkNatif = connue("P2010", { originalCode: "23514", originalMessage: "la nouvelle ligne de la relation « factures » viole la contrainte de vérification « factures_avenant_coherent »", kind: "postgres", code: "23514", detail: "La ligne en échec contient (113, AVENANT, 12 345 678)." });
const doublon = connue("P2002", { originalCode: "23505", originalMessage: "la valeur d'une clé dupliquée rompt la contrainte unique « profils_code_key »", kind: "UniqueConstraintViolation", constraint: { index: "profils_code_key" }, table: "profils" });
const tableAbsente = connue("P2010", { originalCode: "42P01", originalMessage: "la relation « table_inexistante » n'existe pas", kind: "TableDoesNotExist" });

describe("refusDuDeclencheur : seuls NOS déclencheurs", () => {
  it.each([
    ["restrict_violation (23001)", declencheurRestrict, "facture FAC-2026-10-0001 : émise, elle ne se modifie plus (correction : avoir puis nouvelle facture)"],
    ["check_violation (23514)", declencheurCheck, "version de modèle publiée : aucune modification possible"],
    ["RAISE EXCEPTION sans code (P0001)", declencheurSansCode, "branche fiscale : suppression interdite, désactivez-la"],
  ])("rend le message du déclencheur : %s", (_nom, erreur, attendu) => {
    expect(refusDuDeclencheur(erreur)).toBe(attendu);
  });

  it.each([
    ["clé étrangère ON DELETE RESTRICT native (même code 23001, mais avec sa contrainte)", cleEtrangereNative],
    ["contrainte CHECK native (même code 23514, mais avec sa ligne en échec)", checkNatif],
    ["doublon (23505)", doublon],
    ["table inexistante (42P01)", tableAbsente],
    ["erreur de Prisma sans détail du pilote", Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code: "P2025" })],
    ["erreur quelconque", new Error("autre")],
    ["null", null],
    ["message du déclencheur vide", connue("P2003", { originalCode: "23001", originalMessage: "  ", kind: "RestrictViolation" })],
  ])("n'est pas un déclencheur : %s", (_nom, erreur) => {
    expect(refusDuDeclencheur(erreur)).toBeNull();
  });
});

describe("messagePourErreurDeBase : déclencheur tel quel, toute autre erreur de base générique", () => {
  it("montre le message de nos déclencheurs", () => {
    expect(messagePourErreurDeBase(declencheurRestrict)).toMatch(/émise, elle ne se modifie plus/);
    expect(messagePourErreurDeBase(declencheurSansCode)).toMatch(/suppression interdite/);
  });

  it.each([
    ["clé étrangère native", cleEtrangereNative],
    ["contrainte CHECK native", checkNatif],
    ["doublon", doublon],
    ["table inexistante", tableAbsente],
    ["erreur de base quelconque (code inconnu)", connue("P2099", { originalCode: "XX000", originalMessage: "erreur interne du serveur sur la table « clients »", kind: "postgres" })],
    ["erreur inconnue du pilote", erreurPrisma("PrismaClientUnknownRequestError", "", {})],
    ["base injoignable", erreurPrisma("PrismaClientInitializationError", "P1001", {})],
  ])("message générique, sans aucun détail de la base : %s", (_nom, erreur) => {
    const message = messagePourErreurDeBase(erreur);
    expect(message).toBe(MESSAGE_ERREUR_BASE_GENERIQUE);
    for (const interdit of ["profils", "factures", "clients", "contrainte", "constraint", "113", "table"]) expect(message).not.toContain(interdit);
  });

  it("laisse remonter ce qui n'est pas une erreur de base (bogue, validation de requête, erreur réseau)", () => {
    expect(messagePourErreurDeBase(new Error("autre"))).toBeNull();
    expect(messagePourErreurDeBase(erreurPrisma("PrismaClientValidationError", "", {}))).toBeNull();
    expect(messagePourErreurDeBase("texte")).toBeNull();
    expect(estErreurDeBase(erreurPrisma("PrismaClientValidationError", "", {}))).toBe(false);
  });
});
