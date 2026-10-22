import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/serveur/requete", () => ({ adresseIpCourante: async () => "203.0.113.5" }));
vi.mock("@/serveur/session", () => ({ exigerUtilisateur: async () => ({ id: 1, identifiant: "test", nom: "Test", profil: "TECHNIQUE", libelleProfil: "Technique", doitChangerMotDePasse: false }) }));

import { MESSAGE_ERREUR_BASE_GENERIQUE } from "@/serveur/refus-base";
import { ErreurMetier } from "@/serveur/types";

import { avecMessage, executerAction } from "./executer";

// Forme réelle des erreurs de Prisma avec le pilote pg (voir serveur/refus-base.test.ts).
const erreurDeBase = (code: string, cause: object, nom = "PrismaClientKnownRequestError") => Object.assign(new Error("message de Prisma : table « clients », contrainte « clients_pkey »"), { name: nom, code, meta: { driverAdapterError: { cause } } });
const declencheur = erreurDeBase("P2003", { originalCode: "23001", originalMessage: "facture FAC-2026-10-0001 : annulée, aucune modification possible", kind: "RestrictViolation" });
const doublon = erreurDeBase("P2002", { originalCode: "23505", originalMessage: "la valeur d'une clé dupliquée rompt la contrainte unique « clients_pkey »", kind: "UniqueConstraintViolation", constraint: { index: "clients_pkey" }, table: "clients" });

let erreurs: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  erreurs.mockRestore();
});

describe("executerAction", () => {
  it("refus métier : son message", async () => {
    expect(await executerAction(async () => { throw new ErreurMetier("Motif obligatoire."); }, "ok", "/")).toEqual({ erreur: "Motif obligatoire." });
  });

  it("refus d'un de nos déclencheurs : son message, sans trace d'erreur", async () => {
    expect(await executerAction(async () => { throw declencheur; }, "ok", "/")).toEqual({ erreur: "facture FAC-2026-10-0001 : annulée, aucune modification possible" });
    expect(erreurs).not.toHaveBeenCalled();
  });

  it("autre erreur de base : message générique (rien de PostgreSQL ni de Prisma), erreur journalisée", async () => {
    const etat = await executerAction(async () => { throw doublon; }, "ok", "/");
    expect(etat).toEqual({ erreur: MESSAGE_ERREUR_BASE_GENERIQUE });
    expect(JSON.stringify(etat)).not.toMatch(/clients|pkey|Prisma/);
    expect(erreurs).toHaveBeenCalledWith("[erreur de base]", doublon);
  });

  it("erreur qui n'est pas de la base : remonte", async () => {
    await expect(executerAction(async () => { throw new Error("bogue"); }, "ok", "/")).rejects.toThrow("bogue");
  });

  it("succès", async () => {
    expect(await executerAction(async () => {}, "Fait.", "/")).toEqual({ succes: "Fait." });
  });
});

describe("avecMessage", () => {
  it("autre erreur de base : message générique", async () => {
    const r = await avecMessage(async () => { throw doublon; });
    expect(r).toEqual({ ok: false, etat: { erreur: MESSAGE_ERREUR_BASE_GENERIQUE } });
  });

  it("refus d'un de nos déclencheurs : son message", async () => {
    expect(await avecMessage(async () => { throw declencheur; })).toEqual({ ok: false, etat: { erreur: "facture FAC-2026-10-0001 : annulée, aucune modification possible" } });
  });

  it("erreur qui n'est pas de la base : remonte", async () => {
    await expect(avecMessage(async () => { throw new TypeError("bogue"); })).rejects.toThrow("bogue");
  });
});
