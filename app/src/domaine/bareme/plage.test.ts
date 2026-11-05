// D64 : plage d'un champ montant borné (affichage, message, contrôle). Données inventées.
import { describe, expect, it } from "vitest";

import { champsHorsPlage, descripteurSaisie, type EtatSaisie } from "./formulaire";
import { horsPlage, libellePlage, messageHorsPlage } from "./plage";
import { calculerBareme } from "./bareme";
import { lireBareme } from "./schema";
import { parametresEssai } from "./securpro-fixture";

const espaces = (s: string) => s.replace(/[  ]/g, " ");

describe("D64 : libellé de la plage", () => {
  it("deux bornes : « de 0 à 10 000 000 F CFA » ; une seule : « au moins », « au plus »", () => {
    expect(espaces(libellePlage({ type: "MONTANT", min: "0", max: "10000000" })!)).toBe("de 0 à 10 000 000 F CFA");
    expect(espaces(libellePlage({ type: "MONTANT", min: "5000" })!)).toBe("au moins 5 000 F CFA");
    expect(espaces(libellePlage({ type: "MONTANT", max: "250000" })!)).toBe("au plus 250 000 F CFA");
  });
  it("un NOMBRE n'est pas un montant : pas de F CFA ; sans borne, pas de plage", () => {
    expect(libellePlage({ type: "NOMBRE", min: "1", max: "50" })).toBe("de 1 à 50");
    expect(libellePlage({ type: "MONTANT" })).toBeNull();
  });
  it("hors plage : en dessous, au-dessus, aux bornes (acceptées), saisie illisible (laissée au serveur)", () => {
    const c = { type: "MONTANT", min: "0", max: "10000000" };
    expect(horsPlage(c, "12 000 000")?.valeur).toBeDefined();
    expect(horsPlage(c, "-5")).toBeNull(); // négatif : refusé par l'analyseur, pas par la plage
    expect(horsPlage(c, "10000000")).toBeNull();
    expect(horsPlage(c, "0")).toBeNull();
    expect(horsPlage(c, "10000001")).not.toBeNull();
    expect(horsPlage(c, "abc")).toBeNull();
    expect(horsPlage({ type: "MONTANT", min: "1000" }, "999")).not.toBeNull();
  });
  it("le message nomme le champ, la valeur et la plage", () => {
    const m = espaces(messageHorsPlage("Valeur du bâtiment", "12 000 000", "de 0 à 10 000 000 F CFA"));
    expect(m).toBe("Le champ « Valeur du bâtiment » : 12 000 000 est hors de la plage autorisée (de 0 à 10 000 000 F CFA).");
  });
});

const bareme = () =>
  lireBareme({
    schema: 1,
    produit: { taxe: "IARD" },
    champs: [
      { code: "valeur", libelle: "Valeur du bâtiment", type: "MONTANT", min: "0", max: "10000000" },
      { code: "age", libelle: "Âge du bâtiment", type: "NOMBRE", min: "0", max: "100", obligatoire: false },
      { code: "cache", libelle: "Champ caché", type: "MONTANT", max: "10", si: { champ: "age", egal: "99" }, obligatoire: false },
    ],
    garanties: [{ code: "g", nom: "Garantie G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: "valeur", taux: { unite: "PERMILLE", fixe: "10" } }] }],
  });
const etat = (champs: Record<string, string[]>): EtatSaisie => ({ champs, souscrit: [] });

describe("D64 : le formulaire signale une saisie hors plage (le calcul automatique ne part pas)", () => {
  const d = descripteurSaisie(bareme());
  it("le descripteur porte les bornes ; une saisie dans la plage ne dit rien", () => {
    expect(d.champs[0]).toMatchObject({ min: "0", max: "10000000" });
    expect(champsHorsPlage(d, etat({ valeur: ["5 000 000"] }))).toEqual([]);
  });
  it("hors plage : un message par champ, qui nomme le champ et la plage", () => {
    const m = champsHorsPlage(d, etat({ valeur: ["12 000 000"], age: ["150"] })).map(espaces);
    expect(m).toEqual([
      "Le champ « Valeur du bâtiment » : 12 000 000 est hors de la plage autorisée (de 0 à 10 000 000 F CFA).",
      "Le champ « Âge du bâtiment » : 150 est hors de la plage autorisée (de 0 à 100).",
    ]);
  });
  it("un champ masqué (condition d'affichage fausse) n'est pas contrôlé ; un champ vide non plus", () => {
    expect(champsHorsPlage(d, etat({ valeur: [""], cache: ["500"] }))).toEqual([]);
  });
  it("le serveur refuse de même, avec le même texte", () => {
    const r = calculerBareme(bareme(), { champs: { valeur: "12000000" }, souscrit: [] }, parametresEssai());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(espaces(r.refus[0].message)).toBe("Le champ « Valeur du bâtiment » : 12 000 000 est hors de la plage autorisée (de 0 à 10 000 000 F CFA).");
    expect(calculerBareme(bareme(), { champs: { valeur: "10000000" }, souscrit: [] }, parametresEssai()).ok).toBe(true);
  });
});
