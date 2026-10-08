import { describe, expect, it } from "vitest";

import { ajouterMois, dateValide, ecartEnJours } from "./dates";
import { ErreurCalcul, analyserMontant, arrondir, formaterMontant, montant, normaliserMontantSaisi } from "./montant";
import { exigeDoubleValidation, valideurAutorise } from "./validation";

describe("arrondir (CDC §8.5)", () => {
  it.each([
    ["1234.5", 1, "PROCHE", "1235"],
    ["1234.49", 1, "PROCHE", "1234"],
    ["1234.01", 1, "SUPERIEUR", "1235"],
    ["1234.99", 1, "INFERIEUR", "1234"],
    ["1250", 100, "PROCHE", "1300"],
    ["1249.99", 100, "PROCHE", "1200"],
    ["1201", 100, "SUPERIEUR", "1300"],
    ["1999", 1000, "INFERIEUR", "1000"],
    ["12345", 10, "PROCHE", "12350"],
  ] as const)("%s à %i (%s) = %s", (valeur, precision, sens, attendu) => {
    expect(arrondir(montant(valeur), precision, sens).toString()).toBe(attendu);
  });
});

describe("analyseur unique des montants saisis (recette 2.3a)", () => {
  it.each([
    ["93581.33", "93581.33"],
    ["93581,33", "93581.33"],
    ["93 581,33", "93581.33"],
    ["93\u00A0581,33", "93581.33"], // espace insécable
    ["93\u202F581,33", "93581.33"], // espace fine insécable
    ["  1 234 567  ", "1234567"],
    ["0,5", "0.5"],
    ["15888000", "15888000"],
  ])("accepte « %s » → %s", (saisi, attendu) => {
    expect(analyserMontant(saisi)).toBe(attendu);
  });

  it.each([
    ["1.234,5", "point et virgule mélangés"],
    ["1,234.5", "point et virgule mélangés"],
    ["1,234,5", "un seul séparateur décimal"],
    ["1.234.567", "un seul séparateur décimal"],
    ["93 58 1", "groupes de trois chiffres"],
    ["12abc", "caractères non numériques"],
    ["", "aucun chiffre"],
    ["-5", "négatif"],
    ["1,", "partie décimale invalide"],
  ])("refuse « %s » avec un message en français", (saisi, extrait) => {
    expect(() => analyserMontant(saisi)).toThrow(ErreurCalcul);
    expect(() => analyserMontant(saisi)).toThrow(extrait);
  });

  it("un négatif n'est accepté que sur demande (montants internes, avoirs)", () => {
    expect(analyserMontant("-1 500,5", { negatif: true })).toBe("-1500.5");
  });

  it("normaliserMontantSaisi : écriture canonique, ou texte inchangé pour que la validation le refuse", () => {
    expect(normaliserMontantSaisi(" 93 581,33 ")).toBe("93581.33");
    expect(normaliserMontantSaisi("1.234,5")).toBe("1.234,5");
  });
});

describe("montant et affichage", () => {
  it("accepte la virgule décimale et les espaces, refuse le reste", () => {
    expect(montant("1 234,5").toString()).toBe("1234.5");
    expect(() => montant("abc")).toThrow(ErreurCalcul);
    expect(() => montant("1.2.3")).toThrow(ErreurCalcul);
    expect(() => montant("")).toThrow(ErreurCalcul);
  });

  it("n'a aucune erreur de flottant : 0,1 + 0,2 = 0,3", () => {
    expect(montant("0.1").plus(montant("0.2")).eq(montant("0.3"))).toBe(true);
  });

  it("formate avec espaces insécables, virgule et signe", () => {
    expect(formaterMontant(montant("11592000"))).toBe("11 592 000");
    expect(formaterMontant(montant("1809.495"), 3)).toBe("1 809,495");
    expect(formaterMontant(montant("-1500"))).toBe("-1 500");
    expect(formaterMontant(montant("999"))).toBe("999");
  });
});

describe("dates", () => {
  it("compte les jours et valide les dates réelles", () => {
    expect(ecartEnJours("2026-07-22", "2026-12-31")).toBe(162);
    expect(dateValide("2028-02-29")).toBe(true);
    expect(dateValide("2026-02-29")).toBe(false);
    expect(dateValide("22/07/2026")).toBe(false);
  });

  it("ajoute des mois en gardant le dernier jour du mois si besoin", () => {
    expect(ajouterMois("2026-01-31", 1)).toBe("2026-02-28");
    expect(ajouterMois("2028-01-31", 1)).toBe("2028-02-29");
    expect(ajouterMois("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("double validation (CDC §4.1)", () => {
  it("le seuil est dépassé strictement ; sans seuil, jamais de double validation", () => {
    expect(exigeDoubleValidation("5000001", "5000000")).toBe(true);
    expect(exigeDoubleValidation("5000000", "5000000")).toBe(false);
    expect(exigeDoubleValidation("999999999", null)).toBe(false);
  });

  it("le valideur ne peut pas être l'auteur", () => {
    expect(valideurAutorise(7, 7)).toBe(false);
    expect(valideurAutorise(7, 8)).toBe(true);
  });
});
