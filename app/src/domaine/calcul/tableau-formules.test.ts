// Page produit (B6b) : le tableau des formules n'est montré que là où des formules ont un sens.
import { describe, expect, it } from "vitest";

import { afficheTableauFormules } from "./parametrage";

describe("afficheTableauFormules", () => {
  const formule = { code: "SOLO" };

  it("version au barème : jamais de tableau, même si des formules d'avant la bascule subsistent", () => {
    expect(afficheTableauFormules({ modeTarification: "BAREME", formules: [] })).toBe(false);
    expect(afficheTableauFormules({ modeTarification: "BAREME", formules: [formule] })).toBe(false);
  });

  it("version par garanties : seulement s'il reste des formules (héritage)", () => {
    expect(afficheTableauFormules({ modeTarification: "GARANTIES", formules: [] })).toBe(false);
    expect(afficheTableauFormules({ modeTarification: "GARANTIES", formules: [formule] })).toBe(true);
  });

  it("version à la formule : toujours, même vide (« Aucune formule. » est une anomalie à voir)", () => {
    expect(afficheTableauFormules({ modeTarification: "FORMULE", formules: [] })).toBe(true);
    expect(afficheTableauFormules({ modeTarification: "FORMULE", formules: [formule] })).toBe(true);
  });
});
