// Édition d'un barème à l'écran (B4, D58) : fonctions pures sur le document. SECURPRO INVENTÉ (fixture), jamais le barème réel.
import { describe, expect, it } from "vitest";

import {
  MESSAGE_PROFONDEUR,
  ajouterOperande,
  attributsDuChamp,
  baremeVide,
  changerGenre,
  changerValeur,
  champNeuf,
  deplacer,
  garantieNeuve,
  lecteursDuChamp,
  lecteursDeIntermediaire,
  lecteursDeSouscription,
  peutPlacerOperation,
  profondeur,
  proposerCode,
  remplacerOperande,
  renommerChamp,
  renommerGarantie,
  renommerIntermediaire,
  renommerValeur,
  retirerOperande,
  schemaBareme,
  supprimerAttribut,
  supprimerBloc,
  supprimerChamp,
  supprimerComposante,
  supprimerGarantie,
  supprimerIntermediaire,
  supprimerValeur,
  valeursPourCondition,
  verifierBareme,
  type Bareme,
  type Operande,
  type Resultat,
} from "./index";
import { baremeSecurpro } from "./securpro-fixture";

const refus = (r: Resultat): string => (r.ok ? "" : r.refus.join(" | "));
const ok = (r: Resultat): Bareme => {
  if (!r.ok) throw new Error(`refus inattendu : ${refus(r)}`);
  return r.bareme;
};
const aucun = new Set<string>();

describe("proposerCode", () => {
  it("minuscules, sans accent, tirets bas", () => {
    expect(proposerCode("Type de commerce")).toBe("type_de_commerce");
    expect(proposerCode("  Épicerie  « fine » ")).toBe("epicerie_fine");
    expect(proposerCode("Sœur & frère")).toBe("soeur_frere");
  });
  it("commence toujours par une lettre et reste dans les 40 caractères", () => {
    expect(proposerCode("2 pièces")).toBe("c_2_pieces");
    expect(proposerCode("")).toBe("element");
    expect(proposerCode("!!!", [], "champ")).toBe("champ");
    const long = proposerCode("un libellé très très long qui dépasse largement la limite de quarante caractères");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toMatch(/^[a-z][a-z0-9_]*$/);
  });
  it("reste unique parmi les codes pris", () => {
    expect(proposerCode("Loyer", ["loyer"])).toBe("loyer_2");
    expect(proposerCode("Loyer", ["loyer", "loyer_2"])).toBe("loyer_3");
    const pris = ["a".repeat(40)];
    const code = proposerCode("a".repeat(60), pris);
    expect(code.length).toBeLessThanOrEqual(40);
    expect(pris).not.toContain(code);
  });
});

describe("document vide", () => {
  it("passe le schéma et la vérification d'intégrité ; seul l'essai manque à la publication", () => {
    const lu = schemaBareme.parse(baremeVide("IARD"));
    expect(verifierBareme(lu)).toEqual([]);
    expect(verifierBareme(lu, { publication: true }).map((p) => p.code)).toEqual(["AUCUN_ESSAI"]);
  });
  it("un ajout de champ, de garantie et de composante reste lisible par le schéma", () => {
    let b = baremeVide("IARD");
    b = { ...b, champs: [champNeuf("capital", "Capital", "MONTANT"), champNeuf("classe", "Classe", "LISTE")], garanties: [...b.garanties, garantieNeuve("vol", "Vol")] };
    expect(schemaBareme.safeParse(b).success).toBe(true);
  });
});

describe("opérandes : profondeur 2 au plus", () => {
  const fois: Operande = ["FOIS", "a", "b"];
  it("mesure la profondeur comme verifierBareme (TABLE vaut 1)", () => {
    expect(profondeur("x")).toBe(0);
    expect(profondeur(fois)).toBe(1);
    expect(profondeur(["SOMME", fois, "c"])).toBe(2);
    expect(profondeur(["SOMME", ["FOIS", ["TABLE", "t"], "2"], "c"])).toBe(3);
  });
  it("n'autorise une opération qu'aux niveaux 0 et 1", () => {
    expect(peutPlacerOperation(0)).toBe(true);
    expect(peutPlacerOperation(1)).toBe(true);
    expect(peutPlacerOperation(2)).toBe(false);
  });
  it("refuse clairement une troisième imbrication, sans rien modifier", () => {
    const deux: Operande = ["SOMME", ["FOIS", "a", "b"], "c"];
    const r = remplacerOperande(deux, [0, 0], ["FOIS", "1", "2"]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.refus).toBe(MESSAGE_PROFONDEUR);
    expect(remplacerOperande(deux, [1], ["FOIS", "1", "2"]).ok).toBe(true);
  });
  it("garde les opérandes en commun en changeant d'opération, complète et coupe", () => {
    expect(changerGenre(["SOMME", "a", "b", "c"], "FOIS")).toEqual(["FOIS", "a", "b"]);
    expect(changerGenre(["FOIS", "a", "b"], "PCT_PLAFOND")).toEqual(["PCT_PLAFOND", "a", "b", "0"]);
    expect(changerGenre(["FOIS", "a", "b"], "TABLE", { tables: ["t1"] })).toEqual(["TABLE", "t1"]);
    expect(changerGenre("a", "SOMME")).toEqual(["SOMME", "0", "0"]);
    expect(changerGenre(["SOMME", "a", "b"], "CONSTANTE")).toBe("0");
  });
  it("ajoute et retire des opérandes seulement aux opérations à nombre variable, jamais sous un", () => {
    const somme: Operande = ["SOMME", "a", "b"];
    expect(ajouterOperande(somme, [])).toEqual(["SOMME", "a", "b", "0"]);
    expect(ajouterOperande(["FOIS", "a", "b"], [])).toEqual(["FOIS", "a", "b"]);
    expect(retirerOperande(["SOMME", "a", "b", "c"], [], 1)).toEqual(["SOMME", "a", "c"]);
    expect(retirerOperande(["SOMME", "a"], [], 0)).toEqual(["SOMME", "a"]);
  });
  it("les opérandes que l'écran propose sont acceptés par la vérification", () => {
    let b = baremeSecurpro();
    const assiettes: Operande[] = ["stocks", "capital_immo", "125", { k: "7" }, ["SOMME", "stocks", "materiel"], ["FOIS", "stocks", "2"], ["PCT_PLAFOND", "stocks", "15", "1000"], ["TABLE", "limites"], ["PREMIER", "loyer_mensuel", "valeur_batiment"]];
    for (const a of assiettes) {
      b = { ...b, garanties: b.garanties.map((g) => (g.code === "tri" ? { ...g, composantes: g.composantes.map((c) => ({ ...c, assiette: a })) } : g)) };
      const problemes = verifierBareme(b).filter((p) => p.code === "PROFONDEUR" || p.code === "ARITE" || p.code === "OPERATION_INCONNUE");
      expect(problemes).toEqual([]);
    }
  });
});

describe("qui lit quoi", () => {
  const b = baremeSecurpro();
  it("nomme ce qui lit un champ : condition, intermédiaire, composante, table, essai", () => {
    expect(lecteursDuChamp(b, "occupation").join(" ")).toContain("loyer_mensuel");
    expect(lecteursDuChamp(b, "loyer_mensuel").join(" ")).toContain("valeur intermédiaire « capital_immo »");
    expect(lecteursDuChamp(b, "vol_caisse_montant").join(" ")).toContain("composante « vol.caisse »");
    expect(lecteursDuChamp(b, "gardien").join(" ")).toContain("table « secu_incendie »");
    expect(lecteursDuChamp(b, "situation").join(" ")).toContain("table « limites »");
    expect(lecteursDuChamp(b, "camera").join(" ")).toContain("jeu d'essai « Électronique, locataire, boutique »");
  });
  it("nomme ce qui lit une valeur intermédiaire, une garantie et une composante", () => {
    expect(lecteursDeIntermediaire(b, "contenu").join(" ")).toContain("capitaux_totaux");
    expect(lecteursDeIntermediaire(b, "contenu").join(" ")).toContain("composante « vol.contenu »");
    expect(lecteursDeIntermediaire(b, "capitaux_totaux").join(" ")).toContain("sous-jacent « plafond »");
    expect(lecteursDeSouscription(b, "incendie").join(" ")).toContain("sous-jacent « classe »");
    expect(lecteursDeSouscription(b, "vol.caisse").join(" ")).toContain("champ « vol_caisse_montant »");
    expect(lecteursDeSouscription(b, "vol").join(" ")).toContain("sous-jacent « electronique »");
  });
  it("nomme ce qui lit une valeur de liste, mais pas un simple champ qui la porte", () => {
    expect(lecteursDuChamp(b, "occupation", "LOCATAIRE").join(" ")).toContain("loyer_mensuel");
    expect(lecteursDuChamp(b, "occupation", "PROPRIETAIRE").join(" ")).toContain("valeur_batiment");
    expect(lecteursDuChamp(b, "type_commerce", "BUREAU").join(" ")).not.toContain("loyer");
    expect(lecteursDuChamp(b, "gardien", "OUI").join(" ")).not.toContain("loyer");
  });
  it("une condition de garantie lit le champ choisi", () => {
    const c = { ...b, garanties: b.garanties.map((g) => (g.code === "dde" ? { ...g, souscription: "CONDITION" as const, si: { champ: "situation", egal: "BOUTIQUE" } } : g)) };
    expect(lecteursDuChamp(c, "situation").join(" ")).toContain("garantie « dde »");
    expect(refus(supprimerValeur(c, "situation", "BOUTIQUE"))).toContain("garantie « dde »");
  });
});

describe("suppressions refusées en nommant qui lit", () => {
  const b = baremeSecurpro();
  it("un champ lu est refusé, avec le nom de ce qui le lit", () => {
    const r = supprimerChamp(b, "occupation");
    expect(r.ok).toBe(false);
    expect(refus(r)).toContain("champ « loyer_mensuel »");
    expect(refus(supprimerChamp(b, "stocks"))).toContain("valeur intermédiaire « contenu »");
    expect(refus(supprimerChamp(b, "gardien"))).toContain("table « secu_incendie »");
  });
  it("un champ que personne ne lit se supprime", () => {
    let c: Bareme = { ...b, champs: [...b.champs, champNeuf("libre", "Libre")] };
    c = ok(supprimerChamp(c, "libre"));
    expect(c.champs.some((x) => x.code === "libre")).toBe(false);
  });
  it("une valeur intermédiaire lue est refusée", () => {
    expect(refus(supprimerIntermediaire(b, "contenu"))).toContain("capitaux_totaux");
    expect(refus(supprimerIntermediaire(b, "capitaux_totaux"))).toContain("sous-jacent « plafond »");
    expect(refus(supprimerIntermediaire(b, "capital_immo"))).toContain("capitaux_totaux");
  });
  it("une garantie ou une composante lue est refusée ; une garantie reste toujours", () => {
    expect(refus(supprimerGarantie(b, "incendie"))).toContain("sous-jacent « classe »");
    expect(refus(supprimerComposante(b, "vol", "contenu"))).toContain("sous-jacent « electronique »");
    expect(refus(supprimerComposante(b, "incendie", "base"))).toContain("au moins une composante");
    expect(refus(supprimerGarantie(baremeVide("IARD"), "garantie_1"))).toContain("au moins une garantie");
    expect(refus(supprimerGarantie(b, "dde"))).toContain("champ « dde_montant »");
  });
  it("une valeur de liste lue par une condition ou une table est refusée", () => {
    expect(refus(supprimerValeur(b, "occupation", "LOCATAIRE"))).toContain("loyer_mensuel");
    expect(refus(supprimerValeur(b, "situation", "MARCHE"))).toContain("table « limites »");
    expect(refus(supprimerValeur(b, "type_commerce", "BUREAU"))).toContain("table « coef_vol_contenu »");
  });
  it("un bloc qui range des champs est refusé en les nommant", () => {
    expect(refus(supprimerBloc(b, "local"))).toContain("champ « type_commerce »");
    expect(supprimerBloc({ ...b, blocs: [...b.blocs, { code: "vide", libelle: "Vide" }] }, "vide").ok).toBe(true);
  });
});

describe("codes : renommer", () => {
  const b = baremeSecurpro();
  it("un champ publié (figé) ne change plus de code", () => {
    expect(refus(renommerChamp(b, "stocks", "marchandises", new Set(["stocks"])))).toContain("barème publié");
  });
  it("un champ lu n'est pas renommé, un champ libre l'est", () => {
    expect(refus(renommerChamp(b, "stocks", "marchandises", aucun))).toContain("valeur intermédiaire « contenu »");
    const c: Bareme = { ...b, champs: [...b.champs, champNeuf("libre", "Libre")] };
    const r = ok(renommerChamp(c, "libre", "autre", aucun));
    expect(r.champs.some((x) => x.code === "autre")).toBe(true);
  });
  it("refuse un code invalide ou déjà pris (champs et valeurs intermédiaires partagent leurs noms)", () => {
    const c: Bareme = { ...b, champs: [...b.champs, champNeuf("libre", "Libre")] };
    expect(refus(renommerChamp(c, "libre", "Libre!", aucun))).toContain("minuscules");
    expect(refus(renommerChamp(c, "libre", "contenu", aucun))).toContain("déjà utilisé");
    expect(renommerChamp(c, "libre", "libre", aucun).ok).toBe(true);
  });
  it("valeur intermédiaire, garantie, valeur de liste : refusés tant qu'elles sont lues", () => {
    expect(refus(renommerIntermediaire(b, "contenu", "biens", aucun))).toContain("capitaux_totaux");
    expect(refus(renommerGarantie(b, "incendie", "feu"))).toContain("sous-jacent");
    expect(refus(renommerValeur(b, "occupation", "LOCATAIRE", "LOCATION"))).toContain("loyer_mensuel");
    expect(refus(renommerValeur(b, "occupation", "LOCATAIRE", "PROPRIETAIRE"))).toContain("existe déjà");
    expect(renommerValeur(b, "type_commerce", "BUREAU", "BUREAU").ok).toBe(true);
  });
  it("une garantie que rien ne lit se renomme", () => {
    const avec: Bareme = { ...b, garanties: [...b.garanties, garantieNeuve("neuve", "Neuve")] };
    expect(ok(renommerGarantie(avec, "neuve", "degats_eaux")).garanties.some((g) => g.code === "degats_eaux")).toBe(true);
    expect(refus(renommerGarantie(avec, "dde", "degats_eaux"))).toContain("champ « dde_montant »");
  });
});

describe("valeurs de liste et attributs", () => {
  const b = baremeSecurpro();
  const champ = b.champs.find((c) => c.code === "type_commerce")!;
  it("liste les attributs tarifaires dans l'ordre", () => {
    expect(attributsDuChamp(champ)).toEqual(["classe"]);
  });
  it("un attribut numérique le reste quand le texte est un entier ; un libellé vide ou un attribut vide se retire", () => {
    expect(changerValeur({ v: "A", classe: 1 }, { attribut: "classe" }, "2")).toEqual({ v: "A", classe: 2 });
    expect(changerValeur({ v: "A", classe: 1 }, { attribut: "classe" }, "x")).toEqual({ v: "A", classe: "x" });
    expect(changerValeur({ v: "A", l: "Un", classe: 1 }, "l", "")).toEqual({ v: "A", classe: 1 });
    expect(changerValeur({ v: "A", l: "Un", classe: 1 }, { attribut: "classe" }, "")).toEqual({ v: "A", l: "Un" });
  });
  it("une valeur sans libellé ni attribut redevient un simple texte (comme le classeur la relit)", () => {
    expect(changerValeur({ v: "A", l: "Un" }, "l", "")).toBe("A");
    expect(changerValeur("A", "l", "Un")).toEqual({ v: "A", l: "Un" });
  });
  it("un attribut lu par une table comme clé ne se retire pas", () => {
    expect(refus(supprimerAttribut(b, "type_commerce", "classe"))).toContain("table « taux_incendie »");
  });
  it("les valeurs d'une condition sont les valeurs de la liste ou OUI / NON", () => {
    expect(valeursPourCondition(b.champs.find((c) => c.code === "gardien")!).map((v) => v.code)).toEqual(["OUI", "NON"]);
    expect(valeursPourCondition(champ).map((v) => v.libelle)).toContain("Épicerie");
    expect(valeursPourCondition(b.champs.find((c) => c.code === "stocks")!)).toEqual([]);
  });
});

describe("listes", () => {
  it("déplace d'un cran, sans sortir des limites ni modifier la liste d'origine", () => {
    const l = ["a", "b", "c"];
    expect(deplacer(l, 1, -1)).toEqual(["b", "a", "c"]);
    expect(deplacer(l, 1, 1)).toEqual(["a", "c", "b"]);
    expect(deplacer(l, 0, -1)).toBe(l);
    expect(deplacer(l, 2, 1)).toBe(l);
    expect(l).toEqual(["a", "b", "c"]);
  });
});
