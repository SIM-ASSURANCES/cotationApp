import { describe, expect, it } from "vitest";

import { ADRESSE_MOT_DE_PASSE_MODIFIE, cheminDeRetour, destinationSure, estRoutePublique, messageDeConnexion, MESSAGE_MOT_DE_PASSE_MODIFIE } from "./acces";

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

describe("retour sur la page de connexion après un changement de mot de passe", () => {
  it("l'adresse de retour est publique et ne porte qu'une valeur fixe", () => {
    expect(ADRESSE_MOT_DE_PASSE_MODIFIE).toBe("/connexion?motdepasse=modifie");
    expect(estRoutePublique(new URL(ADRESSE_MOT_DE_PASSE_MODIFIE, "http://x").pathname)).toBe(true);
  });

  it("un seul message possible : celui de la consigne ; toute autre valeur (texte venu de l'adresse compris) n'affiche rien", () => {
    expect(messageDeConnexion("modifie")).toBe("Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.");
    expect(messageDeConnexion("modifie")).toBe(MESSAGE_MOT_DE_PASSE_MODIFIE);
    for (const autre of [undefined, "", "MODIFIE", "oui", "<b>Compte piraté</b>", ["modifie", "x"]]) expect(messageDeConnexion(autre)).toBeNull();
  });
});
