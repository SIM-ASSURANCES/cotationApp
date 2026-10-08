import { describe, expect, it } from "vitest";

import { calculer, joursCouverts, type EntreeCalcul, type ParametresCalcul, type RegleArrondi } from "./calcul";
import { genererEcheancier } from "./echeancier";
import { ErreurCalcul, formaterMontant, montant } from "./montant";

// Règle « au franc près », arrondi au plus proche, ligne par ligne, écart absorbé par la taxe.
const AU_FRANC: RegleArrondi = { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" };

const parametres = (surcharge: Partial<ParametresCalcul> = {}): ParametresCalcul => ({
  prorata: { actif: true, primeMinimale: null },
  arrondi: AU_FRANC,
  taxe: { tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES" },
  ...surcharge,
});

// Règles en vigueur (version 2 du moteur, D18) : tous les cas ci-dessous les utilisent.
const V2 = { moteur: 2 } as const;
const AN_2026 = { ...V2, dateEffet: "2026-01-01", dateEcheance: "2026-12-31" } as const;

/** Chiffre sous forme de texte, pour comparer avec les chiffres du CDC. */
const texte = (m: { toString(): string }) => m.toString();

describe("T1 : cotation santé BENI, 2 formules (CDC §16.1)", () => {
  // Solo : 3 × 93 581,33, accessoires 3 000. Famille : 60 × 252 657,63, accessoires 210 000.
  const entree: EntreeCalcul = {
    ...AN_2026,
    parametres: parametres(),
    lignes: [
      { code: "SOLO", primeUnitaire: "93581.33", effectif: 3, accessoire: { mode: "FIXE", valeur: "3000" } },
      { code: "FAMILLE", primeUnitaire: "252657.63", effectif: 60, accessoire: { mode: "FIXE", valeur: "210000" } },
    ],
  };
  const resultat = calculer(entree);
  const [solo, famille] = resultat.lignes;

  it("Solo : HT 280 744 ; taxe 4 256 ; TTC 288 000", () => {
    expect(texte(solo.arrondi.nette)).toBe("280744");
    expect(texte(solo.arrondi.accessoires)).toBe("3000");
    expect(texte(solo.arrondi.taxe)).toBe("4256");
    expect(texte(solo.arrondi.ttc)).toBe("288000");
  });

  it("Famille : HT 15 159 458 ; taxe 230 542 ; TTC 15 600 000", () => {
    expect(texte(famille.arrondi.nette)).toBe("15159458");
    expect(texte(famille.arrondi.accessoires)).toBe("210000");
    expect(texte(famille.arrondi.taxe)).toBe("230542");
    expect(texte(famille.arrondi.ttc)).toBe("15600000");
  });

  it("total 15 888 000, somme exacte de ses composantes", () => {
    expect(texte(resultat.totaux.arrondi.ttc)).toBe("15888000");
    expect(texte(resultat.totaux.arrondi.nette)).toBe("15440202");
    expect(texte(resultat.totaux.arrondi.accessoires)).toBe("213000");
    expect(texte(resultat.totaux.arrondi.taxe)).toBe("234798");
  });

  it("TTC par personne 96 000 ; par famille 260 000", () => {
    expect(texte(solo.ttcParUnite)).toBe("96000");
    expect(texte(famille.ttcParUnite)).toBe("260000");
  });

  it("les montants avant arrondi sont exacts (aucune erreur de flottant)", () => {
    expect(texte(solo.exact.nette)).toBe("280743.99");
    expect(texte(solo.exact.taxe)).toBe("4256.15985");
    expect(texte(famille.exact.nette)).toBe("15159457.8");
    expect(texte(famille.exact.taxe)).toBe("230541.867");
  });

  it("donne le même total en n'arrondissant qu'à la fin (niveau TOTAL)", () => {
    const enTotal = calculer({ ...entree, parametres: parametres({ arrondi: { ...AU_FRANC, niveau: "TOTAL" } }) });

    expect(texte(enTotal.totaux.arrondi.ttc)).toBe("15888000");
    expect(texte(enTotal.totaux.arrondi.taxe)).toBe("234798");
  });

  it("s'affiche avec des espaces insécables", () => {
    expect(formaterMontant(resultat.totaux.arrondi.ttc)).toBe("15 888 000");
  });
});

describe("T3 : facture individuelle YAO, prorata (CDC §16.1, §8.2, §8.3)", () => {
  it("163 jours entre le 22/07/2026 et le 31/12/2026, bornes incluses", () => {
    expect(joursCouverts("2026-07-22", "2026-12-31")).toBe(163);
  });

  it("le coefficient de prorata vaut 163/365 (0,44658)", () => {
    const r = calculer({
      ...V2,
      dateEffet: "2026-07-22",
      dateEcheance: "2026-12-31",
      parametres: parametres(),
      lignes: [{ code: "F", primeUnitaire: "100000", effectif: 1, accessoire: { mode: "AUCUN", valeur: "0" } }],
    });

    expect(r.joursCouverts).toBe(163);
    expect(r.coefProrata.toDecimalPlaces(5).toString()).toBe("0.44658");
    expect(r.coefProrata.eq(montant("163").div(365))).toBe(true);
  });

  it("taxe de 1,5 % sur 120 633 F : 1 809,495 exactement, soit 1 809,50 à deux décimales ; jamais 2 292", () => {
    const r = calculer({
      ...V2,
      dateEffet: "2026-07-22",
      dateEcheance: "2026-12-31",
      parametres: parametres({ prorata: { actif: false, primeMinimale: null } }),
      lignes: [{ code: "F", primeUnitaire: "120633", effectif: 1, accessoire: { mode: "AUCUN", valeur: "0" } }],
    });
    const taxe = r.lignes[0].exact.taxe;

    expect(texte(taxe)).toBe("1809.495");
    expect(taxe.toDecimalPlaces(2).toString()).toBe("1809.5"); // 1 809,50
    expect(texte(r.lignes[0].arrondi.taxe)).toBe("1809"); // au franc
    expect(taxe.eq(2292)).toBe(false);
  });

  it("de bout en bout : prime annuelle proratisée sur 163 jours qui donne une prime nette de 120 633", () => {
    // Prime annuelle choisie pour que la prime nette proratisée vaille exactement 120 633.
    const primeAnnuelle = montant("120633").mul(365).div(163).toString();
    const r = calculer({
      ...V2,
      dateEffet: "2026-07-22",
      dateEcheance: "2026-12-31",
      parametres: parametres(),
      lignes: [{ code: "F", primeUnitaire: primeAnnuelle, effectif: 1, accessoire: { mode: "AUCUN", valeur: "0" } }],
    });
    const l = r.lignes[0];

    expect(r.joursCouverts).toBe(163);
    expect(texte(l.arrondi.nette)).toBe("120633");
    expect(l.exact.taxe.toDecimalPlaces(10).toString()).toBe("1809.495");
    expect(texte(l.arrondi.ttc)).toBe("122442"); // 120 633 + 1 809
  });

  it("la prime minimale remplace une prime proratisée trop faible", () => {
    const r = calculer({
      ...V2,
      dateEffet: "2026-12-01",
      dateEcheance: "2026-12-31", // 31 jours
      parametres: parametres({ prorata: { actif: true, primeMinimale: "5000" } }),
      lignes: [{ code: "F", primeUnitaire: "20000", effectif: 1, accessoire: { mode: "AUCUN", valeur: "0" } }],
    });

    expect(texte(r.lignes[0].exact.nette)).toBe("5000"); // 20 000 × 31/365 = 1 698 < 5 000
  });
});

describe("accessoires, assiette et frais de fractionnement", () => {
  const unique = (accessoire: { mode: "AUCUN" | "FIXE" | "PAR_TETE" | "PAR_FAMILLE" | "POURCENT"; valeur: string }, p = parametres()) =>
    calculer({ ...AN_2026, parametres: p, lignes: [{ code: "F", primeUnitaire: "10000", effectif: 4, accessoire }] }).lignes[0].exact;

  it("calcule chaque mode d'accessoires", () => {
    expect(texte(unique({ mode: "FIXE", valeur: "500" }).accessoires)).toBe("500");
    expect(texte(unique({ mode: "PAR_TETE", valeur: "500" }).accessoires)).toBe("2000");
    expect(texte(unique({ mode: "PAR_FAMILLE", valeur: "500" }).accessoires)).toBe("2000");
    expect(texte(unique({ mode: "POURCENT", valeur: "5" }).accessoires)).toBe("2000"); // 5 % de 40 000
    expect(texte(unique({ mode: "AUCUN", valeur: "0" }).accessoires)).toBe("0");
  });

  it("taxe la prime nette seule si l'assiette est « nette »", () => {
    const e = unique({ mode: "FIXE", valeur: "1000" }, parametres({ taxe: { tauxPourcent: "1.5", assiette: "NETTE" } }));

    expect(texte(e.taxe)).toBe("600"); // 1,5 % de 40 000, sans les 1 000 d'accessoires
  });

  it("ajoute les frais de fractionnement aux accessoires, et les taxe", () => {
    const r = calculer({
      ...AN_2026,
      parametres: parametres({ fraisFractionnement: "2000" }),
      lignes: [{ code: "F", primeUnitaire: "10000", effectif: 4, accessoire: { mode: "AUCUN", valeur: "0" } }],
    });

    expect(texte(r.fraisFractionnement!.arrondi.accessoires)).toBe("2000");
    expect(texte(r.fraisFractionnement!.arrondi.taxe)).toBe("30");
    expect(texte(r.totaux.arrondi.ttc)).toBe("42630"); // 40 000 + 600 + 2 000 + 30
  });
});

describe("réponses de la Technique du 08/10/2026 (D18) : prorata plafonné, TTC = somme des arrondis", () => {
  const ligne = (primeUnitaire: string, accessoire = "0") => [{ code: "F", primeUnitaire, effectif: 1, accessoire: { mode: "FIXE" as const, valeur: accessoire } }];
  const ANNEE_BISSEXTILE = { dateEffet: "2028-01-01", dateEcheance: "2028-12-31" } as const;

  it("H3 : effet 01/01/2028, échéance 31/12/2028 (366 jours) → coefficient 1", () => {
    const r = calculer({ ...V2, ...ANNEE_BISSEXTILE, parametres: parametres(), lignes: ligne("365000") });

    expect(r.joursCouverts).toBe(366);
    expect(texte(r.coefProrata)).toBe("1");
    expect(texte(r.lignes[0].exact.nette)).toBe("365000"); // et non 366 000
  });

  it("H3 : T3 (163 jours) reste à 163/365", () => {
    const r = calculer({ ...V2, dateEffet: "2026-07-22", dateEcheance: "2026-12-31", parametres: parametres(), lignes: ligne("365000") });

    expect(r.coefProrata.eq(montant("163").div(365))).toBe(true);
  });

  it("H4 : le TTC est la somme des trois montants arrondis, jamais un arrondi indépendant", () => {
    // nette 100,4 ; accessoires 100,4 ; taxe 0,2 % de 200,8 = 0,4016 ; TTC exact 201,2016.
    const r = calculer({ ...AN_2026, parametres: parametres({ prorata: { actif: false, primeMinimale: null }, taxe: { tauxPourcent: "0.2", assiette: "NETTE_ACCESSOIRES" } }), lignes: ligne("100.4", "100.4") });
    const a = r.lignes[0].arrondi;

    expect([texte(a.nette), texte(a.accessoires), texte(a.taxe), texte(a.ttc)]).toEqual(["100", "100", "0", "200"]);
    expect(texte(r.totaux.arrondi.ttc)).toBe("200");
  });

  it("un calcul enregistré avant la session 4.0 (sans version) se refait à l'identique, avec les règles d'origine (T10)", () => {
    const ancien = calculer({ ...ANNEE_BISSEXTILE, parametres: parametres(), lignes: ligne("365000") });
    expect(texte(ancien.lignes[0].arrondi.nette)).toBe("366000"); // 366/365, comme à l'émission

    const ancienArrondi = calculer({
      ...AN_2026,
      moteur: undefined,
      parametres: parametres({ prorata: { actif: false, primeMinimale: null }, taxe: { tauxPourcent: "0.2", assiette: "NETTE_ACCESSOIRES" } }),
      lignes: ligne("100.4", "100.4"),
    }).lignes[0].arrondi;
    expect([texte(ancienArrondi.taxe), texte(ancienArrondi.ttc)]).toEqual(["1", "201"]); // écart absorbé par la taxe
  });

  it("refuse une version du moteur inconnue", () => {
    expect(() => calculer({ ...AN_2026, moteur: 3 as never, parametres: parametres(), lignes: ligne("100") })).toThrow(ErreurCalcul);
  });
});

describe("prime de l'unité (assures[].prime) : prime de la formule, au prorata, selon l'arrondi du produit", () => {
  const ligne = (code: string, primeUnitaire: string, effectif: number) => ({ code, primeUnitaire, effectif, accessoire: { mode: "AUCUN" as const, valeur: "0" } });
  const par = (entree: Partial<EntreeCalcul> & Pick<EntreeCalcul, "lignes">) => calculer({ ...AN_2026, parametres: parametres(), ...entree });

  it("T1, année pleine : la prime de la formule au franc près (Solo 93 581, Famille 252 658)", () => {
    const [solo, famille] = par({ lignes: [ligne("SOLO", "93581.33", 3), ligne("FAMILLE", "252657.63", 60)] }).lignes;

    expect(texte(solo.primeParUnite)).toBe("93581");
    expect(texte(famille.primeParUnite)).toBe("252658");
  });

  it("prorata : 100 000 sur 163 jours pour 2 assurés, soit 44 657,53 exactement, 44 658 au franc", () => {
    const r = par({ dateEffet: "2026-07-22", dateEcheance: "2026-12-31", lignes: [ligne("F", "100000", 2)] });

    expect(texte(r.lignes[0].primeParUnite)).toBe("44658");
    expect(texte(r.lignes[0].exact.nette.div(2).toDecimalPlaces(2))).toBe("44657.53");
  });

  it("l'arrondi est celui du produit (précision et sens), pas un arrondi au franc fixe", () => {
    const base = { dateEffet: "2026-07-22", dateEcheance: "2026-12-31", lignes: [ligne("F", "100000", 2)] };
    const arrondi = (precision: 1 | 10 | 100 | 1000, sens: "PROCHE" | "SUPERIEUR" | "INFERIEUR") =>
      texte(par({ ...base, parametres: parametres({ arrondi: { ...AU_FRANC, precision, sens } }) }).lignes[0].primeParUnite);

    expect(arrondi(100, "PROCHE")).toBe("44700");
    expect(arrondi(100, "INFERIEUR")).toBe("44600");
    expect(arrondi(1000, "SUPERIEUR")).toBe("45000");
    expect(arrondi(10, "PROCHE")).toBe("44660");
  });

  it("la prime minimale de la ligne est répartie sur l'effectif ; sans prorata, c'est la prime annuelle", () => {
    const minimale = par({ dateEffet: "2026-12-01", dateEcheance: "2026-12-31", parametres: parametres({ prorata: { actif: true, primeMinimale: "5000" } }), lignes: [ligne("F", "20000", 2)] });
    const sansProrata = par({ dateEffet: "2026-12-01", dateEcheance: "2026-12-31", parametres: parametres({ prorata: { actif: false, primeMinimale: null } }), lignes: [ligne("F", "20000", 2)] });

    expect(texte(minimale.lignes[0].primeParUnite)).toBe("2500");
    expect(texte(sansProrata.lignes[0].primeParUnite)).toBe("20000");
  });

  it("une année de 366 jours ne dépasse jamais la prime annuelle (prorata plafonné, H3)", () => {
    const r = par({ dateEffet: "2028-01-01", dateEcheance: "2028-12-31", lignes: [ligne("F", "93581.33", 1)] });

    expect(r.joursCouverts).toBe(366);
    expect(texte(r.lignes[0].primeParUnite)).toBe("93581");
  });
});

describe("refus des entrées invalides", () => {
  const base = { ...AN_2026, parametres: parametres(), lignes: [{ code: "F", primeUnitaire: "100", effectif: 1, accessoire: { mode: "AUCUN" as const, valeur: "0" } }] };

  it.each([
    ["échéance avant l'effet", { ...base, dateEffet: "2026-12-31", dateEcheance: "2026-01-01" }],
    ["date impossible", { ...base, dateEcheance: "2026-02-30" }],
    ["aucune formule", { ...base, lignes: [] }],
    ["effectif nul", { ...base, lignes: [{ ...base.lignes[0], effectif: 0 }] }],
    ["effectif décimal", { ...base, lignes: [{ ...base.lignes[0], effectif: 1.5 }] }],
    ["prime négative", { ...base, lignes: [{ ...base.lignes[0], primeUnitaire: "-1" }] }],
    ["taux supérieur à 100", { ...base, parametres: parametres({ taxe: { tauxPourcent: "101", assiette: "NETTE" } }) }],
    ["montant illisible", { ...base, lignes: [{ ...base.lignes[0], primeUnitaire: "12abc" }] }],
    ["formule en double", { ...base, lignes: [base.lignes[0], base.lignes[0]] }],
  ])("refuse : %s", (_nom, entree) => {
    expect(() => calculer(entree as EntreeCalcul)).toThrow(ErreurCalcul);
  });
});

describe("échéancier : la somme des tranches égale exactement le TTC (CDC §8.4)", () => {
  const arrondi = { precision: 1, sens: "PROCHE" } as const;
  const somme = (t: { montant: { plus(x: unknown): unknown } }[]) => t.reduce((s, x) => (s as ReturnType<typeof montant>).plus(x.montant as never), montant("0"));

  it("T1 : 15 888 000 en 4 tranches de 3 972 000, dates tous les 3 mois", () => {
    const t = genererEcheancier({ ttc: "15888000", nombreTranches: 4, dateEffet: "2026-07-22", arrondi });

    expect(t.map((x) => x.montant.toString())).toEqual(["3972000", "3972000", "3972000", "3972000"]);
    expect(t.map((x) => x.date)).toEqual(["2026-07-22", "2026-10-22", "2027-01-22", "2027-04-22"]);
    expect(somme(t).toString()).toBe("15888000");
  });

  it("T2 : 11 592 000 en 4 × 2 898 000", () => {
    const t = genererEcheancier({ ttc: "11592000", nombreTranches: 4, dateEffet: "2026-01-01", arrondi });

    expect(t.every((x) => x.montant.eq(2898000))).toBe(true);
  });

  it("la dernière tranche absorbe l'écart d'arrondi : 15 888 000 en 7 tranches", () => {
    const t = genererEcheancier({ ttc: "15888000", nombreTranches: 7, dateEffet: "2026-01-01", arrondi });

    expect(t.slice(0, 6).every((x) => x.montant.eq(2269714))).toBe(true);
    expect(t[6].montant.toString()).toBe("2269716"); // 2 269 714 + 2
    expect(somme(t).toString()).toBe("15888000");
  });

  it("respecte une répartition en pourcentages (40 / 30 / 30)", () => {
    const t = genererEcheancier({ ttc: "1000000", nombreTranches: 3, dateEffet: "2026-01-01", arrondi, repartitionPourcent: ["40", "30", "30"] });

    expect(t.map((x) => x.montant.toString())).toEqual(["400000", "300000", "300000"]);
  });

  it("refuse une répartition qui ne fait pas 100 %, des dates désordonnées et une tranche nulle", () => {
    const base = { ttc: "1000", nombreTranches: 2, dateEffet: "2026-01-01", arrondi } as const;

    expect(() => genererEcheancier({ ...base, repartitionPourcent: ["50", "49"] })).toThrow(ErreurCalcul);
    expect(() => genererEcheancier({ ...base, dates: ["2026-06-01", "2026-03-01"] })).toThrow(ErreurCalcul);
    expect(() => genererEcheancier({ ttc: "1", nombreTranches: 3, dateEffet: "2026-01-01", arrondi })).toThrow(ErreurCalcul);
    expect(() => genererEcheancier({ ...base, nombreTranches: 13 })).toThrow(ErreurCalcul);
  });
});
