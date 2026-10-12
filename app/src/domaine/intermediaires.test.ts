// Session 6.0 : intermédiaires (CDC §10.1, H71 fermée). Données inventées.
import { describe, expect, it } from "vitest";

import { normaliserChoixIntermediaires, problemesChoixIntermediaires, problemesIntermediaire } from "./intermediaires";

describe("référentiel des intermédiaires", () => {
  it("code en majuscules, nom et rôle obligatoires", () => {
    expect(problemesIntermediaire({ code: "BENI-01", nom: "COURTIER INVENTÉ", role: "Apporteur" })).toEqual([]);
    expect(problemesIntermediaire({ code: "beni", nom: "X", role: "Apporteur" })[0]).toMatch(/Code d'intermédiaire invalide/);
    expect(problemesIntermediaire({ code: "B", nom: " ", role: " " })).toEqual([
      "Le nom de l'intermédiaire est obligatoire.",
      "Le rôle de l'intermédiaire est obligatoire (ex. Apporteur, Gestionnaire).",
    ]);
  });
});

describe("choix sur une cotation : 0 à 2, sans doublon", () => {
  it("normalise les codes et garde l'ordre de la saisie", () => {
    expect(normaliserChoixIntermediaires([" beni-01 ", "", "AGT"])).toEqual(["BENI-01", "AGT"]);
  });

  it("refuse plus de deux intermédiaires et un doublon", () => {
    expect(problemesChoixIntermediaires([])).toEqual([]);
    expect(problemesChoixIntermediaires(["A", "B"])).toEqual([]);
    expect(problemesChoixIntermediaires(["A", "B", "C"])).toEqual(["Au plus 2 intermédiaires par cotation."]);
    expect(problemesChoixIntermediaires(["A", "A"])).toEqual(["Le même intermédiaire est choisi deux fois."]);
  });
});
