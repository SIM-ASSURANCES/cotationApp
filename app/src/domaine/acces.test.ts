import { describe, expect, it } from "vitest";

import { cheminDeRetour, destinationSure, estRoutePublique } from "./acces";

describe("estRoutePublique", () => {
  it("laisse publics uniquement la connexion, la santé et la vérification de QR code", () => {
    for (const chemin of ["/connexion", "/api/sante", "/api/auth/session", "/api/auth/callback/credentials", "/verif/abc123", "/connexion/"]) {
      expect(estRoutePublique(chemin), chemin).toBe(true);
    }
  });

  it("protège tout le reste, y compris les chemins qui y ressemblent", () => {
    for (const chemin of ["/", "/admin/utilisateurs", "/api/documents", "/api/sante/details", "/api/authentification", "/verif", "/connexion-admin", "/api/auth"+"x"]) {
      expect(estRoutePublique(chemin), chemin).toBe(false);
    }
  });
});

describe("destinationSure", () => {
  it("n'accepte que des chemins internes", () => {
    expect(destinationSure("/admin/audit")).toBe("/admin/audit");
    expect(destinationSure("https://exemple.org")).toBe("/");
    expect(destinationSure("//exemple.org")).toBe("/");
    expect(destinationSure("/\\exemple.org")).toBe("/");
    expect(destinationSure(null)).toBe("/");
  });
});

describe("cheminDeRetour", () => {
  it("garde le chemin d'une URL complète et ignore son origine", () => {
    expect(cheminDeRetour("https://sim.exemple.ci/admin/audit?action=X")).toBe("/admin/audit?action=X");
    expect(cheminDeRetour("/admin/droits")).toBe("/admin/droits");
  });

  it("revient à l'accueil pour une valeur absente ou piégée", () => {
    expect(cheminDeRetour(undefined)).toBe("/");
    expect(cheminDeRetour("//exemple.org/x")).toBe("/x");
    expect(cheminDeRetour("javascript:alert(1)")).toBe("/");
  });
});
