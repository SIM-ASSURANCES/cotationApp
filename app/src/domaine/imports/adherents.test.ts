// Session 5a, import en masse (CDC §13) : contrôles ligne par ligne, purs. Données inventées.
import { describe, expect, it } from "vitest";

import { problemesVersion, type VersionSaisie } from "../calcul/parametrage";
import { adherentDeLigne, ageRevolu, cleDEntete, controlerLignes, lireDate, type ContexteControle, type LigneBrute } from "./adherents";

const ctx: ContexteControle = {
  dateEffet: "2026-07-01",
  aujourdhui: "2026-10-09",
  formulesProduit: new Map([
    ["SOLO", { ageMin: 18, ageMax: 65 }],
    ["FAMILLE", { ageMin: null, ageMax: null }],
    ["SENIOR", { ageMin: 60, ageMax: null }],
  ]),
  formulesPolice: ["SOLO", "FAMILLE"],
  adherents: [{ ordre: 1, nom_prenoms: "Kouamé Éric", date_naissance: "1985-05-05", sexe: "M", lien: "Salarié", formule: "SOLO" }],
  numerosPris: new Set(["TST-2026-000001-G00001"]),
  numeroPolice: "TST-2026-000001-G00000",
  prochainOrdre: 2,
};

let n = 1;
const ligne = (c: Partial<LigneBrute["cellules"]> = {}): LigneBrute => ({
  numero: ++n,
  cellules: { numero_certificat: `TST-2026-000001-G${String(n).padStart(5, "0")}`, nom_prenoms: `Adhérent ${n} Inventé`, date_naissance: "14/03/1988", sexe: "F", lien: "Salarié", formule: "SOLO", ...c },
});
const messages = (l: LigneBrute, contexte = ctx) => controlerLignes([l], contexte)[0].erreurs.map((e) => `${e.colonne} : ${e.message}`);

describe("lecture des cellules", () => {
  it("dates : JJ/MM/AAAA, AAAA-MM-JJ et cellule date d'Excel ; refuse un nombre seul et une date impossible", () => {
    expect(lireDate("14/03/1988")).toBe("1988-03-14");
    expect(lireDate("4/3/1988")).toBe("1988-03-04");
    expect(lireDate("1988-03-14")).toBe("1988-03-14");
    expect(lireDate(new Date(Date.UTC(1988, 2, 14)))).toBe("1988-03-14");
    expect(lireDate(32216)).toBeNull();
    expect(lireDate("31/02/1988")).toBeNull();
    expect(lireDate("14-03-1988")).toBeNull();
  });

  it("en-têtes : noms du dictionnaire, sans casse ni accents, avec ou sans « assures[]. »", () => {
    expect(cleDEntete("nom_prenoms")).toBe("nom_prenoms");
    expect(cleDEntete(" Assures[].Date_Naissance ")).toBe("date_naissance");
    expect(cleDEntete("Numéro certificat")).toBe("numero_certificat");
    expect(cleDEntete("Numéro du certificat")).toBeNull();
    expect(cleDEntete("numero_certificat")).toBe("numero_certificat");
  });

  it("âge révolu, anniversaire compris", () => {
    expect(ageRevolu("1988-07-01", "2026-07-01")).toBe(38);
    expect(ageRevolu("1988-07-02", "2026-07-01")).toBe(37);
    expect(ageRevolu("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageRevolu("2008-02-29", "2026-03-01")).toBe(18);
  });
});

describe("contrôles ligne par ligne (CDC §13)", () => {
  it("une ligne correcte n'a aucune erreur ; ses données sont normalisées (date ISO, sexe et formule en majuscules)", () => {
    const [r] = controlerLignes([ligne({ sexe: "f", formule: "solo", numero_certificat: " tst-2026-000001-g09999 " })], ctx);
    expect(r.erreurs).toEqual([]);
    expect(r.donnees).toMatchObject({ date_naissance: "1988-03-14", sexe: "F", formule: "SOLO", numero_certificat: "TST-2026-000001-G09999" });
  });

  it("champs obligatoires vides : nom, date de naissance, formule ; numéro, sexe et lien facultatifs", () => {
    expect(messages(ligne({ nom_prenoms: "  " }))).toEqual(["nom_prenoms : Champ obligatoire vide."]);
    expect(messages(ligne({ numero_certificat: null }))).toEqual([]);
    expect(messages(ligne({ date_naissance: "" }))).toEqual(["date_naissance : Champ obligatoire vide."]);
    expect(messages(ligne({ formule: null }))).toEqual(["formule : Champ obligatoire vide."]);
    expect(messages(ligne({ sexe: null, lien: null }))).toEqual([]);
  });

  it("formats : date invalide ou impossible, sexe, numéro hors format ou déjà pris", () => {
    expect(messages(ligne({ date_naissance: "31/02/1990" }))[0]).toMatch(/^date_naissance : Date invalide/);
    expect(messages(ligne({ date_naissance: "01/01/2030" }))[0]).toMatch(/impossible/);
    expect(messages(ligne({ sexe: "X" }))).toEqual(["sexe : Sexe invalide : M, F ou vide."]);
    expect(messages(ligne({ numero_certificat: "CERT-1" }))[0]).toMatch(/^numero_certificat : Le numéro du certificat « CERT-1 » doit s'écrire TST-2026-000001-G suivi/);
    expect(messages(ligne({ numero_certificat: "AUT-2026-000001-G00004" }))[0]).toMatch(/doit s'écrire TST-2026-000001-G/);
    expect(messages(ligne({ numero_certificat: "TST-2026-000001-I00004" }))[0]).toMatch(/doit s'écrire TST-2026-000001-G/);
    expect(messages(ligne({ numero_certificat: "TST-2026-000001-G00000" }))[0]).toMatch(/00000 est réservé au contrat/);
    expect(messages(ligne({ numero_certificat: "TST-2026-000001-G00001" }))[0]).toMatch(/déjà utilisé par une police, un document ou un import en cours/);
  });

  it("pièce d'identité (assures[].num_identification, session 6.0) : facultative, 50 caractères au plus, reprise dans l'adhérent", () => {
    const [r] = controlerLignes([ligne({ num_identification: " CNI C0000000001 " })], ctx);
    expect(r.erreurs).toEqual([]);
    expect(adherentDeLigne(r.donnees).num_identification).toBe("CNI C0000000001");
    expect(messages(ligne({ num_identification: "X".repeat(51) }))).toEqual(["num_identification : Texte trop long (50 caractères au plus)."]);
    expect(cleDEntete("assures[].num_identification")).toBe("num_identification");
  });

  it("formule inconnue du produit, ou connue mais non retenue dans la police", () => {
    expect(messages(ligne({ formule: "PREMIUM" }))).toEqual(["formule : Formule « PREMIUM » inconnue pour ce produit."]);
    expect(messages(ligne({ formule: "SENIOR" }))[0]).toMatch(/non retenue dans la police/);
  });

  it("âges limites de la formule, à la date d'effet de l'incorporation (H62)", () => {
    expect(messages(ligne({ date_naissance: "02/07/2008" }))).toEqual([
      "date_naissance : Âge hors limite : 17 ans à la date d'adhésion (2026-07-01), minimum 18 ans pour la formule SOLO.",
    ]);
    expect(messages(ligne({ date_naissance: "01/07/2008" }))).toEqual([]);
    expect(messages(ligne({ date_naissance: "30/06/1960" }))[0]).toMatch(/66 ans .* maximum 65 ans/);
    expect(messages(ligne({ date_naissance: "30/06/1940", formule: "FAMILLE" }))).toEqual([]);
  });

  it("adhérent ajouté en cours de contrat : l'âge est celui de SA date d'adhésion, pas de la date d'effet de la police (H62, Thierry, 09/10/2026)", () => {
    // 17 ans au 01/01/2026 (début de la police), 18 ans au 01/07/2026 (date d'adhésion) : accepté.
    expect(messages(ligne({ date_naissance: "02/03/2008" }))).toEqual([]);
    // 65 ans au début de la police, 66 ans à la date d'adhésion : refusé.
    expect(messages(ligne({ date_naissance: "15/03/1960" }))[0]).toMatch(/66 ans à la date d'adhésion \(2026-07-01\), maximum 65 ans/);
  });
});

describe("doublons (H63)", () => {
  it("dans le fichier : la première ligne reste valide, la suivante est en erreur ; même personne malgré la casse et les accents", () => {
    const a = ligne({ nom_prenoms: "Yao Aïcha", date_naissance: "01/01/1990" });
    const b = ligne({ nom_prenoms: "  YAO   AICHA ", date_naissance: "1990-01-01" });
    const [ra, rb] = controlerLignes([a, b], ctx);
    expect(ra.erreurs).toEqual([]);
    expect(rb.erreurs.map((e) => e.message)).toEqual([`Doublon de la ligne ${a.numero} (même nom et même date de naissance).`]);
  });

  it("homonyme né un autre jour : pas un doublon", () => {
    const r = controlerLignes([ligne({ nom_prenoms: "Yao Aïcha", date_naissance: "01/01/1990" }), ligne({ nom_prenoms: "Yao Aïcha", date_naissance: "02/01/1990" })], ctx);
    expect(r.flatMap((l) => l.erreurs)).toEqual([]);
  });

  it("avec un adhérent de la liste courante de la police", () => {
    expect(messages(ligne({ nom_prenoms: "KOUAME ERIC", date_naissance: "05/05/1985" }))).toEqual([
      "nom_prenoms : Doublon : déjà adhérent de la police (n° d'ordre 1, même nom et même date de naissance).",
    ]);
  });

  it("numéro de certificat donné deux fois dans le fichier", () => {
    const a = ligne({ numero_certificat: "TST-2026-000001-G07777" });
    const b = ligne({ numero_certificat: "TST-2026-000001-G07777" });
    expect(controlerLignes([a, b], ctx)[1].erreurs.map((e) => e.message)).toEqual([`Numéro de certificat déjà donné à la ligne ${a.numero}.`]);
  });

  it("une ligne déjà en erreur ne rend pas les suivantes doublons", () => {
    const a = ligne({ nom_prenoms: "Yao Aïcha", date_naissance: "01/01/1990", formule: "PREMIUM" });
    const b = ligne({ nom_prenoms: "Yao Aïcha", date_naissance: "01/01/1990" });
    expect(controlerLignes([a, b], ctx)[1].erreurs).toEqual([]);
  });
});

describe("numéro de certificat proposé d'après le numéro d'ordre (session 6.0, D27, H60)", () => {
  it("colonne vide : racine de la police mère, puis le numéro d'ordre que l'adhérent recevra, sur 5 chiffres", () => {
    const r = controlerLignes([ligne({ numero_certificat: null }), ligne({ numero_certificat: "TST-2026-000001-G00500" }), ligne({ numero_certificat: "" })], ctx);
    expect(r.flatMap((l) => l.erreurs)).toEqual([]);
    expect(r.map((l) => l.donnees.numero_certificat)).toEqual(["TST-2026-000001-G00002", "TST-2026-000001-G00500", "TST-2026-000001-G00004"]);
  });

  it("une ligne en erreur ne reçoit pas de numéro d'ordre : les suivantes sont décalées", () => {
    const r = controlerLignes([ligne({ numero_certificat: null, formule: "PREMIUM" }), ligne({ numero_certificat: null })], ctx);
    expect(r[0].donnees.numero_certificat).toBe("");
    expect(r[1].donnees.numero_certificat).toBe("TST-2026-000001-G00002");
  });

  it("numéro saisi égal à un numéro proposé : la seconde ligne est en erreur, et les numéros proposés sont recalculés", () => {
    const r = controlerLignes([ligne({ numero_certificat: null }), ligne({ numero_certificat: "TST-2026-000001-G00002" }), ligne({ numero_certificat: null })], ctx);
    expect(r[1].erreurs.map((e) => e.message)).toEqual([`Numéro de certificat déjà donné à la ligne ${r[0].numero}.`]);
    expect(r[1].donnees.numero_certificat).toBe("TST-2026-000001-G00002");
    expect(r[2].erreurs).toEqual([]);
    expect(r[2].donnees.numero_certificat).toBe("TST-2026-000001-G00003");
  });

  it("numéro proposé déjà pris (import précédent) : erreur sur la ligne ; police mère sans G ou I et 5 chiffres : aucun numéro proposé", () => {
    const pris = { ...ctx, numerosPris: new Set(["TST-2026-000001-G00002"]) };
    expect(messages(ligne({ numero_certificat: null }), pris)[0]).toMatch(/numéro proposé « TST-2026-000001-G00002 » est déjà utilisé/);
    const sansRacine = { ...ctx, numeroPolice: "ANCIEN-123" };
    expect(messages(ligne({ numero_certificat: null }), sansRacine)[0]).toMatch(/ne se termine pas par G ou I suivi de 5 chiffres/);
  });
});

describe("âges limites dans le paramétrage d'une formule", () => {
  const version = (ageMin: number | null, ageMax: number | null): VersionSaisie => ({
    dateEffet: "2026-01-01",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: true, primeMinimale: null },
    fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    seuilValidationTtc: null,
    formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0", ageMin, ageMax }],
  });
  it("facultatifs, entiers de 0 à 120, minimum au plus égal au maximum", () => {
    expect(problemesVersion(version(null, null))).toEqual([]);
    expect(problemesVersion(version(18, 65))).toEqual([]);
    expect(problemesVersion(version(65, 18))).toEqual(["Formule « SOLO » : l'âge minimal dépasse l'âge maximal."]);
    expect(problemesVersion(version(-1, null))[0]).toMatch(/nombres entiers d'années, de 0 à 120/);
    expect(problemesVersion(version(null, Number.NaN))[0]).toMatch(/nombres entiers/);
  });
});
