import { describe, expect, it } from "vitest";

import { calculerBareme, composerBareme } from "./bareme";
import { rejouerJeuxEssai } from "./essais";
import { baremeSecurpro, parametresEssai } from "./securpro-fixture";
import { verifierBareme } from "./verification";

describe("SECURPRO inventé (propositions-bareme.md §1)", () => {
  it("le document est valide et publiable", () => {
    expect(verifierBareme(baremeSecurpro(), { publication: true })).toEqual([]);
  });

  it("les trois jeux d'essai passent : 139 420 F, minimum de la caisse, refus E4", () => {
    expect(rejouerJeuxEssai(baremeSecurpro(), parametresEssai())).toEqual([]);
  });

  it("jeu d'essai 1 : lignes, montants garantis, accessoire unique du Vol (A6), total 139 420 F", () => {
    const b = baremeSecurpro();
    const e = b.jeuxEssai[0].entrees;
    const r = calculerBareme(b, { champs: e.champs, souscrit: e.souscrit }, parametresEssai());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lignes.map((l) => [l.libelle, l.branche, l.montantGaranti])).toEqual([
      ["Incendie", "INCENDIE", "26866500"],
      ["Vol", "IARD", "1529975"],
      ["Dégâts des eaux", "IARD", "2000000"],
      ["Dommages électriques", "IARD", "1000000"],
      ["Bris de glaces", "IARD", "500000"],
      ["Tous risques informatique", "IARD", "10000000"],
    ]);
    const volDetail = r.detail[1];
    expect(volDetail.composantes.map((c) => c.code)).toEqual(["contenu", "caisse"]);
    expect(volDetail.accessoires.toFixed()).toBe("2500");
    const m = composerBareme(r.lignes, parametresEssai());
    expect(m.totaux.arrondi.nette.toFixed()).toBe("113851");
    expect(m.totaux.arrondi.accessoires.toFixed()).toBe("15000");
    expect(m.totaux.arrondi.taxe.toFixed()).toBe("10569");
    expect(m.totaux.arrondi.ttc.toFixed()).toBe("139420");
  });

  it("un champ conditionnel non applicable n'est jamais lu : propriétaire → valeur du bâtiment", () => {
    const b = baremeSecurpro();
    const e = b.jeuxEssai[1].entrees;
    const r = calculerBareme(b, { champs: { ...e.champs, loyer_mensuel: "999999999" }, souscrit: e.souscrit }, parametresEssai());
    expect(r.ok && r.detail[0].composantes[0].assiette.toFixed()).toBe("21000000");
  });
});
