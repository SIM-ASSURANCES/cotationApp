import { describe, expect, it } from "vitest";

import { ajouterJours, aujourdhui } from "../calcul/dates";
import { calculerBareme, composerBareme, type ParametresBareme } from "./bareme";
import type { Saisie } from "./schema";
import { baremeSecurpro, documentSecurpro, parametresEssai } from "./securpro-fixture";
import { lireBareme } from "./schema";

/** Générateur pseudo-aléatoire à graine fixe (mulberry32) : les tests sont reproductibles, sans dépendance. */
function graine(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Alea = () => number;
const entier = (r: Alea, min: number, max: number, pas = 1) => min + Math.floor(r() * (Math.floor((max - min) / pas) + 1)) * pas;
const parmi = <T,>(r: Alea, liste: readonly T[]): T => liste[Math.floor(r() * liste.length)];

const COMMERCES = ["BUREAU", "EPICERIE", "ELECTRONIQUE", "MECHES", "SUPERETTE", "QUINCAILLERIE"] as const;
const LISTES: Record<string, readonly string[]> = {
  dde_montant: ["500000", "1000000", "2000000"],
  de_montant: ["500000", "1000000"],
  bdg_montant: ["250000", "500000"],
  tempete_montant: ["2000000", "5000000"],
  tri_montant: ["5000000", "10000000"],
  vol_caisse_montant: ["50000", "100000", "200000"],
};
const GARANTIES = ["dde", "de", "bdg", "tempete", "tri"] as const;

/** Saisie SECURPRO valide tirée au hasard. Les champs des garanties non souscrites reçoivent parfois n'importe quoi : ils doivent être ignorés. */
function saisieAleatoire(r: Alea): Saisie {
  const locataire = r() < 0.5;
  const souscrit: string[] = ["incendie"];
  const champs: Saisie["champs"] = {
    type_commerce: parmi(r, COMMERCES),
    occupation: locataire ? "LOCATAIRE" : "PROPRIETAIRE",
    situation: r() < 0.8 ? "BOUTIQUE" : "MARCHE",
    gardien: r() < 0.5,
    extincteurs: r() < 0.5,
    camera: r() < 0.5,
    volet: r() < 0.5,
    stocks: String(entier(r, 0, 15_000_000, 1000)),
    materiel: String(entier(r, 0, 3_000_000, 1000)),
    mobilier: String(entier(r, 0, 2_000_000, 1000)),
    amenagement: String(entier(r, 0, 2_000_000, 1000)),
    informatique: String(entier(r, 0, 2_000_000, 1000)),
  };
  if (locataire) champs.loyer_mensuel = String(entier(r, 50_000, 400_000, 5000));
  else champs.valeur_batiment = String(entier(r, 5_000_000, 60_000_000, 500_000));
  // le contenu doit être strictement positif : une assiette nulle est un refus, testé ailleurs
  champs.stocks = String(Number(champs.stocks) + 1000);
  if (r() < 0.6) souscrit.push("vol.contenu");
  if (r() < 0.6) souscrit.push("vol.caisse");
  for (const g of GARANTIES) if (r() < 0.5) souscrit.push(g);
  for (const [champ, valeurs] of Object.entries(LISTES)) {
    const garantie = champ === "vol_caisse_montant" ? "vol.caisse" : champ.replace("_montant", "");
    if (souscrit.includes(garantie)) champs[champ] = parmi(r, valeurs);
    else if (r() < 0.3) champs[champ] = "n'importe quoi";
  }
  return { champs, souscrit };
}

// ─── Oracle : réimplémentation indépendante de SECURPRO (fiche §1.1), en fractions entières BigInt ───

/** Les littéraux BigInt (`10n`) exigent une cible ES2020 : on passe par `BigInt()`. */
const B = BigInt;
type Q = { n: bigint; d: bigint };
const q = (texte: string): Q => {
  const [e, f = ""] = texte.split(".");
  return { n: BigInt(e + f), d: B(10) ** BigInt(f.length) };
};
const mul = (a: Q, b: Q): Q => ({ n: a.n * b.n, d: a.d * b.d });
const div = (a: Q, b: Q): Q => ({ n: a.n * b.d, d: a.d * b.n });
const add = (a: Q, b: Q): Q => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const moins = (a: Q, b: Q): number => Number(a.n * b.d - b.n * a.d);
const min = (a: Q, b: Q): Q => (moins(a, b) <= 0 ? a : b);
const max = (a: Q, b: Q): Q => (moins(a, b) >= 0 ? a : b);
/** Arrondi à l'entier le plus proche, 0,5 vers le haut (valeurs positives). */
const arrondi = (a: Q): bigint => (B(2) * a.n + a.d) / (B(2) * a.d);

type Ligne = { nette: bigint; acc: bigint; taxe: bigint; ttc: bigint };
type Attendu = { refus: true } | { refus: false; lignes: Ligne[]; ttc: bigint };

function oracle(s: Saisie, jours: number, prorata: boolean): Attendu {
  const c = s.champs as Record<string, string | boolean>;
  const t = c.type_commerce as string;
  const classe = { BUREAU: 1, EPICERIE: 2, ELECTRONIQUE: 2, MECHES: 3, SUPERETTE: 3, QUINCAILLERIE: 4 }[t]!;
  const contenu = ["stocks", "materiel", "mobilier", "amenagement", "informatique"].reduce((x, k) => add(x, q(c[k] as string)), q("0"));
  const immo = c.occupation === "LOCATAIRE" ? mul(q(c.loyer_mensuel as string), q("120")) : q(c.valeur_batiment as string);
  const capitaux = add(immo, contenu);
  const limite = c.situation === "MARCHE" ? B(5000000) : [B(100000000), B(80000000), B(60000000), B(50000000)][classe - 1];
  if (moins(capitaux, { n: limite, d: B(1) }) > 0) return { refus: true };

  const secu = c.gardien && c.extincteurs ? q("0.8") : c.gardien || c.extincteurs ? q("0.9") : q("1");
  const tauxIncendie = q(["0.72", "0.864", "1.0368", "1.24416"][classe - 1]);
  const primes: { net: Q; taux: Q }[] = [{ net: mul(mul(div(mul(capitaux, tauxIncendie), q("1000")), secu), q("1")), taux: q("12.5") }];
  const parties: Q[] = [];
  if (s.souscrit.includes("vol.contenu")) {
    const coef = t === "ELECTRONIQUE" || t === "MECHES" ? q("1.2") : q("1");
    parties.push(mul(mul(min(div(mul(contenu, q("15")), q("100")), q("2000000")), q("0.01")), coef));
  }
  if (s.souscrit.includes("vol.caisse")) {
    const coef = t === "SUPERETTE" || t === "QUINCAILLERIE" ? q("1.25") : q("1");
    parties.push(max(mul(mul(q(c.vol_caisse_montant as string), q("0.025")), coef), q("2500")));
  }
  if (parties.length > 0) primes.push({ net: parties.reduce(add), taux: q("7.25") });
  const simples: [string, string, string][] = [["dde", "dde_montant", "6"], ["de", "de_montant", "10"], ["bdg", "bdg_montant", "20"], ["tempete", "tempete_montant", "0.72"], ["tri", "tri_montant", "4"]];
  for (const [g, champ, permille] of simples) if (s.souscrit.includes(g)) primes.push({ net: div(mul(q(c[champ] as string), q(permille)), q("1000")), taux: q("7.25") });

  const facteur = prorata ? div({ n: BigInt(Math.min(jours, 365)), d: B(1) }, q("365")) : q("1");
  const lignes = primes.map((p) => {
    const net = mul(p.net, facteur);
    const acc = q("2500");
    const taxe = div(mul(add(net, acc), p.taux), q("100"));
    const [n, a, x] = [arrondi(net), arrondi(acc), arrondi(taxe)];
    return { nette: n, acc: a, taxe: x, ttc: n + a + x };
  });
  return { refus: false, lignes, ttc: lignes.reduce((s2, l) => s2 + l.ttc, B(0)) };
}

const parametresPourJours = (jours: number, actif: boolean): ParametresBareme => {
  const effet = ajouterJours(aujourdhui(), 1);
  return parametresEssai({ prorata: { actif }, dateEffet: effet, dateEcheance: ajouterJours(effet, jours - 1) });
};

describe("oracle BigInt indépendant : 200 saisies SECURPRO tirées à graine fixe", () => {
  const b = baremeSecurpro();
  it("le moteur et l'oracle donnent les mêmes lignes et le même TTC, ou refusent ensemble", () => {
    const r = graine(20261024);
    let calcules = 0;
    let refuses = 0;
    for (let i = 0; i < 200; i++) {
      const s = saisieAleatoire(r);
      const jours = entier(r, 1, 400);
      const prorata = r() < 0.5;
      const p = parametresPourJours(jours, prorata);
      const attendu = oracle(s, jours, prorata);
      const obtenu = calculerBareme(b, s, p);
      const contexte = JSON.stringify({ s, jours, prorata });
      if (attendu.refus) {
        refuses++;
        expect(obtenu.ok, contexte).toBe(false);
        if (!obtenu.ok) expect(obtenu.refus.map((x) => x.message).join("|"), contexte).toContain("ne peut pas être assuré");
        continue;
      }
      calcules++;
      expect(obtenu.ok, contexte).toBe(true);
      if (!obtenu.ok) continue;
      const m = composerBareme(obtenu.lignes, p);
      expect(m.lignes.map((l) => ({ nette: BigInt(l.arrondi.nette.toFixed()), acc: BigInt(l.arrondi.accessoires.toFixed()), taxe: BigInt(l.arrondi.taxe.toFixed()), ttc: BigInt(l.arrondi.ttc.toFixed()) })), contexte).toEqual(attendu.lignes);
      expect(BigInt(m.totaux.arrondi.ttc.toFixed()), contexte).toBe(attendu.ttc);
    }
    // le tirage doit exercer les deux branches
    expect(calcules).toBeGreaterThan(100);
    expect(refuses).toBeGreaterThan(5);
  });
});

describe("propriétés à graine fixe", () => {
  const b = baremeSecurpro();
  const p = parametresEssai();
  const tirages = (n: number, f: (s: Saisie, r: Alea) => void) => {
    const r = graine(7);
    for (let i = 0; i < n; i++) f(saisieAleatoire(r), r);
  };

  it("déterminisme : mêmes entrées, mêmes lignes", () => {
    tirages(60, (s) => expect(JSON.stringify(calculerBareme(b, s, p))).toBe(JSON.stringify(calculerBareme(b, s, p))));
  });

  it("jamais de ligne à zéro : tout résultat accepté a des primes nettes strictement positives, et un refus n'a aucune ligne", () => {
    tirages(100, (s) => {
      const r = calculerBareme(b, s, p);
      if (r.ok) expect(r.lignes.every((l) => Number(l.primeNette) > 0)).toBe(true);
      else expect(r.refus.length).toBeGreaterThan(0);
    });
  });

  it("la somme des lignes arrondies est le total", () => {
    tirages(60, (s) => {
      const r = calculerBareme(b, s, p);
      if (!r.ok) return;
      const m = composerBareme(r.lignes, p);
      expect(m.lignes.reduce((t, l) => t + BigInt(l.arrondi.ttc.toFixed()), B(0))).toBe(BigInt(m.totaux.arrondi.ttc.toFixed()));
    });
  });

  it("l'ordre des sous-jacents ne change rien", () => {
    const d = structuredClone(documentSecurpro);
    d.sousJacents.reverse();
    const inverse = lireBareme(d);
    tirages(60, (s) => expect(JSON.stringify(calculerBareme(inverse, s, p))).toBe(JSON.stringify(calculerBareme(b, s, p))));
  });

  it("un coefficient 1 partout équivaut à l'absence du sous-jacent", () => {
    const avec = structuredClone(documentSecurpro);
    avec.tables[1].lignes = { "OUI|OUI": "1", "OUI|NON": "1", "NON|OUI": "1", "NON|NON": "1" };
    const sans = structuredClone(documentSecurpro);
    sans.sousJacents = sans.sousJacents.filter((x) => x.code !== "securite");
    const [bAvec, bSans] = [lireBareme(avec), lireBareme(sans)];
    tirages(60, (s) => expect(JSON.stringify(calculerBareme(bAvec, s, p))).toBe(JSON.stringify(calculerBareme(bSans, s, p))));
  });

  it("ce qui concerne une garantie non souscrite n'influence pas le résultat", () => {
    tirages(60, (s) => {
      const autre = { ...s, champs: { ...s.champs } };
      for (const [champ, valeurs] of Object.entries(LISTES)) {
        const garantie = champ === "vol_caisse_montant" ? "vol.caisse" : champ.replace("_montant", "");
        if (!s.souscrit.includes(garantie)) autre.champs[champ] = parmi(graine(1), valeurs);
      }
      expect(JSON.stringify(calculerBareme(b, autre, p))).toBe(JSON.stringify(calculerBareme(b, s, p)));
    });
  });

  it("monotonie : plus de stocks ne fait jamais baisser une prime nette (quand les deux calculs sont acceptés)", () => {
    tirages(80, (s, r) => {
      const plus = { ...s, champs: { ...s.champs, stocks: String(Number(s.champs.stocks) + entier(r, 0, 3_000_000, 1000)) } };
      const [a, c] = [calculerBareme(b, s, p), calculerBareme(b, plus, p)];
      if (!a.ok || !c.ok) return;
      a.lignes.forEach((l, i) => expect(Number(c.lignes[i].primeNette)).toBeGreaterThanOrEqual(Number(l.primeNette)));
    });
  });

  it("le prorata ne fait jamais monter une prime nette", () => {
    tirages(60, (s, r) => {
      const [pleine, partielle] = [calculerBareme(b, s, parametresPourJours(400, false)), calculerBareme(b, s, parametresPourJours(entier(r, 1, 400), true))];
      if (!pleine.ok || !partielle.ok) return;
      pleine.lignes.forEach((l, i) => expect(Number(partielle.lignes[i].primeNette)).toBeLessThanOrEqual(Number(l.primeNette) + 1e-9));
    });
  });
});
