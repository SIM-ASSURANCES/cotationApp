// Écran de cotation généré (B6a, D51) : le descripteur ne dévoile aucun tarif ; l'affichage des champs et des souscriptions suit les
// MÊMES règles que le moteur (le serveur recontrôle de toute façon) ; la conversion du formulaire donne la saisie du moteur.
import { describe, expect, it } from "vitest";

import { versionsProvisoiresSansBareme } from "../calcul/parametrage";
import { Contexte } from "./contexte";
import { champActif, composanteSouscrite, descripteurSaisie, etatDepuisSaisie, garantieSouscrite, saisieDepuisFormulaire, type EtatSaisie } from "./formulaire";
import { baremeSecurpro } from "./securpro-fixture";

const b = baremeSecurpro();
const d = descripteurSaisie(b);

describe("descripteur de l'écran de cotation", () => {
  it("porte les blocs, champs, garanties et composantes, sans aucun taux, table, coefficient ni assiette", () => {
    const json = JSON.stringify(d);
    for (const secret of ["taux_incendie", "secu_incendie", "coef_vol", "limites", "0.864", "1.24416", "PCT_PLAFOND", "capitaux_totaux", "assiette", "\"taux\"", "minimum", "ne peut pas être assuré"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(d.blocs.map((x) => x.code)).toEqual(["local", "capitaux", "garanties"]);
    expect(d.champs.find((c) => c.code === "type_commerce")?.valeurs?.[0]).toEqual({ v: "BUREAU", l: "Bureau" });
    expect(d.garanties.find((g) => g.code === "vol")?.composantes).toEqual([
      { code: "contenu", optionnelle: true },
      { code: "caisse", optionnelle: true },
    ]);
    expect(d.effectif).toBe(false); // accessoires par garantie : pas d'effectif
  });

  it("demande l'effectif quand un accessoire est par tête ou par tranche", () => {
    expect(descripteurSaisie({ ...b, produit: { ...b.produit, accessoires: { mode: "PAR_TETE", montant: "100" } } }).effectif).toBe(true);
    expect(descripteurSaisie({ ...b, produit: { ...b.produit, accessoires: { mode: "PAR_TRANCHE", tranches: [{ de: 1, a: 5, montant: "100" }] } } }).effectif).toBe(true);
  });
});

describe("conditions d'affichage : le navigateur et le moteur s'accordent", () => {
  const locataire = { champs: { occupation: ["LOCATAIRE"], gardien: ["OUI"] }, souscrit: ["vol.caisse"] };
  const proprietaire = { champs: { occupation: ["PROPRIETAIRE"] }, souscrit: [] };

  it("le loyer ne s'affiche que pour un locataire, la valeur du bâtiment que pour un propriétaire", () => {
    expect(champActif(d, locataire, "loyer_mensuel")).toBe(true);
    expect(champActif(d, locataire, "valeur_batiment")).toBe(false);
    expect(champActif(d, proprietaire, "loyer_mensuel")).toBe(false);
    expect(champActif(d, proprietaire, "valeur_batiment")).toBe(true);
    expect(champActif(d, { champs: {}, souscrit: [] }, "loyer_mensuel")).toBe(false); // occupation pas encore choisie
  });

  it("le montant d'une garantie n'apparaît que si la garantie (ou la composante) est souscrite", () => {
    expect(champActif(d, locataire, "vol_caisse_montant")).toBe(true);
    expect(champActif(d, locataire, "dde_montant")).toBe(false);
    expect(champActif(d, { champs: {}, souscrit: ["dde"] }, "dde_montant")).toBe(true);
    expect(champActif(d, { champs: {}, souscrit: ["vol.contenu"] }, "vol_caisse_montant")).toBe(false);
  });

  it("souscription : obligatoire toujours, optionnelle si cochée, composante par composante", () => {
    expect(garantieSouscrite(d, { champs: {}, souscrit: [] }, "incendie")).toBe(true);
    expect(garantieSouscrite(d, { champs: {}, souscrit: [] }, "vol")).toBe(false);
    expect(garantieSouscrite(d, { champs: {}, souscrit: ["vol.caisse"] }, "vol")).toBe(true);
    expect(composanteSouscrite(d, { champs: {}, souscrit: ["vol.caisse"] }, "vol", "contenu")).toBe(false);
    expect(composanteSouscrite(d, { champs: {}, souscrit: ["vol.caisse"] }, "vol", "caisse")).toBe(true);
  });

  it("même résultat que le moteur sur plusieurs états (tous les champs, toutes les garanties)", () => {
    const etats: EtatSaisie[] = [locataire, proprietaire, { champs: { occupation: ["LOCATAIRE"] }, souscrit: ["dde", "tri", "vol.contenu"] }, { champs: {}, souscrit: [] }];
    for (const e of etats) {
      const saisie = saisieDepuisFormulaire(b, e);
      const ctx = new Contexte(b, saisie);
      for (const c of d.champs) expect(champActif(d, e, c.code), `${c.code} avec ${JSON.stringify(e)}`).toBe(ctx.estActif(c.code));
      for (const g of b.garanties) expect(garantieSouscrite(d, e, g.code), g.code).toBe(ctx.garantieSouscrite(g));
    }
  });
});

describe("conversion du formulaire en saisie du moteur", () => {
  it("oui/non en booléens, montants en textes, champs vides omis, souscriptions dédoublonnées, effectif entier", () => {
    const s = saisieDepuisFormulaire(b, {
      champs: { gardien: ["OUI"], extincteurs: ["NON"], camera: [""], stocks: [" 6866500 "], occupation: ["LOCATAIRE"], inconnu: ["x"] },
      souscrit: ["incendie", "vol.caisse", "vol.caisse", " "],
      effectif: "12",
    });
    expect(s).toEqual({ champs: { gardien: true, extincteurs: false, stocks: "6866500", occupation: "LOCATAIRE" }, souscrit: ["incendie", "vol.caisse"], effectif: 12 });
    expect(Number.isNaN(saisieDepuisFormulaire(b, { champs: {}, souscrit: [], effectif: "abc" }).effectif)).toBe(true);
    expect(saisieDepuisFormulaire(b, { champs: {}, souscrit: [], effectif: "" }).effectif).toBeUndefined();
  });

  it("les valeurs d'une saisie enregistrée reviennent dans le formulaire (modification d'un brouillon)", () => {
    const e = etatDepuisSaisie({ champs: { gardien: true, extincteurs: false, stocks: "100", choix: ["a", "b"] }, souscrit: ["incendie"] });
    expect(e).toEqual({ champs: { gardien: ["OUI"], extincteurs: ["NON"], stocks: ["100"], choix: ["a", "b"] }, souscrit: ["incendie"] });
    expect(etatDepuisSaisie(undefined)).toEqual({ champs: {}, souscrit: [] });
  });
});

describe("alerte H140 : version future sans barème publié", () => {
  const versions = [
    { id: 1, dateEffet: "2026-12-01", modeTarification: "GARANTIES" },
    { id: 2, dateEffet: "2026-11-10", modeTarification: "GARANTIES" },
    { id: 3, dateEffet: "2026-11-20", modeTarification: "GARANTIES" },
    { id: 4, dateEffet: "2026-11-15", modeTarification: "BAREME" },
    { id: 5, dateEffet: "2026-11-15", modeTarification: "FORMULE" },
    { id: 6, dateEffet: "2026-10-01", modeTarification: "GARANTIES" },
  ];
  it("liste les versions futures par garanties dont le barème n'est pas publié, la plus proche d'abord, avec les jours restants", () => {
    const r = versionsProvisoiresSansBareme(versions, new Set([3]), "2026-11-01");
    expect(r.map((v) => [v.id, v.joursRestants])).toEqual([[2, 9], [1, 30]]);
  });
  it("rien à signaler si tout est publié, déjà au barème, à la formule ou déjà en vigueur", () => {
    expect(versionsProvisoiresSansBareme(versions, new Set([1, 2, 3]), "2026-11-01")).toEqual([]);
  });
  it("une version qui prend effet aujourd'hui n'est plus « future »", () => {
    expect(versionsProvisoiresSansBareme([{ id: 1, dateEffet: "2026-11-01", modeTarification: "GARANTIES" }], new Set(), "2026-11-01")).toEqual([]);
  });
});
