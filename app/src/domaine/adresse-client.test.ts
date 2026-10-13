import { describe, expect, it } from "vitest";

import { adresseDuClient, PROXIES_DE_CONFIANCE_PAR_DEFAUT, proxiesDeConfiance, proxiesDeConfianceValide } from "./adresse-client";

describe("adresse du client derrière un proxy (audit M1)", () => {
  it("un proxy de confiance : l'adresse AJOUTÉE par le proxy, pas celle que le client a écrite", () => {
    // Le client envoie « X-Forwarded-For: 6.6.6.6 » ; le proxy y ajoute l'adresse réelle, 203.0.113.7.
    expect(adresseDuClient("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(adresseDuClient("1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7", 1)).toBe("203.0.113.7");
    // Requête normale : le proxy a écrit une seule adresse.
    expect(adresseDuClient("203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("deux proxys de confiance (CDN puis proxy) : le deuxième en partant de la droite", () => {
    expect(adresseDuClient("6.6.6.6, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
  });

  it("l'adresse forgée change à chaque requête : la clé de limitation, elle, ne bouge pas", () => {
    const cles = new Set(Array.from({ length: 35 }, (_, i) => adresseDuClient(`10.0.${i}.1, 203.0.113.7`, 1)));
    expect([...cles]).toEqual(["203.0.113.7"]);
  });

  it("zéro proxy de confiance : l'en-tête n'est pas lu", () => {
    expect(adresseDuClient("203.0.113.7", 0)).toBeNull();
  });

  it("en-tête absent, vide ou fait de virgules : inconnue ; liste plus courte que prévu : l'élément le plus à gauche", () => {
    expect(adresseDuClient(null, 1)).toBeNull();
    expect(adresseDuClient("", 1)).toBeNull();
    expect(adresseDuClient(" , ,", 1)).toBeNull();
    expect(adresseDuClient("203.0.113.7", 2)).toBe("203.0.113.7");
  });

  it("l'adresse est tronquée à 64 caractères (elle va dans le journal)", () => {
    expect(adresseDuClient("a".repeat(200), 1)).toHaveLength(64);
  });

  it("PROXIES_DE_CONFIANCE : entier de 0 à 5, sinon 1", () => {
    expect(proxiesDeConfiance(undefined)).toBe(PROXIES_DE_CONFIANCE_PAR_DEFAUT);
    expect(proxiesDeConfiance("")).toBe(1);
    expect(proxiesDeConfiance("0")).toBe(0);
    expect(proxiesDeConfiance(" 2 ")).toBe(2);
    for (const mauvais of ["6", "-1", "1.5", "deux", "NaN"]) expect(proxiesDeConfiance(mauvais)).toBe(1);
    expect(proxiesDeConfianceValide("2")).toBe(true);
    expect(proxiesDeConfianceValide("6")).toBe(false);
    expect(proxiesDeConfianceValide("deux")).toBe(false);
  });
});
