// Recette du domaine (B5) : SECURPRO inventé saisi ENTIÈREMENT par les opérations de l'éditeur, sans classeur ni fixture de document.
// Le barème obtenu passe le schéma et `verifierBareme` à la publication, ses essais (attendu tapé) retombent sur 139 420 F TTC, et son
// calcul est le même que celui de la fixture de référence pour la saisie du premier essai.
import { describe, expect, it } from "vitest";

import { calculerBareme } from "./bareme";
import { jsonCanonique } from "./canonique";
import { rejouerJeuxEssai } from "./essais";
import { schemaBareme, verifierBareme } from "./index";
import { secuproSaisiALEcran } from "./securpro-ecran";
import { baremeSecurpro, parametresEssai } from "./securpro-fixture";

const saisi = () => secuproSaisiALEcran({ taxe: "IARD", taxeIncendie: "INCENDIE" });

describe("SECURPRO saisi à l'écran", () => {
  it("passe le schéma et les contrôles de publication, sans aucun problème", () => {
    const b = saisi();
    expect(schemaBareme.safeParse(JSON.parse(jsonCanonique(b))).success).toBe(true);
    expect(verifierBareme(b, { publication: true })).toEqual([]);
  });

  it("ses trois essais, dont l'attendu est tapé, retombent sur leurs chiffres : 139 420 F TTC", () => {
    const b = saisi();
    expect(b.jeuxEssai.map((e) => e.nom)).toHaveLength(3);
    expect(b.jeuxEssai[0].attendu.ttc).toBe("139420");
    expect(rejouerJeuxEssai(b, parametresEssai())).toEqual([]);
  });

  it("donne, pour la saisie du premier essai, les mêmes lignes de prime que la fixture de référence", () => {
    const ecran = saisi();
    const reference = baremeSecurpro();
    const saisie = { champs: ecran.jeuxEssai[0].entrees.champs, souscrit: ecran.jeuxEssai[0].entrees.souscrit };
    const a = calculerBareme(ecran, saisie, parametresEssai());
    const b = calculerBareme(reference, saisie, parametresEssai());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.lignes).toEqual(b.lignes);
  });

  it("un attendu faux est attrapé, ligne à ligne (la dde attendue à 14 000 au lieu de 12 000)", () => {
    const faux = structuredClone(saisi());
    faux.jeuxEssai[0].attendu.lignes!.find((l) => l.g === "dde")!.nette = "14000";
    expect(rejouerJeuxEssai(faux, parametresEssai())).toEqual([{ essai: "Électronique, locataire, boutique", ligne: "dde", champ: "nette", attendu: "14000", obtenu: "12000" }]);
  });
});
