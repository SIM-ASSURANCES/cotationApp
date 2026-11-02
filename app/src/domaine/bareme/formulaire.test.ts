// Écran de cotation généré (B6a, D51) : le descripteur ne dévoile aucun tarif ; l'affichage des champs et des souscriptions suit les
// MÊMES règles que le moteur (le serveur recontrôle de toute façon) ; la conversion du formulaire donne la saisie du moteur.
import { describe, expect, it } from "vitest";

import { versionsProvisoiresSansBareme } from "../calcul/parametrage";
import { Contexte } from "./contexte";
import { ancrageDesChamps, champActif, champsManquants, composanteSouscrite, descripteurSaisie, etatDepuisSaisie, garantieSouscrite, saisieDepuisFormulaire, type EtatSaisie } from "./formulaire";
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

describe("ergonomie du formulaire (D62) : ancrage des champs sous leur case", () => {
  const { parCase, dansBloc } = ancrageDesChamps(d);

  it("un champ conditionné par une garantie ou une composante se range sous la case de celle-ci", () => {
    expect(parCase.get("vol.caisse")?.map((c) => c.code)).toEqual(["vol_caisse_montant"]);
    expect(parCase.get("dde")?.map((c) => c.code)).toEqual(["dde_montant"]);
    expect(parCase.get("vol.contenu")).toBeUndefined();
  });

  it("les autres champs (occupation, loyer…) restent dans leur bloc, et rien n'est perdu ni compté deux fois", () => {
    expect(dansBloc.map((c) => c.code)).toContain("loyer_mensuel");
    expect(dansBloc.map((c) => c.code)).not.toContain("dde_montant");
    const tous = [...dansBloc, ...[...parCase.values()].flat()].map((c) => c.code).sort();
    expect(tous).toEqual(d.champs.map((c) => c.code).sort());
  });

  it("un champ qui dépend d'un champ de garantie le suit ; une condition sur une garantie inconnue le laisse dans son bloc", () => {
    const champs = [
      ...d.champs,
      { code: "precision", libelle: "Précision", type: "TEXTE" as const, obligatoire: false, si: { champ: "dde_montant", different: "0" } },
      { code: "orphelin", libelle: "Orphelin", type: "TEXTE" as const, obligatoire: false, si: { souscrit: "fantome" } },
    ];
    const a = ancrageDesChamps({ ...d, champs });
    expect(a.parCase.get("dde")?.map((c) => c.code)).toEqual(["dde_montant", "precision"]);
    expect(a.dansBloc.map((c) => c.code)).toContain("orphelin");
  });

  it("l'ancrage ne change pas les conditions : le champ n'est actif que si la case est cochée", () => {
    for (const c of parCase.get("dde") ?? []) {
      expect(champActif(d, { champs: {}, souscrit: [] }, c.code)).toBe(false);
      expect(champActif(d, { champs: {}, souscrit: ["dde"] }, c.code)).toBe(true);
    }
  });
});

describe("ergonomie du formulaire (D62) : champs obligatoires visibles manquants (déclenchent le calcul automatique ou « Complétez »)", () => {
  const vide: EtatSaisie = { champs: {}, souscrit: [] };

  it("liste les libellés des obligatoires visibles non remplis, dans l'ordre du barème", () => {
    const manque = champsManquants(d, vide, "");
    expect(manque.length).toBeGreaterThan(0);
    expect(manque).toContain(d.champs.find((c) => c.code === "type_commerce")!.libelle);
  });

  it("un champ masqué par sa condition n'est jamais demandé (le loyer d'un propriétaire, le montant d'une garantie décochée)", () => {
    const libelle = (code: string) => d.champs.find((c) => c.code === code)!.libelle;
    const manque = champsManquants(d, { champs: { occupation: ["PROPRIETAIRE"] }, souscrit: [] }, "");
    expect(manque).not.toContain(libelle("loyer_mensuel"));
    expect(manque).not.toContain(libelle("dde_montant"));
    expect(manque).toContain(libelle("valeur_batiment"));
    // La garantie cochée rend son montant obligatoire.
    expect(champsManquants(d, { champs: {}, souscrit: ["dde"] }, "")).toContain(libelle("dde_montant"));
  });

  it("une saisie complète ne manque de rien ; un espace seul ne compte pas pour rempli", () => {
    const complet: EtatSaisie = { champs: {}, souscrit: [] };
    for (const c of d.champs) complet.champs[c.code] = [c.valeurs?.[0]?.v ?? "1"];
    complet.champs.occupation = ["LOCATAIRE"];
    expect(champsManquants(d, complet, "")).toEqual([]);
    expect(champsManquants(d, { ...complet, champs: { ...complet.champs, stocks: ["  "] } }, "")).toContain(d.champs.find((c) => c.code === "stocks")!.libelle);
  });

  it("l'effectif est demandé quand le barème tarife par tête", () => {
    const parTete = { ...d, effectif: true };
    expect(champsManquants(parTete, vide, "")).toContain("Nombre d'assurés");
    expect(champsManquants(parTete, vide, "12")).not.toContain("Nombre d'assurés");
    expect(champsManquants(d, vide, "")).not.toContain("Nombre d'assurés");
  });
});
