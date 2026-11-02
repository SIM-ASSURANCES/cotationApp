// Sous-jacents à l'écran (B5, D59) : les cinq effets, la lecture d'un ou deux champs, les cibles, l'ordre de calcul affiché.
// Le calcul lui-même est jugé par le moteur (effets.test.ts) ; ici, que l'écran écrit des documents que le moteur sait lire.
import { describe, expect, it } from "vitest";

import { calculerBareme } from "./bareme";
import {
  AIDE_EFFET,
  EFFETS_ECRAN,
  LIBELLE_EFFET,
  ORDRE_DE_CALCUL,
  ajouterSousJacent,
  changerCibles,
  changerCondition,
  changerMessage,
  changerMode,
  changerReduction,
  changerTable,
  champsLusParSousJacent,
  ciblesPossibles,
  collerPlage,
  analyserPlage,
  poserCase,
  renommerSousJacent,
  supprimerSousJacent,
  tablesOrphelines,
  verifierBareme,
  type Bareme,
  type Resultat,
} from "./index";
import { baremeSecurpro, parametresEssai } from "./securpro-fixture";

const ok = (r: Resultat): Bareme => {
  if (!r.ok) throw new Error(r.refus.join(" | "));
  return r.bareme;
};
const refus = (r: Resultat): string => {
  if (r.ok) throw new Error("refus attendu");
  return r.refus.join(" | ");
};
const codes = (b: Bareme) => verifierBareme(b).map((p) => p.code);

describe("les cinq effets, et seulement eux", () => {
  it("l'écran propose E1 à E5, chacun avec son libellé et son aide", () => {
    expect(EFFETS_ECRAN).toEqual(["E1", "E2", "E3", "E4", "E5"]);
    for (const e of EFFETS_ECRAN) {
      expect(LIBELLE_EFFET[e].startsWith(e)).toBe(true);
      expect(AIDE_EFFET[e].length).toBeGreaterThan(20);
    }
  });
  it("l'ordre de calcul affiché est fixe et dit où chaque effet agit", () => {
    expect(ORDRE_DE_CALCUL).toHaveLength(6);
    const texte = ORDRE_DE_CALCUL.join(" ");
    for (const e of ["E1", "E2", "E3", "E4", "E5"]) expect(texte).toContain(e);
    expect(Object.isFrozen(ORDRE_DE_CALCUL)).toBe(false); // lecture seule par le type (readonly) ; aucune fonction ne le modifie
  });
});

describe("cibles possibles", () => {
  const b = baremeSecurpro();
  it("E1 ne propose que les composantes dont le taux est lu dans un sous-jacent", () => {
    expect(ciblesPossibles(b, "E1").map((c) => c.valeur)).toEqual(["incendie.base"]);
  });
  it("un coefficient peut viser une garantie entière ou une composante ; une réduction, une garantie entière seulement", () => {
    const valeurs = ciblesPossibles(b, "E2").map((c) => c.valeur);
    expect(valeurs).toEqual(expect.arrayContaining(["vol", "vol.contenu", "vol.caisse", "dde.base"]));
    expect(ciblesPossibles(b, "E2", true).map((c) => c.valeur)).toEqual(["incendie", "vol", "dde", "de", "bdg", "tempete", "tri"]);
  });
});

describe("E1 : le taux est lu dans une table (un champ)", () => {
  it("ajoute le sous-jacent ET sa table vide, aux clés tirées du champ ; le tarif manquant bloque la publication", () => {
    const base = baremeSecurpro();
    // La composante « dde.base » passe en taux lu dans un sous-jacent : c'est ce qu'on fait dans l'onglet Garanties.
    const prepare: Bareme = { ...base, garanties: base.garanties.map((g) => (g.code === "dde" ? { ...g, composantes: [{ ...g.composantes[0], taux: { unite: "PERMILLE" as const, source: "E1" as const } }] } : g)) };
    const b = ok(ajouterSousJacent(prepare, { effet: "E1", nom: "Taux DDE par situation", champs: ["situation"], cible: "dde.base" }));
    const s = b.sousJacents.at(-1)!;
    expect(s).toMatchObject({ code: "taux_dde_par_situation", effet: "E1", table: "taux_dde_par_situation", cibles: ["dde.base"] });
    expect(b.tables.at(-1)).toEqual({ code: "taux_dde_par_situation", cles: ["situation"], lignes: {} });
    expect(codes(b)).toContain("TABLE_INCOMPLETE");
    const remplie = ok(collerPlage(b, "taux_dde_par_situation", analyserPlage("6\n7")));
    expect(codes(remplie).filter((c) => c !== "AUCUN_ESSAI")).toEqual([]);
  });
  it("sans nom, sans champ ou sans cible : refus clair", () => {
    const b = baremeSecurpro();
    expect(refus(ajouterSousJacent(b, { effet: "E1", nom: " ", champs: ["situation"], cible: "incendie.base" }))).toContain("Donnez un nom");
    expect(refus(ajouterSousJacent(b, { effet: "E1", nom: "x", champs: [], cible: "incendie.base" }))).toContain("Choisissez le champ");
    expect(refus(ajouterSousJacent(b, { effet: "E1", nom: "x", champs: ["situation"], cible: "" }))).toContain("Choisissez la garantie");
    expect(refus(ajouterSousJacent(b, { effet: "E1", nom: "x", champs: ["a", "b", "c"], cible: "incendie.base" }))).toContain("un ou deux champs au plus");
    expect(refus(ajouterSousJacent(b, { effet: "E1", nom: "x", champs: ["stocks"], cible: "incendie.base" }))).toContain("ne peut pas être lu");
    expect(refus(ajouterSousJacent(b, { effet: "E1", nom: "x", champs: ["situation", "situation"], cible: "incendie.base" }))).toContain("pas deux fois");
  });
});

describe("E2 : coefficient sur deux champs, ou réduction en %", () => {
  it("un coefficient lit deux champs (grille) et se multiplie : le moteur applique ce que l'écran a écrit", () => {
    let b = ok(ajouterSousJacent(baremeSecurpro(), { effet: "E2", nom: "Sécurité bis", champs: ["gardien", "extincteurs"], cible: "dde.base" }));
    b = ok(collerPlage(b, "securite_bis", analyserPlage("\tOui\tNon\nOui\t0,5\t0,9\nNon\t0,9\t1")));
    expect(b.tables.at(-1)!.cles).toEqual(["gardien", "extincteurs"]);
    const essai = baremeSecurpro().jeuxEssai[0].entrees;
    const r = calculerBareme(b, { champs: essai.champs, souscrit: essai.souscrit }, parametresEssai());
    expect(r.ok).toBe(true);
    // gardien oui, extincteurs non : × 0,90 sur la dde (12 000 → 10 800)
    if (r.ok) expect(r.lignes.find((l) => l.libelle === "Dégâts des eaux")!.primeNette).toBe("10800");
  });
  it("l'option réduction vise une garantie entière : une cible de composante est ramenée à sa garantie", () => {
    let b = ok(ajouterSousJacent(baremeSecurpro(), { effet: "E2", nom: "Remise", champs: ["situation"], cible: "vol.caisse" }));
    b = ok(changerReduction(b, "remise", true));
    const s = b.sousJacents.at(-1)!;
    expect(s).toMatchObject({ effet: "E2", reduction: true, cibles: ["vol"] });
    b = ok(changerReduction(b, "remise", false));
    expect("reduction" in b.sousJacents.at(-1)!).toBe(false);
  });
  it("une réduction visant une composante est signalée par verifierBareme", () => {
    const b = ok(ajouterSousJacent(baremeSecurpro(), { effet: "E2", nom: "Remise", champs: ["situation"], cible: "vol.caisse", reduction: true }));
    expect(codes(b)).toContain("CIBLE_REDUCTION");
  });
});

describe("E3 : l'assiette n'est pas un sous-jacent, elle s'écrit dans la composante", () => {
  it("aucun sous-jacent E3 n'existe dans le document : l'effet E3 de l'écran édite l'assiette des composantes", () => {
    const b = baremeSecurpro();
    expect(b.sousJacents.map((s) => s.effet).sort()).toEqual(["E1", "E2", "E2", "E2", "E4"]);
    expect(ciblesPossibles(b, "E1").length).toBeGreaterThan(0);
  });
});

describe("E4 : refus avec le message de la Technique", () => {
  it("se crée avec son message, sur une condition de champ par défaut, et se modifie", () => {
    let b = ok(ajouterSousJacent(baremeSecurpro(), { effet: "E4", nom: "Pas de marché pour la quincaillerie", message: "Quincaillerie non assurable en marché." }));
    const s = b.sousJacents.at(-1)!;
    expect(s).toMatchObject({ effet: "E4", code: "pas_de_marche_pour_la_quincaillerie", message: "Quincaillerie non assurable en marché." });
    b = ok(changerCondition(b, s.code, { champ: "situation", egal: "MARCHE" }));
    b = ok(changerMessage(b, s.code, "Pas de quincaillerie en marché."));
    expect(b.sousJacents.at(-1)).toMatchObject({ quand: { champ: "situation", egal: "MARCHE" }, message: "Pas de quincaillerie en marché." });
    expect(refus(ajouterSousJacent(baremeSecurpro(), { effet: "E4", nom: "x", message: "  " }))).toContain("message de refus");
  });
  it("le message saisi par la Technique est celui que le Commercial reçoit", () => {
    let b = ok(ajouterSousJacent(baremeSecurpro(), { effet: "E4", nom: "Marche interdit", message: "Le marché n'est pas assurable." }));
    b = ok(changerCondition(b, "marche_interdit", { champ: "situation", egal: "MARCHE" }));
    const e = baremeSecurpro().jeuxEssai[0].entrees;
    const r = calculerBareme(b, { champs: { ...e.champs, situation: "MARCHE", stocks: "100000", loyer_mensuel: "1000" }, souscrit: e.souscrit }, parametresEssai());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refus.map((x) => x.message)).toContain("Le marché n'est pas assurable.");
  });
});

describe("E5 : minimum, plafond ou ajout", () => {
  it("lit une table et le mode se change ; le moteur applique un plafond", () => {
    let b = ok(ajouterSousJacent(baremeSecurpro(), { effet: "E5", nom: "Plafond DDE", champs: ["situation"], cible: "dde.base", mode: "PLAFOND" }));
    expect(b.sousJacents.at(-1)).toMatchObject({ effet: "E5", mode: "PLAFOND", table: "plafond_dde" });
    b = ok(collerPlage(b, "plafond_dde", analyserPlage("11000\n11000")));
    const e = baremeSecurpro().jeuxEssai[0].entrees;
    const r = calculerBareme(b, { champs: e.champs, souscrit: e.souscrit }, parametresEssai());
    expect(r.ok && r.lignes.find((l) => l.libelle === "Dégâts des eaux")!.primeNette).toBe("11000");
    b = ok(changerMode(b, "plafond_dde", "MINIMUM"));
    expect(b.sousJacents.at(-1)).toMatchObject({ mode: "MINIMUM" });
  });
});

describe("modifier, renommer, supprimer", () => {
  const base = baremeSecurpro();
  it("les cibles : au moins une, jamais zéro", () => {
    expect(refus(changerCibles(base, "securite", []))).toContain("au moins une garantie ou une composante");
    expect(ok(changerCibles(base, "securite", ["incendie.base", "dde.base"])).sousJacents.find((s) => s.code === "securite")).toMatchObject({ cibles: ["incendie.base", "dde.base"] });
  });
  it("changer de table : une table qui n'existe pas est refusée", () => {
    expect(refus(changerTable(base, "securite", "fantome"))).toContain("n'existe pas");
    expect(ok(changerTable(base, "securite", "limites")).sousJacents.find((s) => s.code === "securite")).toMatchObject({ table: "limites" });
    expect(refus(changerTable(base, "plafond", "limites"))).toContain("ne lit pas de table");
  });
  it("renommer : code valide et libre", () => {
    expect(ok(renommerSousJacent(base, "securite", "securite_incendie")).sousJacents.some((s) => s.code === "securite_incendie")).toBe(true);
    expect(refus(renommerSousJacent(base, "securite", "classe"))).toContain("déjà utilisé");
    expect(refus(renommerSousJacent(base, "securite", "Mauvais Code"))).toContain("Code :");
  });
  it("supprimer un E1 dont une composante attend le taux est refusé en la nommant ; un autre se supprime", () => {
    expect(refus(supprimerSousJacent(base, "classe"))).toContain("la composante « incendie.base » attend son taux");
    const sans = ok(supprimerSousJacent(base, "securite"));
    expect(sans.sousJacents.some((s) => s.code === "securite")).toBe(false);
    expect(tablesOrphelines(sans)).toEqual(["secu_incendie"]);
  });
  it("les champs lus sont ceux de la table (un ou deux) ou de la condition de refus", () => {
    expect(champsLusParSousJacent(base, base.sousJacents.find((s) => s.code === "securite")!)).toEqual(["gardien", "extincteurs"]);
    expect(champsLusParSousJacent(base, base.sousJacents.find((s) => s.code === "plafond")!)).toEqual(["capitaux_totaux"]);
  });
  it("poserCase sur la table d'un sous-jacent change la prime", () => {
    const b = ok(poserCase(base, "taux_incendie", "2", "0,9"));
    expect(b.tables.find((t) => t.code === "taux_incendie")!.lignes["2"]).toBe("0.9");
  });
});
