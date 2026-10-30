// Jeux d'essai à l'écran (B5, D59) : la saisie comme le Commercial, l'attendu TAPÉ, jamais calculé par l'application.
import { describe, expect, it } from "vitest";

import {
  ajouterEssai,
  ajouterLigneAttendue,
  attenduVide,
  changerSaisie,
  dupliquerEssai,
  genreAttendu,
  lecteursDeSouscription,
  poserMontantAttendu,
  poserRefusAttendu,
  poserTtcAttendu,
  renommerEssai,
  retirerLigneAttendue,
  saisieDepuisFormulaire,
  supprimerEssai,
  supprimerGarantie,
  verifierBareme,
  viderAttendu,
  type Bareme,
  type Resultat,
} from "./index";
import { baremeSecurpro } from "./securpro-fixture";

const ok = (r: Resultat): Bareme => {
  if (!r.ok) throw new Error(r.refus.join(" | "));
  return r.bareme;
};
const refus = (r: Resultat): string => {
  if (r.ok) throw new Error("refus attendu");
  return r.refus.join(" | ");
};

describe("création d'un essai", () => {
  const base = baremeSecurpro();
  it("un essai neuf a une saisie vide et un attendu VIDE : rien n'est pré-rempli", () => {
    const b = ok(ajouterEssai(base, "  Cas du bureau  "));
    const e = b.jeuxEssai.at(-1)!;
    expect(e.nom).toBe("Cas du bureau");
    expect(e.entrees).toEqual({ champs: {}, souscrit: [] });
    expect(e.attendu).toEqual({});
    expect(attenduVide(e.attendu)).toBe(true);
  });
  it("un essai sans attendu bloque la publication (il ne vérifierait rien) ; avec un TTC tapé, le blocage tombe", () => {
    const vide = ok(ajouterEssai(base, "Cas"));
    const p = verifierBareme(vide, { publication: true }).filter((x) => x.code === "ESSAI_SANS_ATTENDU");
    expect(p).toHaveLength(1);
    expect(p[0].message).toContain("Jeu d'essai « Cas » : aucun résultat attendu");
    const tape = ok(poserTtcAttendu(vide, "Cas", "12 000"));
    expect(verifierBareme(tape).filter((x) => x.code === "ESSAI_SANS_ATTENDU")).toEqual([]);
  });
  it("un nom vide ou déjà pris est refusé ; deux essais ne partagent pas un nom", () => {
    expect(refus(ajouterEssai(base, " "))).toContain("Donnez un nom");
    expect(refus(ajouterEssai(base, base.jeuxEssai[0].nom))).toContain("s'appelle déjà");
    const doublon: Bareme = { ...base, jeuxEssai: [base.jeuxEssai[0], base.jeuxEssai[0]] };
    expect(verifierBareme(doublon).map((p) => p.code)).toContain("CODE_EN_DOUBLE");
  });
  it("renommer, dupliquer (saisie et attendu recopiés), supprimer", () => {
    const nom = base.jeuxEssai[0].nom;
    expect(ok(renommerEssai(base, nom, "Autre nom")).jeuxEssai[0].nom).toBe("Autre nom");
    expect(refus(renommerEssai(base, nom, base.jeuxEssai[1].nom))).toContain("s'appelle déjà");
    const copie = ok(dupliquerEssai(base, nom));
    expect(copie.jeuxEssai.at(-1)!.nom).toBe(`${nom} (2)`);
    expect(copie.jeuxEssai.at(-1)!.attendu).toEqual(base.jeuxEssai[0].attendu);
    expect(ok(supprimerEssai(base, nom)).jeuxEssai).toHaveLength(2);
    expect(refus(supprimerEssai(base, "inconnu"))).toContain("n'existe pas");
  });
});

describe("la saisie : ce que le Commercial aurait saisi", () => {
  it("passe par la même lecture du formulaire que la cotation : oui/non en booléen, champ vide omis, effectif entier", () => {
    const base = ok(ajouterEssai(baremeSecurpro(), "Cas"));
    const saisie = saisieDepuisFormulaire(base, { champs: { gardien: ["OUI"], extincteurs: ["NON"], stocks: ["1 000"], camera: [""] }, souscrit: ["vol.caisse", "vol.caisse"], effectif: "3" });
    expect(saisie).toEqual({ champs: { gardien: true, extincteurs: false, stocks: "1 000" }, souscrit: ["vol.caisse"], effectif: 3 });
    const b = ok(changerSaisie(base, "Cas", saisie));
    expect(b.jeuxEssai.at(-1)!.entrees).toEqual({ champs: { gardien: true, extincteurs: false, stocks: "1 000" }, souscrit: ["vol.caisse"], effectif: 3 });
    // un effectif illisible n'est pas écrit
    expect(ok(changerSaisie(base, "Cas", { champs: {}, souscrit: [], effectif: Number.NaN })).jeuxEssai.at(-1)!.entrees.effectif).toBeUndefined();
  });
});

describe("l'attendu est tapé", () => {
  const depart = ok(ajouterEssai(baremeSecurpro(), "Cas"));

  it("TTC total : décimal tapé à la française ; texte invalide refusé ; vide retire", () => {
    const b = ok(poserTtcAttendu(depart, "Cas", "139 420,5"));
    expect(b.jeuxEssai.at(-1)!.attendu.ttc).toBe("139420.5");
    expect(refus(poserTtcAttendu(depart, "Cas", "beaucoup"))).toContain("écrivez un nombre positif");
    expect(ok(poserTtcAttendu(b, "Cas", "")).jeuxEssai.at(-1)!.attendu).toEqual({});
  });
  it("lignes attendues : une par garantie, quatre montants à taper, retirables", () => {
    let b = ok(ajouterLigneAttendue(depart, "Cas", "dde"));
    expect(b.jeuxEssai.at(-1)!.attendu.lignes).toEqual([{ g: "dde" }]);
    b = ok(poserMontantAttendu(b, "Cas", "dde", "nette", "12 000"));
    b = ok(poserMontantAttendu(b, "Cas", "dde", "ttc", "15551"));
    expect(b.jeuxEssai.at(-1)!.attendu.lignes).toEqual([{ g: "dde", nette: "12000", ttc: "15551" }]);
    expect(refus(ajouterLigneAttendue(b, "Cas", "dde"))).toContain("existe déjà");
    expect(refus(ajouterLigneAttendue(b, "Cas", "fantome"))).toContain("n'existe pas");
    expect(refus(poserMontantAttendu(b, "Cas", "dde", "taxe", "x"))).toContain("Taxe attendu");
    expect(refus(poserMontantAttendu(b, "Cas", "de", "taxe", "1"))).toContain("Pas de ligne attendue");
    b = ok(poserMontantAttendu(b, "Cas", "dde", "nette", ""));
    expect(b.jeuxEssai.at(-1)!.attendu.lignes).toEqual([{ g: "dde", ttc: "15551" }]);
    expect(ok(retirerLigneAttendue(b, "Cas", "dde")).jeuxEssai.at(-1)!.attendu).toEqual({});
  });
  it("une ligne attendue sans aucun montant ne vérifie rien : l'attendu reste vide", () => {
    const b = ok(ajouterLigneAttendue(depart, "Cas", "dde"));
    expect(attenduVide(b.jeuxEssai.at(-1)!.attendu)).toBe(true);
  });
  it("refus attendu : texte contenu dans le message ; le vider ramène à un attendu vide ; changer de forme efface", () => {
    let b = ok(poserRefusAttendu(depart, "Cas", "ne peut pas être assuré"));
    expect(genreAttendu(b.jeuxEssai.at(-1)!.attendu)).toBe("REFUS");
    expect(attenduVide(b.jeuxEssai.at(-1)!.attendu)).toBe(false);
    expect(ok(poserRefusAttendu(b, "Cas", "  ")).jeuxEssai.at(-1)!.attendu).toEqual({});
    b = ok(viderAttendu(b, "Cas"));
    expect(b.jeuxEssai.at(-1)!.attendu).toEqual({});
    expect(genreAttendu({})).toBe("MONTANTS");
  });
  it("le document écrit passe le schéma (un refus vide n'est jamais écrit)", async () => {
    const { schemaBareme } = await import("./schema");
    const b = ok(poserRefusAttendu(depart, "Cas", ""));
    expect(schemaBareme.safeParse(JSON.parse(JSON.stringify(b))).success).toBe(true);
  });
});

describe("qui lit une garantie : aussi les lignes attendues des essais", () => {
  it("supprimer une garantie citée par la ligne attendue d'un essai est refusé en nommant l'essai", () => {
    let b = ok(ajouterEssai(baremeSecurpro(), "Cas"));
    b = ok(ajouterLigneAttendue(b, "Cas", "tempete"));
    expect(lecteursDeSouscription(b, "tempete")).toContain("le jeu d'essai « Cas »");
    expect(refus(supprimerGarantie(b, "tempete"))).toContain("jeu d'essai « Cas »");
  });
});
