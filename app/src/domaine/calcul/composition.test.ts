import { describe, expect, it } from "vitest";

import { calculer, NIVEAUX_ARRONDI, COMPOSANTES, type EntreeCalcul, type RegleArrondi } from "./calcul";
import {
  MAX_LIGNES_DE_PRIME,
  composer,
  estComposition,
  estNonComposee,
  problemesLignesDePrime,
  recalculer,
  saisieDesLignes,
  tauxUnique,
  type EntreeComposition,
  type LigneComposee,
} from "./composition";
import { PRECISIONS, SENS_ARRONDI } from "./montant";

// Tous les chiffres sont INVENTÉS (instructions de la phase 6.2) ; chaque attendu est posé à la main avec son calcul.

const PROCHE: RegleArrondi = { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" };
const ligne = (libelle: string, branche: string, primeNette: string, accessoires: string, tauxPourcent: string, assiette: LigneComposee["assiette"] = "NETTE_ACCESSOIRES"): LigneComposee => ({
  libelle, branche, primeNette, accessoires, tauxPourcent, assiette,
});
const entree = (lignes: LigneComposee[], arrondi: RegleArrondi = PROCHE): EntreeComposition => ({
  type: "COMPOSITION", version: 1, dateEffet: "2026-01-01", dateEcheance: "2026-12-31", arrondi, lignes,
});
const t = (m: { toFixed(): string }) => m.toFixed();

const IARD = [
  ligne("Incendie", "INCENDIE", "10000", "2500", "12.5"),
  ligne("Vol", "IARD", "9850", "2500", "7.25"),
  ligne("Dégât des eaux", "IARD", "6000", "2500", "7.25"),
];

describe("composition IARD : une taxe par ligne, selon la branche de la ligne", () => {
  it("arrondi au franc : taxes 1 563, 895 et 616, totaux et invariant", () => {
    const r = composer(entree(IARD));
    // Incendie : (10 000 + 2 500) × 12,5 % = 1 562,5 → 1 563 ; TTC 10 000 + 2 500 + 1 563 = 14 063.
    // Vol : (9 850 + 2 500) × 7,25 % = 895,375 → 895 ; TTC 9 850 + 2 500 + 895 = 13 245.
    // Dégât des eaux : (6 000 + 2 500) × 7,25 % = 616,25 → 616 ; TTC 6 000 + 2 500 + 616 = 9 116.
    expect(r.lignes.map((l) => [l.code, t(l.arrondi.taxe), t(l.arrondi.ttc)])).toEqual([["G1", "1563", "14063"], ["G2", "895", "13245"], ["G3", "616", "9116"]]);
    // Totaux : nette 25 850, accessoires 7 500, taxe 1 563 + 895 + 616 = 3 074, TTC 36 424.
    expect(Object.fromEntries(Object.entries(r.totaux.arrondi).map(([k, v]) => [k, t(v)]))).toEqual({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424" });
    expect(r.joursCouverts).toBe(365);
    expect(t(r.coefProrata)).toBe("1"); // aucun prorata automatique
    expect(r.fraisFractionnement).toBeNull();
  });

  it("au supérieur à 100 F : le niveau « ligne » somme les lignes arrondies (taxe 3 200), le niveau « total » arrondit la somme exacte (taxe 3 100)", () => {
    const regle = (niveau: "LIGNE" | "TOTAL"): RegleArrondi => ({ precision: 100, sens: "SUPERIEUR", niveau, composanteAbsorbante: "TAXE" });
    const ligneParLigne = composer(entree(IARD, regle("LIGNE")));
    // Taxes de ligne : 1 562,5 → 1 600 ; 895,375 → 900 ; 616,25 → 700 (somme 3 200). Nettes : 10 000 ; 9 850 → 9 900 ; 6 000 (somme 25 900).
    expect(ligneParLigne.lignes.map((l) => t(l.arrondi.ttc))).toEqual(["14100", "13300", "9200"]);
    expect(Object.fromEntries(Object.entries(ligneParLigne.totaux.arrondi).map(([k, v]) => [k, t(v)]))).toEqual({ nette: "25900", accessoires: "7500", taxe: "3200", ttc: "36600" });
    // Niveau « total » : taxe exacte 1 562,5 + 895,375 + 616,25 = 3 074,125 → 3 100 ; nette exacte 25 850 → 25 900.
    const total = composer(entree(IARD, regle("TOTAL")));
    expect(Object.fromEntries(Object.entries(total.totaux.arrondi).map(([k, v]) => [k, t(v)]))).toEqual({ nette: "25900", accessoires: "7500", taxe: "3100", ttc: "36500" });
    // Les lignes restent arrondies une à une, dans les deux cas.
    expect(total.lignes.map((l) => t(l.arrondi.ttc))).toEqual(["14100", "13300", "9200"]);
  });
});

describe("composition IA : la part « décès toutes causes » n'est pas taxée", () => {
  it("Accident 100 000 + 5 000 à 7,25 % ; Décès toutes causes 20 000 à 0 % : taxe nulle sur cette ligne", () => {
    const r = composer(entree([ligne("Accident", "IA", "100000", "5000", "7.25"), ligne("Décès toutes causes", "DECES", "20000", "0", "0")]));
    // Accident : (100 000 + 5 000) × 7,25 % = 7 612,5 → 7 613 ; TTC 112 613. Décès : taxe 0 ; TTC 20 000.
    expect(r.lignes.map((l) => [t(l.arrondi.taxe), t(l.arrondi.ttc)])).toEqual([["7613", "112613"], ["0", "20000"]]);
    expect(Object.fromEntries(Object.entries(r.totaux.arrondi).map(([k, v]) => [k, t(v)]))).toEqual({ nette: "120000", accessoires: "5000", taxe: "7613", ttc: "132613" });
  });
});

describe("assiette de la taxe de la ligne", () => {
  it("assiette « nette seule » : les accessoires ne sont pas taxés", () => {
    const r = composer(entree([ligne("Vol", "IARD", "9850", "2500", "7.25", "NETTE")]));
    // 9 850 × 7,25 % = 714,125 → 714 ; TTC 9 850 + 2 500 + 714 = 13 064.
    expect(r.lignes.map((l) => [t(l.arrondi.taxe), t(l.arrondi.ttc)])).toEqual([["714", "13064"]]);
  });
});

describe("régime Individuel ou Groupe : le taux de la ligne est celui résolu par l'appelant", () => {
  it("une ligne SANTE à 1,5 % (Groupe) et à 4 % (Individuel)", () => {
    const groupe = composer(entree([ligne("Santé", "SANTE", "200000", "0", "1.5")]));
    const individuel = composer(entree([ligne("Santé", "SANTE", "200000", "0", "4")]));
    // 200 000 × 1,5 % = 3 000 ; 200 000 × 4 % = 8 000.
    expect([t(groupe.totaux.arrondi.taxe), t(groupe.totaux.arrondi.ttc)]).toEqual(["3000", "203000"]);
    expect([t(individuel.totaux.arrondi.taxe), t(individuel.totaux.arrondi.ttc)]).toEqual(["8000", "208000"]);
  });
});

describe("invariant : nette + accessoires + taxe = TTC, par ligne et au total, pour toute règle d'arrondi", () => {
  /** Générateur pseudo-aléatoire déterministe (même méthode que invariants.test.ts). */
  function aleatoire(graine: number) {
    let s = graine;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }
  /**
   * Oracle INDÉPENDANT du moteur : arithmétique entière en BigInt (aucun Decimal), montants en centimes et taux en centièmes de pour cent.
   * Taxe exacte d'une ligne en francs = base_c × taux_100 / 1 000 000 ; un montant exact N / D (en francs) s'arrondit à `precision` francs.
   */
  const centimes = (texte: string): bigint => {
    const [entier, fraction = ""] = texte.split(".");
    return BigInt(entier) * BigInt(100) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const centiemes = (texte: string): bigint => centimes(texte); // « 7.25 » → 725
  const arrondiEntier = (n: bigint, d: bigint, precision: number, sens: string): bigint => {
    const p = BigInt(precision);
    const dp = d * p;
    const q = sens === "INFERIEUR" ? n / dp : sens === "SUPERIEUR" ? (n + dp - BigInt(1)) / dp : (BigInt(2) * n + dp) / (BigInt(2) * dp); // positifs : division entière = plancher
    return q * p;
  };
  const oracle = (lignes: LigneComposee[], regle: RegleArrondi) => {
    const exactes = lignes.map((l) => {
      const nette = centimes(l.primeNette);
      const accessoires = centimes(l.accessoires);
      const base = l.assiette === "NETTE_ACCESSOIRES" ? nette + accessoires : nette;
      return { nette, accessoires, taxe: base * centiemes(l.tauxPourcent) }; // nette et accessoires sur 100, taxe sur 1 000 000
    });
    const arrondi = (e: { nette: bigint; accessoires: bigint; taxe: bigint }) => {
      const nette = arrondiEntier(e.nette, BigInt(100), regle.precision, regle.sens);
      const accessoires = arrondiEntier(e.accessoires, BigInt(100), regle.precision, regle.sens);
      const taxe = arrondiEntier(e.taxe, BigInt(1000000), regle.precision, regle.sens);
      return { nette, accessoires, taxe, ttc: nette + accessoires + taxe };
    };
    const parLigne = exactes.map(arrondi);
    const total =
      regle.niveau === "LIGNE"
        ? parLigne.reduce((s, l) => ({ nette: s.nette + l.nette, accessoires: s.accessoires + l.accessoires, taxe: s.taxe + l.taxe, ttc: s.ttc + l.ttc }), { nette: BigInt(0), accessoires: BigInt(0), taxe: BigInt(0), ttc: BigInt(0) })
        : arrondi(exactes.reduce((s, e) => ({ nette: s.nette + e.nette, accessoires: s.accessoires + e.accessoires, taxe: s.taxe + e.taxe }), { nette: BigInt(0), accessoires: BigInt(0), taxe: BigInt(0) }));
    return { parLigne, total };
  };
  const enTexte = (a: { nette: bigint; accessoires: bigint; taxe: bigint; ttc: bigint }) => [a.nette, a.accessoires, a.taxe, a.ttc].map(String);
  const depuisMoteur = (c: { nette: { toFixed(): string }; accessoires: { toFixed(): string }; taxe: { toFixed(): string }; ttc: { toFixed(): string } }) => [c.nette, c.accessoires, c.taxe, c.ttc].map((m) => m.toFixed());

  it("l'oracle entier retrouve à la main les chiffres de l'énoncé (garde-fou de l'oracle lui-même)", () => {
    const o = oracle(IARD, PROCHE);
    expect(o.parLigne.map(enTexte)).toEqual([["10000", "2500", "1563", "14063"], ["9850", "2500", "895", "13245"], ["6000", "2500", "616", "9116"]]);
    expect(enTexte(o.total)).toEqual(["25850", "7500", "3074", "36424"]);
    expect(enTexte(oracle(IARD, { precision: 100, sens: "SUPERIEUR", niveau: "TOTAL", composanteAbsorbante: "TAXE" }).total)).toEqual(["25900", "7500", "3100", "36500"]);
  });

  it("72 règles × 20 compositions aléatoires de 1 à 6 lignes : le moteur donne les mêmes montants que l'oracle entier, par ligne et au total", () => {
    const alea = aleatoire(62);
    const entre = (min: number, max: number) => min + Math.floor(alea() * (max - min + 1));
    const texte = (maxEntier: number) => `${entre(1, maxEntier)}.${String(entre(0, 99)).padStart(2, "0")}`;
    const tauxPossibles = ["0", "1.5", "4", "7.25", "12.5"];
    let verifiees = 0;
    for (const precision of PRECISIONS) for (const sens of SENS_ARRONDI) for (const niveau of NIVEAUX_ARRONDI) for (const composanteAbsorbante of COMPOSANTES) {
      for (let n = 0; n < 20; n++) {
        const lignes = Array.from({ length: entre(1, 6) }, (_, i) =>
          ligne(`Garantie ${i + 1}`, "IARD", texte(900000), alea() < 0.3 ? "0" : texte(20000), tauxPossibles[entre(0, 4)], alea() < 0.2 ? "NETTE" : "NETTE_ACCESSOIRES"),
        );
        const regle = { precision, sens, niveau, composanteAbsorbante };
        const r = composer(entree(lignes, regle));
        const attendu = oracle(lignes, regle);
        expect(r.lignes.map((l) => depuisMoteur(l.arrondi))).toEqual(attendu.parLigne.map(enTexte));
        expect(depuisMoteur(r.totaux.arrondi)).toEqual(enTexte(attendu.total));
        // Et l'invariant du CDC §8.1, vérifié sur les chiffres de l'oracle (non sur ceux du moteur) : TTC = nette + accessoires + taxe.
        for (const l of attendu.parLigne) expect(l.ttc).toBe(l.nette + l.accessoires + l.taxe);
        expect(attendu.total.ttc).toBe(attendu.total.nette + attendu.total.accessoires + attendu.total.taxe);
        verifiees++;
      }
    }
    expect(verifiees).toBe(72 * 20);
  });
});

describe("composition vide, taux unique, saisie", () => {
  it("une composition sans ligne donne des totaux nuls et se reconnaît comme « non composée »", () => {
    const e = entree([]);
    expect(estNonComposee(e)).toBe(true);
    expect(t(composer(e).totaux.arrondi.ttc)).toBe("0");
    expect(estNonComposee(entree(IARD))).toBe(false);
  });

  it("taux unique : rempli si toutes les lignes ont le même taux (7,25 = 7,250), vide s'il y en a plusieurs ou aucune ligne", () => {
    expect(tauxUnique([ligne("a", "IARD", "1", "0", "7.25"), ligne("b", "IARD", "1", "0", "7.250")])).toBe("7.25");
    expect(tauxUnique(IARD)).toBeNull();
    expect(tauxUnique([])).toBeNull();
  });

  it("la saisie des lignes retire le taux et l'assiette et conserve le montant garanti quand il est présent", () => {
    expect(saisieDesLignes([IARD[0]])).toEqual([{ libelle: "Incendie", branche: "INCENDIE", primeNette: "10000", accessoires: "2500" }]);
    expect(saisieDesLignes([{ ...IARD[0], montantGaranti: "50000000" }])).toEqual([
      { libelle: "Incendie", branche: "INCENDIE", montantGaranti: "50000000", primeNette: "10000", accessoires: "2500" },
    ]);
  });

  it("estComposition distingue l'entrée du moteur à la formule ; recalculer aiguille vers le bon calcul", () => {
    const formule: EntreeCalcul = {
      moteur: 2, dateEffet: "2026-01-01", dateEcheance: "2026-12-31",
      lignes: [{ code: "F", primeUnitaire: "1000", effectif: 2, accessoire: { mode: "AUCUN", valeur: "0" } }],
      parametres: { prorata: { actif: false, primeMinimale: null }, arrondi: PROCHE, taxe: { tauxPourcent: "10", assiette: "NETTE_ACCESSOIRES" } },
    };
    expect(estComposition(formule)).toBe(false);
    expect(estComposition(entree(IARD))).toBe(true);
    expect(estComposition(null)).toBe(false);
    expect(t(recalculer(formule).totaux.arrondi.ttc)).toBe(t(calculer(formule).totaux.arrondi.ttc));
    expect(t(recalculer(entree(IARD)).totaux.arrondi.ttc)).toBe("36424");
  });

  it("une composition refuse une version inconnue, un taux hors bornes et une échéance avant l'effet", () => {
    expect(() => composer({ ...entree(IARD), version: 2 as never })).toThrow(/Version de la composition inconnue/);
    expect(() => composer(entree([ligne("a", "IARD", "100", "0", "101")]))).toThrow(/entre 0 et 100/);
    expect(() => composer({ ...entree(IARD), dateEcheance: "2025-12-31" })).toThrow(/échéance/);
  });
});

describe("validation de la saisie des lignes de prime", () => {
  const ok = { libelle: "Vol", branche: "IARD", primeNette: "9850", accessoires: "2500" };
  it("une saisie correcte n'a aucun problème", () => {
    expect(problemesLignesDePrime([ok])).toEqual([]);
    expect(problemesLignesDePrime([{ ...ok, primeNette: "9 850,50", accessoires: "0" }])).toEqual([]);
  });
  it("aucune ligne : refusé, sauf pour un brouillon « à composer »", () => {
    expect(problemesLignesDePrime([])).toEqual(["Saisissez au moins une ligne de prime."]);
    expect(problemesLignesDePrime([], { exiger: false })).toEqual([]);
  });
  it("jamais de zéro silencieux : prime nette nulle, négative ou illisible refusée, avec le numéro de la ligne", () => {
    const messages = (l: Partial<typeof ok>) => problemesLignesDePrime([ok, { ...ok, ...l }]).join(" | ");
    expect(messages({ primeNette: "0" })).toContain("Ligne 2 (prime nette) : la prime nette doit être supérieure à zéro");
    expect(messages({ primeNette: "-5" })).toContain("Ligne 2 (prime nette) : un montant négatif n'est pas accepté");
    expect(messages({ accessoires: "-1" })).toContain("Ligne 2 (accessoires) : un montant négatif n'est pas accepté");
    expect(messages({ primeNette: "1.234,5" })).toContain("Ligne 2 (prime nette) : Montant invalide");
    expect(messages({ accessoires: "" })).toContain("Ligne 2 (accessoires) : Montant invalide");
  });
  it("bornes exactes : 30 lignes et un libellé de 100 caractères sont acceptés, 31 lignes et 101 caractères refusés", () => {
    expect(problemesLignesDePrime(Array.from({ length: MAX_LIGNES_DE_PRIME }, () => ok))).toEqual([]);
    expect(MAX_LIGNES_DE_PRIME).toBe(30);
    expect(problemesLignesDePrime([{ ...ok, libelle: "x".repeat(100) }])).toEqual([]);
    expect(problemesLignesDePrime([{ ...ok, libelle: "x".repeat(101) }])).toHaveLength(1);
    // Une branche de 30 caractères (code valide) passe, de 31 non.
    expect(problemesLignesDePrime([{ ...ok, branche: "A".repeat(30) }])).toEqual([]);
    expect(problemesLignesDePrime([{ ...ok, branche: "A".repeat(31) }])).toHaveLength(1);
  });
  it("libellé obligatoire et borné, branche en code valide, 30 lignes au plus, montant garanti facultatif >= 0", () => {
    expect(problemesLignesDePrime([{ ...ok, libelle: "  " }]).join()).toContain("le libellé de la garantie est obligatoire");
    expect(problemesLignesDePrime([{ ...ok, libelle: "x".repeat(101) }]).join()).toContain("libellé trop long");
    expect(problemesLignesDePrime([{ ...ok, branche: "incendie" }]).join()).toContain("choisissez la branche fiscale");
    expect(problemesLignesDePrime(Array.from({ length: MAX_LIGNES_DE_PRIME + 1 }, () => ok)).join()).toContain(`Au plus ${MAX_LIGNES_DE_PRIME} lignes`);
    expect(problemesLignesDePrime([{ ...ok, montantGaranti: "50 000 000" }, { ...ok, montantGaranti: "0" }, { ...ok, montantGaranti: null }])).toEqual([]);
    expect(problemesLignesDePrime([{ ...ok, montantGaranti: "-1" }]).join()).toContain("Ligne 1 (montant garanti) : un montant négatif n'est pas accepté");
    expect(problemesLignesDePrime([{ ...ok, montantGaranti: "abc" }]).join()).toContain("Ligne 1 (montant garanti) : Montant invalide");
  });
});
