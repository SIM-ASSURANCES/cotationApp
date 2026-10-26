import { describe, expect, it } from "vitest";

import { lireBareme } from "./schema";
import { documentSecurpro } from "./securpro-fixture";
import { verifierBareme } from "./verification";

type Doc = typeof documentSecurpro;
const variante = (modifie: (d: Doc) => void) => {
  const d = structuredClone(documentSecurpro);
  modifie(d);
  return verifierBareme(lireBareme(d), { publication: true });
};
const codes = (p: { code: string }[]) => p.map((x) => x.code);

describe("lireBareme : le schéma zod", () => {
  it("refuse une clé inconnue, un nombre écrit en virgule et une garantie sans composante", () => {
    expect(() => lireBareme({ ...documentSecurpro, nouveau: 1 })).toThrow();
    const d = structuredClone(documentSecurpro);
    d.tables[0].lignes["1"] = "0,72";
    expect(() => lireBareme(d)).toThrow();
    const e = structuredClone(documentSecurpro);
    e.garanties[0].composantes = [];
    expect(() => lireBareme(e)).toThrow();
  });
});

describe("verifierBareme : intégrité", () => {
  it("champ supprimé encore lu par un sous-jacent, une assiette ou une table", () => {
    const p = variante((d) => {
      d.champs = d.champs.filter((c) => c.code !== "gardien");
    });
    expect(p.map((x) => x.message)).toContain("Table « secu_incendie » : le champ « gardien » n'existe pas.");
  });
  it("garantie qui lit un champ inexistant", () => {
    expect(codes(variante((d) => { d.garanties[2].composantes[0].assiette = "fantome"; }))).toContain("REFERENCE_INCONNUE");
  });
  it("table incomplète et ligne en trop", () => {
    expect(codes(variante((d) => { delete (d.tables[1].lignes as unknown as Record<string, string>)["OUI|NON"]; }))).toContain("TABLE_INCOMPLETE");
    expect(codes(variante((d) => { (d.tables[0].lignes as unknown as Record<string, string>)["9"] = "1"; }))).toContain("LIGNE_INCONNUE");
  });
  it("valeur intermédiaire lue avant sa définition, ou qui se lit elle-même", () => {
    expect(codes(variante((d) => { d.intermediaires.reverse(); }))).toContain("REFERENCE_EN_AVANT");
  });
  it("sous-jacent E1 sur un taux fixe, deux E1 sur la même composante, E1 absent", () => {
    expect(codes(variante((d) => { d.sousJacents.push({ code: "x", effet: "E1", table: "taux_incendie", cibles: ["dde"] } as never); }))).toContain("E1_SUR_TAUX_FIXE");
    expect(codes(variante((d) => { d.sousJacents.push({ code: "x", effet: "E1", table: "taux_incendie", cibles: ["incendie"] } as never); }))).toContain("TAUX_SANS_SOURCE");
    expect(codes(variante((d) => { d.sousJacents = d.sousJacents.filter((s) => s.code !== "classe"); }))).toContain("TAUX_SANS_SOURCE");
  });
  it("cible inconnue, réduction sur une composante, table inconnue", () => {
    expect(codes(variante((d) => { d.sousJacents.push({ code: "x", effet: "E2", table: "secu_incendie", cibles: ["fantome"] } as never); }))).toContain("CIBLE_INCONNUE");
    expect(codes(variante((d) => { d.sousJacents.push({ code: "x", effet: "E2", table: "secu_incendie", cibles: ["vol.caisse"], reduction: true } as never); }))).toContain("CIBLE_REDUCTION");
    expect(codes(variante((d) => { d.sousJacents.push({ code: "x", effet: "E2", table: "fantome", cibles: ["vol"] } as never); }))).toContain("REFERENCE_INCONNUE");
  });
  it("codes en double, cycle de conditions d'affichage, liste vide, condition manquante", () => {
    expect(codes(variante((d) => { d.garanties[3].code = "dde"; }))).toContain("CODE_EN_DOUBLE");
    expect(codes(variante((d) => { (d.champs[7] as { si: unknown }).si = { champ: "valeur_batiment", egal: "X" }; (d.champs[8] as { si: unknown }).si = { champ: "loyer_mensuel", egal: "X" }; }))).toContain("CYCLE");
    expect(codes(variante((d) => { (d.champs[1] as { valeurs: unknown[] }).valeurs = []; }))).toContain("LISTE_VIDE");
    expect(codes(variante((d) => { (d.garanties[2] as { souscription: string }).souscription = "CONDITION"; }))).toContain("CONDITION_MANQUANTE");
  });
  it("publication : au moins un jeu d'essai", () => {
    expect(codes(variante((d) => { d.jeuxEssai = []; }))).toEqual(["AUCUN_ESSAI"]);
  });
});
