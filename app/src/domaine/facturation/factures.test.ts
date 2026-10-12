import { describe, expect, it } from "vitest";

import type { FormuleSource } from "../documents/donnees";
import {
  contenuAvoir,
  controlerImputation,
  controlerPaiement,
  controlerRestitution,
  envoyeARetenu,
  etatPaiements,
  imputationProposee,
  periodeRenouvellement,
  problemesEnvoyeA,
  type ContenuFacture,
  type PaiementEnregistre,
} from "./factures";

const paiement = (montant: string, numero = "REC-2026-10-0001"): PaiementEnregistre => ({ numero, date: "2026-10-08", montant, reference: "VIR-1", canal: "VIREMENT", payeur: "YAO" });

describe("soldes et échéances (CDC §11.1, §12, H49)", () => {
  const echeances = [1, 2, 3, 4].map((numero) => ({ numero, date: `2026-0${numero}-01`, montant: "2898000" }));

  it("T2 : sans paiement, tout reste dû et aucune échéance n'est payée", () => {
    const e = etatPaiements("11592000", echeances, []);
    expect(e).toMatchObject({ totalPaye: "0", restantDu: "11592000", paiements: [] });
    expect(e.echeances.map((x) => x.statut)).toEqual(["Non payé", "Non payé", "Non payé", "Non payé"]);
  });

  it("les échéances se marquent payées dans l'ordre ; une échéance couverte en partie reste « Non payé »", () => {
    const e = etatPaiements("11592000", echeances, [paiement("2898000"), paiement("2000000", "REC-2026-10-0002")]);
    expect(e.echeances.map((x) => x.statut)).toEqual(["Payé", "Non payé", "Non payé", "Non payé"]);
    expect(e.paiements.map((p) => p.restantDu)).toEqual(["8694000", "6694000"]);
    expect(e).toMatchObject({ totalPaye: "4898000", restantDu: "6694000" });
    expect(etatPaiements("11592000", echeances, [paiement("5796000")]).echeances.map((x) => x.statut)).toEqual(["Payé", "Payé", "Non payé", "Non payé"]);
  });

  it("T3 : paiement de 41 000 sur 122 443 (HT 120 633, taxe 1 810) : restant dû 81 443", () => {
    expect(etatPaiements("122443", [], [paiement("41000")])).toMatchObject({ totalPaye: "41000", restantDu: "81443", echeances: [] });
  });
});

describe("contrôles d'un paiement (CDC §12, H33)", () => {
  const emise = { statut: "EMISE" as const, type: "AFFAIRE_NOUVELLE" as const, numero: "FAC-2026-10-0001", restantDu: "122443" };
  const saisie = { date: "2026-10-08", montant: "41 000", canal: "VIREMENT", reference: "VIR-1", payeur: "" };

  it("accepte un montant au format français et le renvoie en écriture canonique", () => {
    expect(controlerPaiement(saisie, emise, "2026-10-08")).toEqual({ problemes: [], montant: "41000", excedent: "0" });
  });

  it("accepte un trop-perçu : la part au-delà du restant dû est l'excédent, versé en avance (H33, 09/10/2026)", () => {
    expect(controlerPaiement({ ...saisie, montant: "130 000" }, emise, "2026-10-08")).toEqual({ problemes: [], montant: "130000", excedent: "7557" });
    expect(controlerPaiement({ ...saisie, montant: "122443" }, emise, "2026-10-08")).toEqual({ problemes: [], montant: "122443", excedent: "0" });
    // Facture déjà soldée : rien à régler, la somme va sur la facture suivante ou se restitue.
    expect(controlerPaiement(saisie, { ...emise, restantDu: "0" }, "2026-10-08").problemes.join(" ")).toMatch(/déjà soldée/);
  });

  it("le solde d'une facture ne compte que la part réglée d'un paiement (hors excédent)", () => {
    const e = etatPaiements("122443", [], [paiement("41000"), { ...paiement("90000", "REC-2026-10-0002"), excedent: "8557" }]);
    expect(e).toMatchObject({ totalPaye: "122443", restantDu: "0" });
    expect(e.paiements.map((p) => p.restantDu)).toEqual(["81443", "0"]);
  });

  it.each([
    ["montant nul", { montant: "0" }, /supérieur à 0/],
    ["montant négatif", { montant: "-5" }, /négatif/],
    ["montant ambigu", { montant: "1.234,5" }, /Montant invalide/],
    ["date future", { date: "2026-10-09" }, /futur/],
    ["canal inconnu", { canal: "BITCOIN" }, /Canal/],
    ["virement sans référence", { reference: "" }, /référence/],
  ])("refuse : %s", (_nom, surcharge, message) => {
    expect(controlerPaiement({ ...saisie, ...surcharge }, emise, "2026-10-08").problemes.join(" ")).toMatch(message);
  });

  it("refuse un paiement sur une facture annulée, sur un avoir ou sur un brouillon", () => {
    expect(controlerPaiement(saisie, { ...emise, statut: "ANNULEE" }, "2026-10-08").problemes.join(" ")).toMatch(/annulée par un avoir/);
    expect(controlerPaiement(saisie, { ...emise, type: "AVOIR" }, "2026-10-08").problemes.join(" ")).toMatch(/avoir ne se paie pas/);
    expect(controlerPaiement(saisie, { ...emise, statut: "BROUILLON", numero: null }, "2026-10-08").problemes.join(" ")).toMatch(/émise/);
    expect(controlerPaiement({ ...saisie, canal: "ESPECES", reference: "" }, emise, "2026-10-08").problemes).toEqual([]);
  });
});

describe("avance sur police : imputation et restitution (H33, 09/10/2026)", () => {
  const emise = { statut: "EMISE" as const, type: "AFFAIRE_NOUVELLE" as const, restantDu: "81443" };

  it("propose le plus petit de l'avance et du restant dû", () => {
    expect(imputationProposee("18557", "81443")).toBe("18557");
    expect(imputationProposee("100000", "81443")).toBe("81443");
    expect(imputationProposee("0", "81443")).toBe("0");
  });

  it("une imputation ne dépasse ni l'avance disponible ni le restant dû, et ne vise qu'une facture émise", () => {
    expect(controlerImputation("10 000", "18557", emise)).toEqual({ problemes: [], montant: "10000" });
    expect(controlerImputation("20000", "18557", emise).problemes.join(" ")).toMatch(/dépasse l'avance disponible/);
    expect(controlerImputation("90000", "100000", emise).problemes.join(" ")).toMatch(/restant dû/);
    expect(controlerImputation("10", "100", { ...emise, statut: "ANNULEE" }).problemes.join(" ")).toMatch(/émise et en cours/);
    expect(controlerImputation("0", "100", emise).problemes.join(" ")).toMatch(/supérieur à 0/);
  });

  it("une restitution porte date, montant, canal et référence, sans dépasser l'avance", () => {
    const r = { date: "2026-10-08", montant: "18557", canal: "VIREMENT", reference: "VIR-REMB-1" };
    expect(controlerRestitution(r, "18557", "2026-10-08")).toEqual({ problemes: [], montant: "18557" });
    expect(controlerRestitution({ ...r, montant: "18558" }, "18557", "2026-10-08").problemes.join(" ")).toMatch(/dépasse l'avance/);
    expect(controlerRestitution({ ...r, reference: "" }, "18557", "2026-10-08").problemes.join(" ")).toMatch(/référence/);
    expect(controlerRestitution({ ...r, date: "2026-10-09" }, "18557", "2026-10-08").problemes.join(" ")).toMatch(/futur/);
  });
});

describe("avoir, « Envoyé à », renouvellement", () => {
  const formule: FormuleSource = { code: "SOLO", libelle: "Solo", tauxCouverture: null, effectif: 1, primeUnitaire: "120633", primeParAssure: "122443", nette: "120633", accessoires: "0", taxe: "1810", ttc: "122443" };
  const contenu = { formules: [formule], totaux: { nette: "120633", accessoires: "0", taxe: "1810", ttc: "122443" }, echeances: [{ numero: 1, date: "2026-07-22", montant: "122443" }], entree: {} } as unknown as ContenuFacture;

  it("un avoir reprend les montants de la facture en négatif, sans échéancier (zéro reste zéro)", () => {
    const a = contenuAvoir(contenu);
    expect(a.totaux).toEqual({ nette: "-120633", accessoires: "0", taxe: "-1810", ttc: "-122443" });
    expect(a.formules[0]).toMatchObject({ nette: "-120633", accessoires: "0", ttc: "-122443", primeParAssure: "-122443" });
    expect(a.echeances).toEqual([]);
    expect(a.entree).toBeNull();
  });

  it("« Envoyé à » est masqué (null) s'il est vide ou identique à « Facturé à »", () => {
    const factureA = { nom: "YAO Fowoundi", adresse: "Cocody" };
    expect(envoyeARetenu(null, factureA)).toBeNull();
    expect(envoyeARetenu({ nom: " ", adresse: "" }, factureA)).toBeNull();
    expect(envoyeARetenu({ nom: "yao  fowoundi", adresse: "COCODY " }, factureA)).toBeNull();
    expect(envoyeARetenu({ nom: "CABINET EXEMPLE", adresse: "Plateau" }, factureA)).toEqual({ nom: "CABINET EXEMPLE", adresse: "Plateau" });
    expect(problemesEnvoyeA({ nom: "CABINET", adresse: "" })).toHaveLength(1);
  });

  it("renouvellement : du lendemain de l'échéance, pour un an", () => {
    expect(periodeRenouvellement("2026-12-31")).toEqual({ dateEffet: "2027-01-01", dateEcheance: "2027-12-31" });
    expect(periodeRenouvellement("2027-07-21")).toEqual({ dateEffet: "2027-07-22", dateEcheance: "2028-07-21" });
  });
});
