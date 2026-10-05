import { describe, expect, it } from "vitest";

import { formaterNumero, formaterNumeroPolice, cleCompteur } from "./numerotation";
import { problemesAssures, problemesLignes, problemesRisque, problemesSouscripteur, type Assure, type Souscripteur } from "./saisie";
import {
  dateFinValidite,
  filigraneDe,
  peutAccepter,
  peutEtreValidee,
  peutModifier,
  peutRefuser,
  statutEffectif,
  STATUTS,
} from "./statuts";
import { detecterForcages, problemesForcage, raisonsDeValidation, valideurAutorise } from "./validation";

describe("validité d'une cotation : « date + 3 mois » (T1)", () => {
  it("ajoute le nombre de mois du produit à la date d'établissement", () => {
    expect(dateFinValidite("2026-10-05", 3)).toBe("2027-01-05");
    expect(dateFinValidite("2026-10-05", 1)).toBe("2026-11-05");
    expect(dateFinValidite("2026-10-05", 12)).toBe("2027-10-05");
  });

  it("garde le dernier jour du mois quand le mois d'arrivée est plus court", () => {
    expect(dateFinValidite("2026-11-30", 3)).toBe("2027-02-28");
    expect(dateFinValidite("2027-11-30", 3)).toBe("2028-02-29"); // année bissextile
    expect(dateFinValidite("2026-05-31", 1)).toBe("2026-06-30");
  });
});

describe("T11 : cotation expirée", () => {
  it("devient « Expirée » dès le lendemain de la fin de validité, pas avant", () => {
    expect(statutEffectif("EMISE", "2027-01-05", "2027-01-05")).toBe("EMISE"); // le dernier jour est encore valable
    expect(statutEffectif("EMISE", "2027-01-05", "2027-01-06")).toBe("EXPIREE");
  });

  it("n'expire que les cotations émises", () => {
    for (const s of ["BROUILLON", "A_VALIDER", "ACCEPTEE", "REFUSEE"] as const) {
      expect(statutEffectif(s, "2020-01-01", "2030-01-01"), s).toBe(s);
    }
    expect(statutEffectif("EXPIREE", "2020-01-01", "2030-01-01")).toBe("EXPIREE");
  });

  it("une cotation expirée ne peut être ni acceptée (transformation impossible) ni refusée, et porte le filigrane", () => {
    const expiree = statutEffectif("EMISE", "2027-01-05", "2027-02-01");

    expect(peutAccepter(expiree)).toBe(false);
    expect(peutRefuser(expiree)).toBe(false);
    expect(filigraneDe(expiree)).toBe("EXPIRÉE");
    expect(filigraneDe("EMISE")).toBeNull();
  });
});

describe("transitions (CDC §9.3)", () => {
  it("seul un brouillon se modifie ; seule une cotation émise s'accepte ou se refuse ; seule une cotation à valider se valide", () => {
    for (const s of STATUTS) {
      expect(peutModifier(s), `modifier ${s}`).toBe(s === "BROUILLON");
      expect(peutAccepter(s), `accepter ${s}`).toBe(s === "EMISE");
      expect(peutRefuser(s), `refuser ${s}`).toBe(s === "EMISE");
      expect(peutEtreValidee(s), `valider ${s}`).toBe(s === "A_VALIDER");
    }
  });
});

describe("T13 : forçage de prime et double validation (CDC §4.1)", () => {
  it("ne compte comme forcée qu'une prime qui diffère du tarif", () => {
    const f = detecterForcages([
      { code: "SOLO", primeTarif: "93581.33", primeForcee: "90000" },
      { code: "FAMILLE", primeTarif: "252657.63", primeForcee: "252657.63" }, // identique : pas un forçage
      { code: "AUTRE", primeTarif: "1000", primeForcee: null },
    ]);

    expect(f.map((x) => x.code)).toEqual(["SOLO"]);
    expect(f[0].ecart.toString()).toBe("-3581.33");
  });

  it("exige un motif dès qu'il y a forçage, même pour un écart minime", () => {
    const f = detecterForcages([{ code: "SOLO", primeTarif: "100", primeForcee: "100.01" }]);

    expect(problemesForcage(f, null)).toHaveLength(1);
    expect(problemesForcage(f, "   ")).toHaveLength(1);
    expect(problemesForcage(f, "abc")).toHaveLength(1);
    expect(problemesForcage(f, "Remise accordée par la direction")).toEqual([]);
    expect(problemesForcage([], null)).toEqual([]);
  });

  it("une prime forcée passe TOUJOURS en « À valider », quel que soit le montant", () => {
    const f = detecterForcages([{ code: "SOLO", primeTarif: "100", primeForcee: "99" }]);

    expect(raisonsDeValidation({ forcages: f, ttc: "1", seuil: "1000000000" })).toEqual(["PRIME_FORCEE"]);
  });

  it("le dépassement du seuil de TTC passe en « À valider » ; les deux raisons peuvent se cumuler", () => {
    const f = detecterForcages([{ code: "SOLO", primeTarif: "100", primeForcee: "99" }]);

    expect(raisonsDeValidation({ forcages: [], ttc: "5000001", seuil: "5000000" })).toEqual(["SEUIL_DEPASSE"]);
    expect(raisonsDeValidation({ forcages: [], ttc: "5000000", seuil: "5000000" })).toEqual([]);
    expect(raisonsDeValidation({ forcages: f, ttc: "6000000", seuil: "5000000" })).toEqual(["PRIME_FORCEE", "SEUIL_DEPASSE"]);
    expect(raisonsDeValidation({ forcages: [], ttc: "999999999", seuil: null })).toEqual([]);
  });

  it("l'auteur ne peut jamais valider sa propre cotation", () => {
    expect(valideurAutorise(12, 12)).toBe(false);
    expect(valideurAutorise(12, 13)).toBe(true);
  });
});

describe("numérotation COT-AAAA-MM-NNNN (CDC §11.4)", () => {
  it("formate année, mois d'émission et compteur sur 4 chiffres", () => {
    expect(formaterNumero("COT", "2026-10-05", 1)).toBe("COT-2026-10-0001");
    expect(formaterNumero("FAC", "2026-09-16", 3)).toBe("FAC-2026-09-0003"); // exemple du CDC
    expect(formaterNumero("AV", "2026-01-02", 12345)).toBe("AV-2026-01-12345");
  });

  it("le compteur est annuel : même clé toute l'année, nouvelle clé en janvier", () => {
    expect(cleCompteur("COT", "2026-01-01")).toBe("COT-2026");
    expect(cleCompteur("COT", "2026-12-31")).toBe("COT-2026");
    expect(cleCompteur("COT", "2027-01-01")).toBe("COT-2027");
    expect(cleCompteur("FAC", "2026-06-01")).not.toBe(cleCompteur("COT", "2026-06-01"));
  });

  it("refuse un compteur invalide", () => {
    expect(() => formaterNumero("COT", "2026-10-05", 0)).toThrow();
    expect(() => formaterNumero("COT", "2026-10-05", 1.5)).toThrow();
  });

  it("numéro de police provisoire, produit par une seule fonction", () => {
    expect(formaterNumeroPolice("2026-10-05", 42)).toBe("POL-2026-000042");
  });
});

describe("saisie : souscripteur, assurés, risque, formules", () => {
  const physique: Souscripteur = { type: "PHYSIQUE", nom: "KOUASSI", prenoms: "Awa", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" };
  const assure = (surcharge: Partial<Assure> = {}): Assure => ({ ordre: 1, nom_prenoms: "Test Inventé", date_naissance: "1990-05-15", sexe: "F", lien: "Souscripteur", formule: "SOLO", ...surcharge });

  it("souscripteur : nom pour une personne physique, raison sociale pour une personne morale", () => {
    expect(problemesSouscripteur(physique)).toEqual([]);
    expect(problemesSouscripteur({ ...physique, nom: " " })).toHaveLength(1);
    expect(problemesSouscripteur({ ...physique, type: "MORALE" })).toHaveLength(1);
    expect(problemesSouscripteur({ ...physique, type: "MORALE", raison_sociale: "ENTREPRISE TEST" })).toEqual([]);
    expect(problemesSouscripteur({ ...physique, email: "pas-un-courriel" })).toHaveLength(1);
  });

  it("assurés : le champ sexe du dictionnaire accepte M, F ou vide, et refuse le reste", () => {
    expect(problemesAssures([assure({ sexe: "M" }), assure({ sexe: "" })], ["SOLO"], "2026-10-05")).toEqual([]);
    expect(problemesAssures([assure({ sexe: "X" as "M" })], ["SOLO"], "2026-10-05")).toEqual(["Assuré n° 1 : sexe invalide (M ou F)."]);
  });

  it("assurés : nom obligatoire, date réelle et passée, formule connue", () => {
    expect(problemesAssures([assure({ nom_prenoms: "" })], ["SOLO"], "2026-10-05")).toHaveLength(1);
    expect(problemesAssures([assure({ date_naissance: "2026-02-30" })], ["SOLO"], "2026-10-05")).toHaveLength(1);
    expect(problemesAssures([assure({ date_naissance: "2030-01-01" })], ["SOLO"], "2026-10-05")).toHaveLength(1);
    expect(problemesAssures([assure({ formule: "NOPE" })], ["SOLO"], "2026-10-05")).toHaveLength(1);
  });

  it("risque : noms en minuscules du dictionnaire, valeurs bornées", () => {
    expect(problemesRisque({ marque: "Yamaha", nb_pieces: "3" })).toEqual([]);
    expect(problemesRisque({ "Marque!": "x" })).toHaveLength(1);
    expect(problemesRisque({ marque: "x".repeat(501) })).toHaveLength(1);
  });

  it("formules : de 1 au maximum du produit, distinctes, effectifs entiers", () => {
    expect(problemesLignes([{ codeFormule: "A", effectif: 3 }, { codeFormule: "B", effectif: 60 }], 3)).toEqual([]);
    expect(problemesLignes([], 3)).toHaveLength(1);
    expect(problemesLignes([1, 2, 3, 4].map((n) => ({ codeFormule: `F${n}`, effectif: 1 })), 3)).toHaveLength(1);
    expect(problemesLignes([{ codeFormule: "A", effectif: 1 }, { codeFormule: "A", effectif: 1 }], 3)).toHaveLength(1);
    expect(problemesLignes([{ codeFormule: "A", effectif: 0 }], 3)).toHaveLength(1);
  });
});
