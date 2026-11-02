import { describe, expect, it } from "vitest";

import { ajouterJours } from "../calcul/dates";
import { estCompositionBareme, type EntreeComposition } from "../calcul/composition";
import { calculerBareme, composerBareme, versComposition } from "./bareme";
import { aDejaLeDetail, compositionAvecDetail, lignesAvecDetail } from "./detail-figee";
import { libelleDeComposante } from "./garantie";
import { baremeSecurpro, parametresEssai } from "./securpro-fixture";

/** Cas 1 du SECURPRO inventé : six garanties, dont le Vol à deux composantes. */
function cas1(surcharge = {}) {
  const b = baremeSecurpro();
  const e = b.jeuxEssai[0].entrees;
  const saisie = { champs: e.champs, souscrit: e.souscrit };
  const parametres = parametresEssai(surcharge);
  const r = calculerBareme(b, saisie, parametres);
  if (!r.ok) throw new Error("le cas 1 doit se calculer");
  return { b, saisie, parametres, r };
}

/** Composition d'origine BAREME telle qu'une cotation l'a figée AVANT la conservation des composantes (lignes sans code ni composantes). */
function compositionAncienne(surcharge = {}) {
  const { saisie, parametres, r } = cas1(surcharge);
  const entree = versComposition(r.lignes, parametres);
  const lignes = entree.lignes.map((l) => {
    const reste = { ...l };
    delete reste.code;
    delete reste.composantes;
    return reste;
  });
  return { ...entree, lignes, origine: "BAREME" as const, bareme: { versionId: 1, empreinte: "e", saisie } } satisfies EntreeComposition;
}

describe("composantes figées avec chaque garantie (H173)", () => {
  it("chaque ligne porte le code de sa garantie ; le Vol détaille contenu et caisse (code, libellé, assiette, prime nette)", () => {
    const { r } = cas1();
    expect(r.lignes.map((l) => l.code)).toEqual(["incendie", "vol", "dde", "de", "bdg", "tri"]);
    const vol = r.lignes[1];
    expect(vol.composantes?.map((c) => [c.code, c.libelle])).toEqual([["contenu", "Contenu"], ["caisse", "Caisse"]]);
    // Assiettes : somme = montant garanti de la ligne (H136) ; primes nettes : somme = prime nette de la ligne.
    expect(vol.composantes!.reduce((s, c) => s + Number(c.montantGaranti), 0)).toBe(Number(vol.montantGaranti));
    // Primes nettes des composantes : arrondies comme la ligne (précision et sens du produit) ; ici leur somme est la prime nette arrondie de la ligne (20 960).
    const { r: rr, parametres } = cas1();
    const nettesArrondies = composerBareme(rr.lignes, parametres).lignes.map((l) => l.arrondi.nette.toFixed());
    expect(nettesArrondies[1]).toBe("20960");
    expect(vol.composantes!.reduce((s, c) => s + Number(c.primeNette), 0)).toBe(20960);
  });

  it("une garantie à une seule composante la porte aussi (la fiche n'en fait pas de sous-ligne)", () => {
    const { r } = cas1();
    expect(r.lignes[0].composantes).toHaveLength(1);
    expect(r.lignes[0].composantes![0].primeNette).toBe("20891");
  });

  it("aucun montant de la ligne ne bouge : le total reste 139 420 F (nette 113 851, accessoires 15 000, taxe 10 569)", () => {
    const { r, parametres } = cas1();
    const m = composerBareme(r.lignes, parametres);
    expect(m.totaux.arrondi.ttc.toFixed()).toBe("139420");
    expect(m.totaux.arrondi.nette.toFixed()).toBe("113851");
    expect(m.lignes.map((l) => l.arrondi.ttc.toFixed())).toEqual(["26315", "25161", "15551", "13406", "13406", "45581"]);
  });

  it("avec le prorata, les composantes suivent la garantie (même coefficient) : leur somme retombe sur la prime nette à une unité d'arrondi près", () => {
    const effet = ajouterJours(parametresEssai().dateEffet, 0);
    const { r, parametres } = cas1({ prorata: { actif: true }, dateEcheance: ajouterJours(effet, 99) });
    const vol = r.lignes[1];
    const somme = vol.composantes!.reduce((s, c) => s + Number(c.primeNette), 0);
    const nette = composerBareme(r.lignes, parametres).lignes[1].arrondi.nette.toNumber();
    expect(Math.abs(somme - nette)).toBeLessThanOrEqual(1);
    expect(composerBareme(r.lignes, parametres).totaux.arrondi.ttc.toFixed()).not.toBe("139420");
  });

  it("libellé d'une composante : son code lisible", () => {
    expect(libelleDeComposante("caisse")).toBe("Caisse");
    expect(libelleDeComposante("vol_caisse")).toBe("Vol caisse");
  });
});

describe("reconstitution pour une cotation antérieure (même méthode que D54 / D55)", () => {
  it("le recalcul du barème figé sur la saisie figée redonne code et composantes, identiques à ceux d'un calcul récent", () => {
    const { b, r } = cas1();
    const ancienne = compositionAncienne();
    expect(aDejaLeDetail(ancienne.lignes)).toBe(false);
    const lignes = lignesAvecDetail(b, ancienne, { actif: false });
    expect(lignes).not.toBeNull();
    expect(lignes!.map((l) => [l.code, l.composantes])).toEqual(r.lignes.map((l) => [l.code, l.composantes]));
    // Les montants figés ne sont jamais touchés.
    expect(lignes!.map((l) => [l.libelle, l.primeNette, l.accessoires, l.montantGaranti])).toEqual(ancienne.lignes.map((l) => [l.libelle, l.primeNette, l.accessoires, l.montantGaranti]));
  });

  it("la composition d'origine n'est pas modifiée (rien n'est écrit)", () => {
    const { b } = cas1();
    const ancienne = compositionAncienne();
    const avant = structuredClone(ancienne);
    const enrichie = compositionAvecDetail(ancienne, b, { actif: false });
    expect(ancienne).toEqual(avant);
    expect(enrichie).not.toBe(ancienne);
    expect(estCompositionBareme(enrichie) && aDejaLeDetail(enrichie.lignes)).toBe(true);
  });

  it("impossible (le recalcul ne retombe pas sur les lignes figées) : la composition est rendue telle quelle, sans détail", () => {
    const { b } = cas1();
    const ancienne = compositionAncienne();
    const alteree = { ...ancienne, lignes: ancienne.lignes.map((l, i) => (i === 1 ? { ...l, primeNette: String(Number(l.primeNette) + 1) } : l)) };
    expect(lignesAvecDetail(b, alteree, { actif: false })).toBeNull();
    expect(compositionAvecDetail(alteree, b, { actif: false })).toBe(alteree);
    // Barème introuvable : idem.
    expect(compositionAvecDetail(ancienne, null, { actif: false })).toBe(ancienne);
  });

  it("une saisie que le barème refuse maintenant ne lève jamais d'erreur : pas de détail", () => {
    const { b } = cas1();
    const ancienne = compositionAncienne();
    const refusee = { ...ancienne, bareme: { ...ancienne.bareme, saisie: { champs: {}, souscrit: [] } } };
    expect(lignesAvecDetail(b, refusee, { actif: false })).toBeNull();
  });

  it("une composition qui a déjà son détail ou qui n'est pas du barème est rendue telle quelle", () => {
    const { b, r, parametres } = cas1();
    const recente = { ...versComposition(r.lignes, parametres), origine: "BAREME" as const, bareme: compositionAncienne().bareme };
    expect(compositionAvecDetail(recente, b, { actif: false })).toBe(recente);
    const manuelle = versComposition(r.lignes, parametres);
    expect(compositionAvecDetail(manuelle, b, { actif: false })).toBe(manuelle);
  });
});
