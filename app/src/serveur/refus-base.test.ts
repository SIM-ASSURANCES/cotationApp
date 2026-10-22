import { describe, expect, it } from "vitest";

import { refusDuDeclencheur } from "./refus-base";

// Forme réelle de l'erreur de Prisma 7.10 avec @prisma/adapter-pg quand un déclencheur lève restrict_violation (relevée en intégration).
const erreurPrisma = (cause: object, code = "P2003") => Object.assign(new Error("Foreign key constraint violated on the (not available)"), { code, meta: { modelName: "Facture", driverAdapterError: { name: "DriverAdapterError", cause } } });

describe("refusDuDeclencheur", () => {
  it("rend le message du déclencheur caché derrière « Foreign key constraint violated »", () => {
    const e = erreurPrisma({ originalCode: "23001", originalMessage: "facture FAC-2026-10-0001 : émise, elle ne se modifie plus (correction : avoir puis nouvelle facture)", kind: "RestrictViolation" });
    expect(refusDuDeclencheur(e)).toBe("facture FAC-2026-10-0001 : émise, elle ne se modifie plus (correction : avoir puis nouvelle facture)");
  });

  it("ignore une vraie violation de clé étrangère (23503), une autre erreur Prisma et ce qui n'est pas une erreur de base", () => {
    expect(refusDuDeclencheur(erreurPrisma({ originalCode: "23503", originalMessage: "insert or update on table violates foreign key", kind: "ForeignKeyConstraintViolation" }))).toBeNull();
    expect(refusDuDeclencheur(erreurPrisma({ originalCode: "23001", originalMessage: "x", kind: "RestrictViolation" }, "P2002"))).toBeNull();
    expect(refusDuDeclencheur(new Error("autre"))).toBeNull();
    expect(refusDuDeclencheur(null)).toBeNull();
    expect(refusDuDeclencheur(erreurPrisma({ originalCode: "23001", kind: "RestrictViolation" }))).toBeNull();
  });
});
