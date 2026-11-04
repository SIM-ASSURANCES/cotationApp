import { describe, expect, it } from "vitest";

import { analyserMontant } from "./montant";
import { afficherMontantSaisi, lireSaisieMontant, positionApresReformatage, significatifsAvant, SEPARATEUR_MILLIERS as NB } from "./saisie-montant";

const ENTIER = { decimales: false };
const DECIMAL = { decimales: true };

describe("lireSaisieMontant : séparateur de milliers à l'affichage, valeur sans séparateur à l'envoi", () => {
  it("groupe par trois chiffres pendant la frappe", () => {
    expect(lireSaisieMontant("1", ENTIER)).toMatchObject({ affiche: "1", brut: "1" });
    expect(lireSaisieMontant("1000", ENTIER)).toMatchObject({ affiche: `1${NB}000`, brut: "1000" });
    expect(lireSaisieMontant("1000000", ENTIER)).toMatchObject({ affiche: `1${NB}000${NB}000`, brut: "1000000" });
    expect(lireSaisieMontant("12345", ENTIER).affiche).toBe(`12${NB}345`);
  });

  it("accepte le collage depuis Excel : espace, insécable, fine insécable, saut de ligne final", () => {
    for (const colle of ["1 000 000", `1${NB}000${NB}000`, "1 000 000", "1000000", " 1 000 000\r\n", "1\t000\t000"]) {
      expect(lireSaisieMontant(colle, ENTIER)).toMatchObject({ affiche: `1${NB}000${NB}000`, brut: "1000000", reconnu: true });
    }
  });

  it("décimales : la virgule s'affiche, le point part au serveur (là où le champ en admet)", () => {
    expect(lireSaisieMontant("1000000,5", DECIMAL)).toMatchObject({ affiche: `1${NB}000${NB}000,5`, brut: "1000000.5" });
    expect(lireSaisieMontant("1 000 000,50", DECIMAL)).toMatchObject({ affiche: `1${NB}000${NB}000,50`, brut: "1000000.50" });
    expect(lireSaisieMontant("93581.33", DECIMAL)).toMatchObject({ affiche: `93${NB}581,33`, brut: "93581.33" });
    expect(lireSaisieMontant("0,0125", DECIMAL)).toMatchObject({ affiche: "0,0125", brut: "0.0125" });
  });

  it("garde la virgule tapée en dernier (« 12, » ne redevient pas « 12 »)", () => {
    expect(lireSaisieMontant("1234,", DECIMAL)).toMatchObject({ affiche: `1${NB}234,`, brut: "1234." });
    expect(lireSaisieMontant(",5", DECIMAL)).toMatchObject({ affiche: ",5", brut: ".5" });
  });

  it("les décimales ne sont pas groupées", () => {
    expect(lireSaisieMontant("1,23456", DECIMAL).affiche).toBe("1,23456");
  });

  it("un champ entier ne touche pas à un texte avec séparateur décimal : le serveur en jugera", () => {
    expect(lireSaisieMontant("1000,5", ENTIER)).toEqual({ affiche: "1000,5", brut: "1000,5", reconnu: false });
  });

  it("un texte non reconnu reste tel quel, à l'écran comme à l'envoi (aucune validation côté navigateur)", () => {
    expect(lireSaisieMontant("12 abc", DECIMAL)).toEqual({ affiche: "12 abc", brut: "12 abc", reconnu: false });
    expect(lireSaisieMontant("1.234,5", DECIMAL).reconnu).toBe(false);
    expect(lireSaisieMontant("1,2,3", DECIMAL).reconnu).toBe(false);
  });

  it("vide, signe et zéros", () => {
    expect(lireSaisieMontant("", ENTIER)).toEqual({ affiche: "", brut: "", reconnu: true });
    expect(lireSaisieMontant("-", DECIMAL)).toMatchObject({ affiche: "-", brut: "-" });
    expect(lireSaisieMontant("-1500", DECIMAL)).toMatchObject({ affiche: `-1${NB}500`, brut: "-1500" });
    expect(lireSaisieMontant("007", ENTIER).affiche).toBe("007");
  });

  it("l'écriture envoyée est toujours acceptée par l'analyseur du serveur, sans séparateur", () => {
    for (const saisie of ["1 000 000", "1000000", "1 000 000,5", "93 581,33", "0,5", "12"]) {
      const { brut } = lireSaisieMontant(saisie, DECIMAL);
      expect(brut).not.toMatch(/[\s  ]/);
      expect(() => analyserMontant(brut)).not.toThrow();
    }
  });

  it("idempotent : relire l'affichage redonne la même valeur", () => {
    for (const saisie of ["1000000", "1000000,5", "1234,", "-12 345,60"]) {
      const une = lireSaisieMontant(saisie, DECIMAL);
      expect(lireSaisieMontant(une.affiche, DECIMAL)).toEqual(une);
    }
  });
});

describe("curseur stable pendant la frappe", () => {
  /** Simule une frappe : `texte` est le contenu du champ APRÈS la frappe, le curseur est à `position`. */
  const apres = (texte: string, position: number) => {
    const { affiche } = lireSaisieMontant(texte, DECIMAL);
    return { affiche, curseur: positionApresReformatage(affiche, significatifsAvant(texte, position)) };
  };

  it("à la fin : le curseur reste à la fin, séparateur ajouté ou non", () => {
    expect(apres("1000", 4)).toEqual({ affiche: `1${NB}000`, curseur: 5 });
    expect(apres("100", 3)).toEqual({ affiche: "100", curseur: 3 });
  });

  it("au milieu : taper un chiffre ne rejette pas le curseur à la fin", () => {
    // « 1 000 » devient « 1 2000 » (un « 2 » tapé après le « 1 ») : le curseur est juste après le « 2 ».
    const frappe = `1${NB}2000`; // texte brut après frappe, curseur après le « 2 » (position 3)
    const r = apres(frappe, 3);
    expect(r.affiche).toBe(`12${NB}000`);
    expect(r.curseur).toBe(2); // juste après le « 2 », avant le séparateur
    expect(r.affiche.slice(0, r.curseur)).toBe("12");
  });

  it("un séparateur qui apparaît avant le curseur le décale d'un cran", () => {
    // « 999 » + un « 9 » tapé au début : « 9999 », curseur après le premier « 9 » → « 9 999 », curseur après le premier « 9 ».
    expect(apres("9999", 1)).toEqual({ affiche: `9${NB}999`, curseur: 1 });
    // Tapé après le deuxième « 9 » : le curseur passe le séparateur ajouté.
    const r = apres("9999", 2);
    expect(r.affiche.slice(0, r.curseur).replace(NB, "")).toBe("99");
    expect(r.curseur).toBe(3);
  });

  it("suppression d'un chiffre au milieu : curseur à la même place logique", () => {
    // « 1 234 567 » : on efface le « 4 » (curseur après le « 3 »), texte « 1 23 567 ».
    const r = apres(`1${NB}23${NB}567`, 4);
    expect(r.affiche).toBe(`123${NB}567`);
    expect(r.affiche.slice(0, r.curseur).replace(NB, "")).toBe("123");
  });

  it("curseur au tout début, ou texte vide", () => {
    expect(positionApresReformatage("1 000", 0)).toBe(0);
    expect(positionApresReformatage("", 0)).toBe(0);
    expect(positionApresReformatage("12", 9)).toBe(2);
  });

  it("collage au milieu d'un champ : le curseur suit la fin du texte collé", () => {
    // champ « 5 » ; on colle « 1 000 000 » avant le « 5 » : contenu « 1 000 0005 », curseur après le collage.
    const contenu = `1 000 000${"5"}`;
    const curseurApresColle = "1 000 000".length;
    const r = apres(contenu, curseurApresColle);
    expect(r.affiche).toBe(`10${NB}000${NB}005`);
    expect(r.affiche.slice(0, r.curseur).replace(new RegExp(NB, "g"), "")).toBe("1000000");
  });
});

describe("afficherMontantSaisi : valeur initiale", () => {
  it("met en forme une valeur enregistrée, sous toutes ses écritures", () => {
    expect(afficherMontantSaisi("1000000", ENTIER)).toBe(`1${NB}000${NB}000`);
    expect(afficherMontantSaisi(`1${NB}000${NB}000`, ENTIER)).toBe(`1${NB}000${NB}000`);
    expect(afficherMontantSaisi("93581.33", DECIMAL)).toBe(`93${NB}581,33`);
    expect(afficherMontantSaisi(4500, ENTIER)).toBe(`4${NB}500`);
  });

  it("vide, absent : champ vide", () => {
    expect(afficherMontantSaisi("", ENTIER)).toBe("");
    expect(afficherMontantSaisi(undefined, ENTIER)).toBe("");
    expect(afficherMontantSaisi(null, DECIMAL)).toBe("");
  });
});
