// Tables à l'écran (B5, D59) : clés tirées des champs, grille attendue, cases au décimal, « Remplir avec 1 », collage d'une plage
// copiée d'un tableur, comptage « n / N », refus au-delà de 2 clés. Les tables sont jugées par `verifierBareme` (une seule vérité).
import { describe, expect, it } from "vitest";

import {
  analyserPlage,
  changerCles,
  clesAttendues,
  clesPossibles,
  collerPlage,
  comptageDeTable,
  creerTable,
  decimalDepuisSaisie,
  grilleDeTable,
  lecteursDeTable,
  lireCle,
  MESSAGE_CLES_MAX,
  poserCase,
  remplirCasesVides,
  renommerTable,
  supprimerTable,
  verifierBareme,
  type Bareme,
  type Resultat,
} from "./index";
import { baremeSecurpro } from "./securpro-fixture";

const ok = (r: Resultat): Bareme => {
  if (!r.ok) throw new Error(r.refus.join(" | "));
  return r.bareme;
};
const refus = (r: Resultat): string => {
  if (r.ok) throw new Error("refus attendu");
  return r.refus.join(" | ");
};
const problemesDeTables = (b: Bareme) => verifierBareme(b).filter((p) => ["TABLE_INCOMPLETE", "LIGNE_INCONNUE", "CLE_INVALIDE", "TARIF_ABSENT"].includes(p.code));

describe("clés tirées des champs", () => {
  const b = baremeSecurpro();
  it("une liste donne ses valeurs, un oui/non Oui et Non, un attribut ses valeurs distinctes", () => {
    expect(lireCle(b, "situation")!.valeurs.map((v) => v.v)).toEqual(["BOUTIQUE", "MARCHE"]);
    expect(lireCle(b, "gardien")!.valeurs).toEqual([
      { v: "OUI", l: "Oui" },
      { v: "NON", l: "Non" },
    ]);
    expect(lireCle(b, "type_commerce.classe")!.valeurs.map((v) => v.v)).toEqual(["1", "2", "3", "4"]);
    expect(lireCle(b, "type_commerce")!.valeurs[0]).toEqual({ v: "BUREAU", l: "Bureau" });
  });
  it("un montant, un champ inconnu ou un attribut absent ne sont pas des clés", () => {
    expect(lireCle(b, "stocks")).toBeNull();
    expect(lireCle(b, "inconnu")).toBeNull();
    expect(lireCle(b, "type_commerce.couleur")).toBeNull();
  });
  it("clesPossibles propose listes, oui/non et attributs complets, jamais un montant", () => {
    const specs = clesPossibles(b).map((c) => c.spec);
    expect(specs).toEqual(expect.arrayContaining(["type_commerce", "type_commerce.classe", "gardien", "situation"]));
    expect(specs).not.toContain("stocks");
  });
  it("la grille attendue est celle de verifierBareme : les cinq tables de SECURPRO sont complètes", () => {
    for (const t of b.tables) {
      const g = grilleDeTable(b, t)!;
      expect(clesAttendues(g).sort()).toEqual(Object.keys(t.lignes).sort());
      expect(comptageDeTable(b, t)).toMatchObject({ manquantes: [], inconnues: [] });
    }
    expect(problemesDeTables(b)).toEqual([]);
  });
});

describe("création, cases et comptage", () => {
  const base = baremeSecurpro();
  it("une table à une clé se crée vide : n / N cases, la clé absente est signalée, la publication serait bloquée", () => {
    const b = ok(creerTable(base, "coef_situation", ["situation"]));
    const t = b.tables.find((x) => x.code === "coef_situation")!;
    expect(comptageDeTable(b, t)).toEqual({ remplies: 0, total: 2, manquantes: ["BOUTIQUE", "MARCHE"], inconnues: [] });
    expect(problemesDeTables(b).map((p) => p.message)).toEqual(expect.arrayContaining(["Table « coef_situation » : la ligne « BOUTIQUE » manque."]));
  });
  it("une case se pose au décimal (virgule acceptée) et se vide ; un texte qui n'est pas un nombre est refusé", () => {
    let b = ok(creerTable(base, "coef_situation", ["situation"]));
    b = ok(poserCase(b, "coef_situation", "BOUTIQUE", "1,25"));
    expect(b.tables.find((t) => t.code === "coef_situation")!.lignes).toEqual({ BOUTIQUE: "1.25" });
    expect(refus(poserCase(b, "coef_situation", "MARCHE", "abc"))).toContain("écrivez un nombre positif");
    expect(refus(poserCase(b, "coef_situation", "MARCHE", "-3"))).toContain("écrivez un nombre positif");
    b = ok(poserCase(b, "coef_situation", "BOUTIQUE", ""));
    expect(b.tables.find((t) => t.code === "coef_situation")!.lignes).toEqual({});
  });
  it("une case hors grille est refusée", () => {
    const b = ok(creerTable(base, "coef_situation", ["situation"]));
    expect(refus(poserCase(b, "coef_situation", "PLAGE", "1"))).toContain("aucune valeur des champs lus");
  });
  it("« Remplir avec 1 » ne remplit que les cases vides, jamais une valeur saisie", () => {
    let b = ok(creerTable(base, "grille", ["gardien", "extincteurs"]));
    b = ok(poserCase(b, "grille", "OUI|OUI", "0,8"));
    b = ok(remplirCasesVides(b, "grille", "1"));
    expect(b.tables.find((t) => t.code === "grille")!.lignes).toEqual({ "OUI|OUI": "0.8", "OUI|NON": "1", "NON|OUI": "1", "NON|NON": "1" });
    expect(problemesDeTables(b)).toEqual([]);
  });
  it("les nombres collés ou tapés à la française deviennent des décimaux (espaces et insécables retirés)", () => {
    expect(decimalDepuisSaisie("1 234,5")).toBe("1234.5");
    expect(decimalDepuisSaisie("100 000 000")).toBe("100000000");
  });
});

describe("au-delà de 2 clés : refus clair", () => {
  const b = baremeSecurpro();
  it("la création de 3 clés est refusée avec le message prévu", () => {
    expect(refus(creerTable(b, "trois", ["gardien", "extincteurs", "situation"]))).toBe(MESSAGE_CLES_MAX);
    expect(MESSAGE_CLES_MAX).toContain("un ou deux champs au plus");
  });
  it("changer les clés vers 3 est refusé aussi ; deux fois la même clé, un montant, un code déjà pris également", () => {
    expect(refus(changerCles(b, "secu_incendie", ["gardien", "extincteurs", "situation"]))).toBe(MESSAGE_CLES_MAX);
    expect(refus(creerTable(b, "x", ["gardien", "gardien"]))).toContain("pas deux fois le même champ");
    expect(refus(creerTable(b, "x", ["stocks"]))).toContain("ne peut pas servir de clé");
    expect(refus(creerTable(b, "limites", ["gardien"]))).toContain("déjà utilisé");
    expect(refus(creerTable(b, "x", []))).toContain("Choisissez le champ");
  });
  it("changer les clés vide les cases dont la ligne n'existe plus et garde les autres", () => {
    const apres = ok(changerCles(b, "coef_vol_contenu", ["type_commerce", "gardien"]));
    const t = apres.tables.find((x) => x.code === "coef_vol_contenu")!;
    expect(t.lignes).toEqual({});
    expect(comptageDeTable(apres, t)!.total).toBe(12);
    const garde = ok(changerCles(b, "taux_incendie", ["type_commerce.classe"]));
    expect(garde.tables.find((x) => x.code === "taux_incendie")!.lignes).toEqual(b.tables.find((x) => x.code === "taux_incendie")!.lignes);
  });
});

describe("collage d'une plage copiée d'un tableur", () => {
  const depart = ok(creerTable(baremeSecurpro(), "grille", ["gardien", "extincteurs"]));
  const lignesDe = (b: Bareme) => b.tables.find((t) => t.code === "grille")!.lignes;

  it("analyserPlage lit des tabulations et des retours (fin de ligne Windows, ligne vide finale)", () => {
    expect(analyserPlage("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("sans en-têtes : la plage s'applique à partir de la première case, dans l'ordre", () => {
    const b = ok(collerPlage(depart, "grille", analyserPlage("0,80\t0,90\n0,90\t1")));
    expect(lignesDe(b)).toEqual({ "OUI|OUI": "0.80", "OUI|NON": "0.90", "NON|OUI": "0.90", "NON|NON": "1" });
    expect(problemesDeTables(b)).toEqual([]);
  });
  it("avec en-têtes : placée d'après les libellés, quel que soit l'ordre des lignes et des colonnes", () => {
    const b = ok(collerPlage(depart, "grille", analyserPlage("\tNon\tOui\nNon\t1\t0,9\nOui\t0,9\t0,8")));
    expect(lignesDe(b)).toEqual({ "NON|NON": "1", "NON|OUI": "0.9", "OUI|NON": "0.9", "OUI|OUI": "0.8" });
  });
  it("tout ou rien : une cellule illisible refuse la plage entière et la nomme, rien n'est collé", () => {
    const r = collerPlage(depart, "grille", analyserPlage("0,80\tx\n0,90\t1"));
    expect(refus(r)).toContain("rien n'a été collé");
    expect(refus(r)).toContain("« x » n'est pas un nombre positif");
    expect(lignesDe(depart)).toEqual({});
  });
  it("une plage trop grande est refusée en disant la taille attendue ; une plage vide aussi", () => {
    expect(refus(collerPlage(depart, "grille", analyserPlage("1\t2\t3\n4\t5\t6\n7\t8\t9")))).toContain("dépasse la grille");
    expect(refus(collerPlage(depart, "grille", analyserPlage("")))).toContain("Rien à coller");
  });
  it("un en-tête inconnu est nommé", () => {
    expect(refus(collerPlage(depart, "grille", analyserPlage("\tOui\tPeut-être\nOui\t1\t1\nNon\t1\t1")))).toContain("« Peut-être »");
  });
  it("une cellule vide ne modifie pas la case déjà remplie", () => {
    const b1 = ok(poserCase(depart, "grille", "OUI|OUI", "5"));
    const b2 = ok(collerPlage(b1, "grille", analyserPlage("\t2\n3\t4")));
    expect(lignesDe(b2)).toEqual({ "OUI|OUI": "5", "OUI|NON": "2", "NON|OUI": "3", "NON|NON": "4" });
  });
  it("une liste à une clé : une colonne de nombres dans l'ordre, ou deux colonnes (valeur, nombre) dans n'importe quel ordre, avec ou sans en-tête", () => {
    const liste = ok(creerTable(baremeSecurpro(), "coef", ["situation"]));
    const t = (b: Bareme) => b.tables.find((x) => x.code === "coef")!.lignes;
    expect(t(ok(collerPlage(liste, "coef", analyserPlage("1,5\n2"))))).toEqual({ BOUTIQUE: "1.5", MARCHE: "2" });
    expect(t(ok(collerPlage(liste, "coef", analyserPlage("MARCHE\t2\nBOUTIQUE\t1,5"))))).toEqual({ MARCHE: "2", BOUTIQUE: "1.5" });
    expect(t(ok(collerPlage(liste, "coef", analyserPlage("Situation\tCoefficient\nBOUTIQUE\t1,5\nMARCHE\t2"))))).toEqual({ BOUTIQUE: "1.5", MARCHE: "2" });
    expect(refus(collerPlage(liste, "coef", analyserPlage("a\tb\tc")))).toContain("une colonne de valeurs");
  });
});

describe("renommer et supprimer une table", () => {
  const b = baremeSecurpro();
  it("une table lue par un sous-jacent ou une assiette ne se supprime ni ne se renomme : on nomme ce qui la lit", () => {
    expect(lecteursDeTable(b, "limites")).toEqual([expect.stringContaining("« plafond »")]);
    expect(refus(supprimerTable(b, "limites"))).toContain("lue par le sous-jacent « plafond »");
    expect(refus(supprimerTable(b, "secu_incendie"))).toContain("sous-jacent « securite »");
    expect(refus(renommerTable(b, "limites", "limites_2"))).toContain("est lue par");
  });
  it("une table orpheline se supprime et se renomme", () => {
    const avec = ok(creerTable(b, "orpheline", ["situation"]));
    expect(ok(renommerTable(avec, "orpheline", "autre")).tables.some((t) => t.code === "autre")).toBe(true);
    expect(ok(supprimerTable(avec, "orpheline")).tables.some((t) => t.code === "orpheline")).toBe(false);
    expect(refus(renommerTable(avec, "orpheline", "Pas Valide"))).toContain("Code :");
    expect(refus(renommerTable(avec, "orpheline", "limites"))).toContain("déjà utilisé");
  });
});
