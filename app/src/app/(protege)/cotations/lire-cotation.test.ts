import { describe, expect, it } from "vitest";

import { problemesAssures, problemesLignes, problemesRisque, problemesSouscripteur } from "@/domaine/cotation/saisie";

import { lireCotation } from "./lire-cotation";

function formulaire(champs: [string, string][]): FormData {
  const d = new FormData();
  for (const [k, v] of champs) d.append(k, v);
  return d;
}

const base: [string, string][] = [
  ["codeProduit", "BENI"], ["clientId", ""], ["souscripteur_type", "PHYSIQUE"], ["souscripteur_nom", "KOUADIO"], ["souscripteur_prenoms", "Test"],
  ["dateEffet", "2026-01-01"], ["dateEcheance", "2026-12-31"], ["nombreTranches", "4"], ["motifForcage", ""],
  ["eff_SOLO", "3"], ["forcee_SOLO", ""], ["eff_FAMILLE", "60"], ["forcee_FAMILLE", ""],
];

describe("lireCotation : formulaire -> saisie", () => {
  it("lit la cotation T1 (3 Solo, 60 Famille) avec des effectifs entiers et aucun forçage", () => {
    const s = lireCotation(formulaire(base));

    expect(s.codeProduit).toBe("BENI");
    expect(s.lignes).toEqual([
      { codeFormule: "SOLO", effectif: 3, primeForcee: null },
      { codeFormule: "FAMILLE", effectif: 60, primeForcee: null },
    ]);
    expect(s.nombreTranches).toBe(4);
    expect(s.clientId).toBeNull();
    expect(problemesSouscripteur(s.souscripteur)).toEqual([]);
    expect(problemesLignes(s.lignes, 3)).toEqual([]);
  });

  it("exclut une formule dont l'effectif est vide et garde la prime forcée en TEXTE", () => {
    const s = lireCotation(formulaire([...base.filter(([k]) => !["eff_FAMILLE", "forcee_SOLO"].includes(k)), ["eff_FAMILLE", ""], ["forcee_SOLO", "80000,5"]]));

    expect(s.lignes).toHaveLength(1);
    expect(s.lignes[0].primeForcee).toBe("80000,5");
    expect(typeof s.lignes[0].primeForcee).toBe("string");
  });

  it("un effectif illisible devient NaN, refusé ensuite avec un message clair", () => {
    const s = lireCotation(formulaire([...base.filter(([k]) => k !== "eff_SOLO"), ["eff_SOLO", "3,5"]]));

    expect(problemesLignes(s.lignes, 3).join(" ")).toContain("entier");
  });

  it("lit les assurés (sexe compris) en ignorant les lignes vides, et numérote l'ordre", () => {
    const s = lireCotation(formulaire([
      ...base,
      ["assure_nom", "Awa Test"], ["assure_naissance", "1990-05-15"], ["assure_sexe", "F"], ["assure_lien", "Souscripteur"], ["assure_formule", "SOLO"],
      ["assure_nom", ""], ["assure_naissance", ""], ["assure_sexe", ""], ["assure_lien", ""], ["assure_formule", ""],
      ["assure_nom", "Koffi Test"], ["assure_naissance", ""], ["assure_sexe", "M"], ["assure_lien", "Enfant"], ["assure_formule", "FAMILLE"],
    ]));

    expect(s.assures.map((a) => [a.ordre, a.nom_prenoms, a.sexe])).toEqual([[1, "Awa Test", "F"], [2, "Koffi Test", "M"]]);
    expect(problemesAssures(s.assures, ["SOLO", "FAMILLE"], "2026-10-05")).toEqual([]);
  });

  it("lit les champs risque.* en minuscules, sans les lignes sans nom", () => {
    const s = lireCotation(formulaire([...base, ["risque_cle", "Marque"], ["risque_valeur", "Yamaha"], ["risque_cle", ""], ["risque_valeur", "orphelin"]]));

    expect(s.risque).toEqual({ marque: "Yamaha" });
    expect(problemesRisque(s.risque)).toEqual([]);
  });

  it("lit l'identifiant d'une cotation à modifier et le client choisi", () => {
    const s = lireCotation(formulaire([...base.filter(([k]) => k !== "clientId"), ["id", "42"], ["clientId", "7"]]));

    expect(s.id).toBe(42);
    expect(s.clientId).toBe(7);
  });
});
