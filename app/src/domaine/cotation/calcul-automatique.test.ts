import { describe, expect, it } from "vitest";

import { champsManquantsFormules, nomChangeLeCalcul } from "./calcul-automatique";

const COMPLET = { typeContrat: "INDIVIDUEL", dateEffet: "2026-11-05", dateEcheance: "2027-11-04", effectifs: ["", "3"] };

describe("champsManquantsFormules : « Complétez : … »", () => {
  it("saisie complète : rien ne manque, le calcul peut partir", () => {
    expect(champsManquantsFormules(COMPLET)).toEqual([]);
  });

  it("nomme chaque manque, dans l'ordre de l'écran", () => {
    expect(champsManquantsFormules({ typeContrat: "", dateEffet: "", dateEcheance: "", effectifs: ["", " "] })).toEqual([
      "Type de contrat",
      "Date d'effet",
      "Date d'échéance",
      "Effectif d'au moins une formule",
    ]);
  });

  it("un seul effectif suffit ; des espaces ne comptent pas", () => {
    expect(champsManquantsFormules({ ...COMPLET, effectifs: ["  ", "1"] })).toEqual([]);
    expect(champsManquantsFormules({ ...COMPLET, effectifs: ["   "] })).toEqual(["Effectif d'au moins une formule"]);
    expect(champsManquantsFormules({ ...COMPLET, typeContrat: "  " })).toEqual(["Type de contrat"]);
  });
});

describe("nomChangeLeCalcul : seuls les champs du calcul interrogent le serveur", () => {
  it("contrat, régime, dates, tranches", () => {
    for (const nom of ["typeContrat", "regimeTaxe", "dateEffet", "dateEcheance", "nombreTranches"]) expect(nomChangeLeCalcul(nom)).toBe(true);
  });

  it("effectif, prime forcée et accessoires de chaque formule", () => {
    for (const nom of ["eff_ESSENTIEL", "forcee_ESSENTIEL", "acc_CONFORT"]) expect(nomChangeLeCalcul(nom)).toBe(true);
  });

  it("souscripteur, assurés, motif, intermédiaires : non", () => {
    for (const nom of ["souscripteur_nom", "assure_nom", "motifForcage", "intermediaire", "codeProduit", "clientId", "benef_quote", "effectif", ""]) expect(nomChangeLeCalcul(nom)).toBe(false);
  });
});
