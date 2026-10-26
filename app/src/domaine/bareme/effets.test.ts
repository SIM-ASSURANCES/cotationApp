import { describe, expect, it } from "vitest";

import { ajouterJours, aujourdhui } from "../calcul/dates";
import { calculerBareme, composerBareme, type ParametresBareme } from "./bareme";
import { lireBareme, type Bareme, type Saisie } from "./schema";
import { parametresEssai } from "./securpro-fixture";
import { verifierBareme } from "./verification";

/** Petit barème inventé : une garantie à une composante, 10 ‰ de `valeur`, sans accessoire. Chaque test en change une pièce. */
const base = (changements: Record<string, unknown> = {}) =>
  lireBareme({
    schema: 1,
    produit: { taxe: "IARD" },
    champs: [
      { code: "type", type: "LISTE", valeurs: [{ v: "A", classe: 1 }, { v: "B", classe: 2 }] },
      { code: "valeur", type: "MONTANT" },
      { code: "oui", type: "OUI_NON" },
    ],
    garanties: [{ code: "g", nom: "Garantie G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: "valeur", taux: { unite: "PERMILLE", fixe: "10" } }] }],
    ...changements,
  });
const saisie = (champs: Saisie["champs"] = {}, reste: Partial<Saisie> = {}): Saisie => ({ champs: { type: "A", valeur: "1000000", oui: true, ...champs }, souscrit: [], ...reste });
const net = (b: Bareme, s: Saisie = saisie(), p: ParametresBareme = parametresEssai()): string => {
  const r = calculerBareme(b, s, p);
  if (!r.ok) throw new Error(r.refus.map((x) => x.message).join(" | "));
  return r.detail[0].primeNette.toFixed();
};
const refus = (b: Bareme, s: Saisie = saisie(), p: ParametresBareme = parametresEssai()): string => {
  const r = calculerBareme(b, s, p);
  return r.ok ? "" : r.refus.map((x) => x.message).join(" | ");
};
const garantieE1 = [{ code: "g", nom: "Garantie G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: "valeur", taux: { unite: "PERMILLE", source: "E1" } }] }];
const tableType = { code: "taux", cles: ["type.classe"], lignes: { "1": "2", "2": "3" } };
const sj = (...s: unknown[]) => ({ sousJacents: s });

describe("E1 : le sous-jacent choisit le taux dans une table", () => {
  const e1 = base({ garanties: garantieE1, tables: [tableType], ...sj({ code: "classe", effet: "E1", table: "taux", cibles: ["g"] }) });
  it("la classe de la valeur choisie donne le taux", () => {
    expect(net(e1)).toBe("2000");
    expect(net(e1, saisie({ type: "B" }))).toBe("3000");
  });
  it("sans le sous-jacent, le taux manque : publication et calcul refusent", () => {
    const sans = base({ garanties: garantieE1, tables: [tableType] });
    expect(verifierBareme(sans).map((x) => x.code)).toContain("TAUX_SANS_SOURCE");
    expect(refus(sans)).toContain("sous-jacent E1");
  });
  it("A4 : une valeur absente de la table est un refus, jamais un 0", () => {
    const incomplete = base({ garanties: garantieE1, tables: [{ ...tableType, lignes: { "1": "2" } }], ...sj({ code: "classe", effet: "E1", table: "taux", cibles: ["g"] }) });
    expect(refus(incomplete, saisie({ type: "B" }))).toContain("La table « taux » n'a pas de ligne pour type : « 2 »");
    expect(verifierBareme(incomplete).map((x) => x.code)).toContain("TABLE_INCOMPLETE");
  });
});

describe("E2 : coefficient (table à une ou deux entrées) et réduction", () => {
  const tables = [{ code: "coef", cles: ["oui", "type"], lignes: { "OUI|A": "0.8", "OUI|B": "0.9", "NON|A": "1", "NON|B": "1.5" } }];
  const e2 = base({ tables, ...sj({ code: "coef", effet: "E2", table: "coef", cibles: ["g.base"] }) });
  it("table à deux entrées : la combinaison des deux champs choisit le coefficient", () => {
    expect(net(e2)).toBe("8000");
    expect(net(e2, saisie({ oui: false, type: "B" }))).toBe("15000");
  });
  it("sans le sous-jacent, la prime n'est pas modifiée", () => {
    expect(net(base())).toBe("10000");
  });
  it("deux sous-jacents ciblant la même garantie se multiplient, dans n'importe quel ordre", () => {
    const deux = [{ code: "c1", effet: "E2", table: "coef", cibles: ["g"] }, { code: "c2", effet: "E2", table: "k", cibles: ["g"] }];
    const t = [...tables, { code: "k", cles: ["oui"], lignes: { OUI: "0.5", NON: "1" } }];
    expect(net(base({ tables: t, sousJacents: deux }))).toBe("4000");
    expect(net(base({ tables: t, sousJacents: [...deux].reverse() }))).toBe("4000");
  });
  it("réduction commerciale : en % sur la prime de la garantie, après la somme des composantes", () => {
    const t = [{ code: "red", cles: ["oui"], lignes: { OUI: "10", NON: "0" } }];
    const red = base({ tables: t, ...sj({ code: "red", effet: "E2", table: "red", cibles: ["g"], reduction: true }) });
    expect(net(red)).toBe("9000");
    expect(net(red, saisie({ oui: false }))).toBe("10000");
  });
  it("une réduction de 100 % est refusée", () => {
    const t = [{ code: "red", cles: ["oui"], lignes: { OUI: "100", NON: "0" } }];
    expect(refus(base({ tables: t, ...sj({ code: "red", effet: "E2", table: "red", cibles: ["g"], reduction: true }) }))).toContain("annulerait la prime");
  });
});

describe("E3 : l'assiette (valeurs intermédiaires et opérations)", () => {
  it("une valeur intermédiaire nommée donne l'assiette", () => {
    const e3 = base({ intermediaires: [{ code: "double", op: ["FOIS", "valeur", { k: "2" }] }], garanties: [{ code: "g", nom: "G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: "double", taux: { unite: "PERMILLE", fixe: "10" } }] }] });
    expect(net(e3)).toBe("20000");
  });
  it("sans l'intermédiaire, la définition est refusée", () => {
    const sans = base({ garanties: [{ code: "g", nom: "G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: "double", taux: { unite: "PERMILLE", fixe: "10" } }] }] });
    expect(verifierBareme(sans).map((x) => x.code)).toContain("REFERENCE_INCONNUE");
  });
  it("pourcentage plafonné, somme et table comme assiette", () => {
    const g = (assiette: unknown) => [{ code: "g", nom: "G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette, taux: { unite: "POURCENT", fixe: "1" } }] }];
    expect(net(base({ garanties: g(["PCT_PLAFOND", "valeur", "15", "100000"]) }))).toBe("1000"); // 15 % = 150 000, plafonné à 100 000
    expect(net(base({ garanties: g(["PCT_PLAFOND", "valeur", "5", "100000"]) }))).toBe("500");
    expect(net(base({ garanties: g(["SOMME", "valeur", { k: "500" }]) }))).toBe("10005");
    expect(net(base({ tables: [{ code: "cap", cles: ["type"], lignes: { A: "300000", B: "400000" } }], garanties: g(["TABLE", "cap"]) }))).toBe("3000");
  });
  it("PREMIER saute un champ non applicable, et refuse si aucun n'est renseigné", () => {
    const champs = [
      { code: "occ", type: "LISTE", valeurs: ["LOC", "PROP"] },
      { code: "loyer", type: "MONTANT", si: { champ: "occ", egal: "LOC" } },
      { code: "bat", type: "MONTANT", si: { champ: "occ", egal: "PROP" } },
    ];
    const g = [{ code: "g", nom: "G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: ["PREMIER", ["FOIS", "loyer", { k: "120" }], "bat"], taux: { unite: "POURCENT", fixe: "1" } }] }];
    const b = base({ champs, garanties: g });
    expect(net(b, { champs: { occ: "LOC", loyer: "1000" }, souscrit: [] })).toBe("1200");
    expect(net(b, { champs: { occ: "PROP", bat: "5000" }, souscrit: [] })).toBe("50");
  });
  it("trois opérations imbriquées sont refusées : on nomme une valeur intermédiaire", () => {
    const g = [{ code: "g", nom: "G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: ["SOMME", ["FOIS", ["SOMME", "valeur", "valeur"], { k: "2" }], "valeur"], taux: { unite: "POURCENT", fixe: "1" } }] }];
    expect(verifierBareme(base({ garanties: g })).map((x) => x.code)).toContain("PROFONDEUR");
  });
});

describe("E4 : contrôle avec refus et message de la Technique", () => {
  const e4 = base({ ...sj({ code: "plafond", effet: "E4", quand: [">", "valeur", { k: "5000000" }], message: "Valeur trop élevée : risque non assurable." }) });
  it("sous la limite le calcul passe, au-dessus il est refusé avec le texte saisi", () => {
    expect(net(e4)).toBe("10000");
    expect(refus(e4, saisie({ valeur: "5000001" }))).toBe("Valeur trop élevée : risque non assurable.");
  });
  it("sans le contrôle, la même saisie passe", () => {
    expect(net(base(), saisie({ valeur: "5000001" }))).toBe("50000.01");
  });
  it("condition sur un champ (oui/non ou liste) et tous les échecs sont rassemblés", () => {
    const deux = base({ ...sj({ code: "a", effet: "E4", quand: { champ: "oui", egal: "OUI" }, message: "Refus A." }, { code: "b", effet: "E4", quand: ["<", "valeur", { k: "2000000" }], message: "Refus B." }) });
    expect(refus(deux)).toBe("Refus A. | Refus B.");
  });
});

describe("E5 : ajoute ou borne un montant", () => {
  const t = (v: string) => [{ code: "m", cles: ["type"], lignes: { A: v, B: v } }];
  it("minimum d'un sous-jacent : relève la prime de la composante", () => {
    expect(net(base({ tables: t("15000"), ...sj({ code: "m", effet: "E5", mode: "MINIMUM", table: "m", cibles: ["g.base"] }) }))).toBe("15000");
    expect(net(base({ tables: t("5000"), ...sj({ code: "m", effet: "E5", mode: "MINIMUM", table: "m", cibles: ["g.base"] }) }))).toBe("10000");
  });
  it("plafond : borne la prime de la composante", () => {
    expect(net(base({ tables: t("6000"), ...sj({ code: "m", effet: "E5", mode: "PLAFOND", table: "m", cibles: ["g"] }) }))).toBe("6000");
  });
  it("ajout : ajoute un montant à la prime de la composante", () => {
    expect(net(base({ tables: t("250"), ...sj({ code: "m", effet: "E5", mode: "AJOUT", table: "m", cibles: ["g"] }) }))).toBe("10250");
  });
});

describe("composantes (A6), souscription, par tête, accessoires", () => {
  const deux = [
    {
      code: "g",
      nom: "G",
      souscription: "OPTIONNELLE",
      composantes: [
        { code: "x", souscription: "OPTIONNELLE", assiette: "valeur", taux: { unite: "POURCENT", fixe: "1" } },
        { code: "y", souscription: "OPTIONNELLE", assiette: { k: "100000" }, taux: { unite: "POURCENT", fixe: "2" }, minimum: "3000" },
      ],
    },
  ];
  const b = base({ garanties: deux, produit: { taxe: "IARD", accessoires: { mode: "PAR_GARANTIE", montant: "500" } } });
  it("la prime est la somme des composantes souscrites, avec un seul accessoire", () => {
    const r = calculerBareme(b, saisie({}, { souscrit: ["g.x", "g.y"] }), parametresEssai());
    expect(r.ok && [r.detail[0].primeNette.toFixed(), r.detail[0].accessoires.toFixed(), r.lignes.length]).toEqual(["13000", "500", 1]);
  });
  it("une composante non souscrite n'a aucun effet ; le minimum propre à la composante s'applique", () => {
    expect(net(b, saisie({}, { souscrit: ["g.y"] }))).toBe("3000");
    expect(net(b, saisie({ valeur: "9999999" }, { souscrit: ["g.y"] }))).toBe("3000");
  });
  it("aucune composante souscrite : refus", () => {
    expect(refus(b, saisie({}, { souscrit: ["g"] }))).toContain("aucune composante n'est souscrite");
    expect(refus(b, saisie())).toBe("Aucune garantie n'est souscrite.");
  });
  it("une garantie « selon une condition » est souscrite quand la condition est vraie", () => {
    const c = base({ garanties: [{ ...base().garanties[0], souscription: "CONDITION", si: { champ: "oui", egal: "OUI" } }] });
    expect(net(c)).toBe("10000");
    expect(refus(c, saisie({ oui: false }))).toBe("Aucune garantie n'est souscrite.");
  });
  it("par tête : multiplie par l'effectif, et l'effectif est exigé", () => {
    const g = [{ code: "g", nom: "G", souscription: "OBLIGATOIRE", composantes: [{ code: "base", assiette: "valeur", taux: { unite: "PERMILLE", fixe: "10" }, parTete: true }] }];
    expect(net(base({ garanties: g }), saisie({}, { effectif: 3 }))).toBe("30000");
    expect(refus(base({ garanties: g }))).toContain("L'effectif est obligatoire");
  });
  it("accessoires : par garantie, par contrat (une fois), par tête, et remplacés par ceux de la garantie", () => {
    const deuxG = [base().garanties[0], { ...base().garanties[0], code: "h", nom: "H" }];
    const acc = (mode: string, extra: Record<string, unknown> = {}) => {
      const r = calculerBareme(base({ garanties: deuxG, produit: { taxe: "IARD", accessoires: { mode, montant: "100" } }, ...extra }), saisie({}, { effectif: 4 }), parametresEssai());
      return r.ok ? r.detail.map((d) => d.accessoires.toFixed()) : r.refus;
    };
    expect(acc("PAR_GARANTIE")).toEqual(["100", "100"]);
    expect(acc("PAR_CONTRAT")).toEqual(["100", "0"]);
    expect(acc("PAR_TETE")).toEqual(["400", "400"]);
    const remplace = [{ ...deuxG[0], accessoires: { mode: "PAR_GARANTIE", montant: "0" } }, deuxG[1]];
    const r = calculerBareme(base({ garanties: remplace, produit: { taxe: "IARD", accessoires: { mode: "PAR_GARANTIE", montant: "100" } } }), saisie(), parametresEssai());
    expect(r.ok && r.detail.map((d) => d.accessoires.toFixed())).toEqual(["0", "100"]);
  });
  it("la taxe d'une garantie remplace celle du produit", () => {
    const g = [{ ...base().garanties[0], taxe: "DECES" }];
    const r = calculerBareme(base({ garanties: g }), saisie(), parametresEssai());
    expect(r.ok && r.lignes[0].branche).toBe("DECES");
  });
});

describe("jamais de 0 silencieux", () => {
  it("champ obligatoire absent, valeur hors liste, borne, champ inconnu : refus qui nomment le champ", () => {
    expect(refus(base(), { champs: { type: "A" }, souscrit: [] })).toContain("Le champ « valeur » est obligatoire.");
    expect(refus(base(), saisie({ type: "Z" }))).toContain("« Z » n'est pas une valeur de la liste");
    expect(refus(base(), saisie({ inconnu: "1" }))).toContain("« inconnu » n'existe pas");
    const borne = base({ champs: [...base().champs.map((c) => (c.code === "valeur" ? { ...c, max: "100" } : c))] });
    expect(refus(borne)).toContain("au plus 100");
  });
  it("assiette nulle et prime nulle : refus", () => {
    expect(refus(base(), saisie({ valeur: "0" }))).toContain("l'assiette est nulle");
    const t = base({ garanties: [{ ...base().garanties[0], composantes: [{ code: "base", assiette: "valeur", taux: { unite: "PERMILLE", fixe: "0" } }] }] });
    expect(refus(t)).toContain("la prime calculée est nulle");
  });
  it("un champ facultatif vide lu par une assiette est un refus, pas un 0", () => {
    const b = base({ champs: base().champs.map((c) => (c.code === "valeur" ? { ...c, obligatoire: false } : c)) });
    expect(refus(b, { champs: { type: "A", oui: true }, souscrit: [] })).toContain("n'est pas renseigné");
  });
});

describe("prorata temporis du produit : jours inclus / 365, après la réduction, avant les accessoires", () => {
  const effet = ajouterJours(aujourdhui(), 1);
  const periode = (jours: number, actif = true) => parametresEssai({ prorata: { actif }, dateEffet: effet, dateEcheance: ajouterJours(effet, jours - 1) });
  const t = [{ code: "red", cles: ["oui"], lignes: { OUI: "10", NON: "0" } }];
  const b = base({ tables: t, produit: { taxe: "IARD", accessoires: { mode: "PAR_GARANTIE", montant: "500" } }, ...sj({ code: "red", effet: "E2", table: "red", cibles: ["g"], reduction: true }) });
  it("73 jours sur 365 : 10 000 × 0,90 (réduction) × 73 / 365 = 1 800 ; les accessoires ne sont pas proratisés", () => {
    const r = calculerBareme(b, saisie(), periode(73));
    expect(r.ok && [r.detail[0].primeNette.toFixed(), r.detail[0].accessoires.toFixed(), r.coefProrata.toFixed()]).toEqual(["1800", "500", "0.2"]);
  });
  it("prorata inactif : la prime est celle d'une année pleine, quelle que soit la période", () => {
    expect(net(b, saisie(), periode(73, false))).toBe("9000");
  });
  it("une période de plus de 365 jours ne dépasse jamais 1 (comme le moteur à la formule)", () => {
    expect(net(b, saisie(), periode(366))).toBe("9000");
    expect(net(b, saisie(), periode(365))).toBe("9000");
  });
  it("le prorata passe dans les montants : nette 1 800 + accessoires 500 + taxe (2 300 × 7,25 %) = 167", () => {
    const r = calculerBareme(b, saisie(), periode(73));
    if (!r.ok) throw new Error("refus");
    const m = composerBareme(r.lignes, periode(73));
    expect([m.totaux.arrondi.nette, m.totaux.arrondi.accessoires, m.totaux.arrondi.taxe, m.totaux.arrondi.ttc].map((x) => x.toFixed())).toEqual(["1800", "500", "167", "2467"]);
  });
});
