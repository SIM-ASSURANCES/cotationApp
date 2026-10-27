// Balises risque.<code> et risque_code.<code> d'un produit au barème (B6b, D52 ; libellés D55 ; valeurs calculées D54). Barème et saisies inventés (securpro-fixture).
import { describe, expect, it } from "vitest";

import { avertissementsRisque } from "../documents/controles";
import { champsRisqueFacultatifs } from "../documents/dictionnaire";
import type { Analyse } from "../documents/analyse";
import { estConnu } from "../documents/dictionnaire";
import { codesRisqueDuBareme, risqueCodeDuBareme, risqueDuBareme } from "./documents";
import { lireBareme, type Saisie } from "./schema";
import { documentSecurpro } from "./securpro-fixture";

const bareme = lireBareme(documentSecurpro);
const locataire = documentSecurpro.jeuxEssai[0].entrees as unknown as Saisie; // Électronique, locataire, boutique
const proprietaire = documentSecurpro.jeuxEssai[1].entrees as unknown as Saisie; // Bureau, propriétaire

describe("risqueDuBareme : un champ du barème = une balise risque.<code>", () => {
  it("toutes les balises existent ; risque.<champ> = ce que voit le Commercial (libellé, Oui / Non), risque_code.<champ> = le code", () => {
    const r = risqueDuBareme(bareme, locataire);
    expect(Object.keys(r).sort()).toEqual(codesRisqueDuBareme(bareme).sort());
    expect(r).toMatchObject({ type_commerce: "Électronique", occupation: "LOCATAIRE", situation: "BOUTIQUE", gardien: "Oui", extincteurs: "Non", loyer_mensuel: "150000", stocks: "6866500", dde_montant: "2000000" });
    const codes = risqueCodeDuBareme(bareme, locataire);
    expect(Object.keys(codes).sort()).toEqual(codesRisqueDuBareme(bareme).sort());
    expect(codes).toMatchObject({ type_commerce: "ELECTRONIQUE", occupation: "LOCATAIRE", situation: "BOUTIQUE", gardien: "OUI", extincteurs: "NON", loyer_mensuel: "150000", stocks: "6866500", dde_montant: "2000000" });
  });

  it("un champ qui ne s'applique pas (condition d'affichage) ou facultatif laissé vide vaut « » : la balise existe, vide", () => {
    const r = risqueDuBareme(bareme, locataire);
    expect(r.valeur_batiment).toBe(""); // propriétaire seulement
    expect(r.tempete_montant).toBe(""); // garantie non souscrite : champ non saisi
    expect(risqueDuBareme(bareme, proprietaire).loyer_mensuel).toBe("");
  });

  it("une valeur saisie pour un champ devenu inapplicable est ignorée (jamais un résidu de saisie)", () => {
    const residu: Saisie = { ...locataire, champs: { ...locataire.champs, valeur_batiment: "99999999" } };
    expect(risqueDuBareme(bareme, residu).valeur_batiment).toBe("");
  });
});

describe("libellé et code, pour chaque type de champ, et champ non imprimable (D55)", () => {
  const variante = structuredClone(documentSecurpro) as unknown as { champs: Record<string, unknown>[] };
  variante.champs.push(
    { code: "enseigne", type: "TEXTE", obligatoire: false },
    { code: "ouverture", type: "DATE", obligatoire: false },
    { code: "employes", type: "NOMBRE", obligatoire: false },
    { code: "options", type: "CHOIX_MULTIPLES", obligatoire: false, valeurs: [{ v: "ALARME", l: "Alarme" }, { v: "CAMERA", l: "Caméra" }, "COFFRE"] },
    { code: "note_interne", type: "TEXTE", obligatoire: false, surDocuments: false },
    { code: "capital_secu", type: "LISTE", numerique: true, obligatoire: false, valeurs: ["500000", { v: "1000000", l: "1 million" }] },
  );
  const b = lireBareme(variante);
  const saisie: Saisie = {
    ...locataire,
    champs: { ...locataire.champs, enseigne: "  Chez Aya  ", ouverture: "2020-03-15", employes: "12", options: ["ALARME", "COFFRE", "CAMERA"], note_interne: "ne pas imprimer", capital_secu: "1000000" },
  };

  it("liste : libellé / code ; oui-non : Oui, Non / OUI, NON ; choix multiples : libellés / codes ; montant, nombre, texte, date : valeur brute pour les deux", () => {
    expect(risqueDuBareme(b, saisie)).toMatchObject({ type_commerce: "Électronique", gardien: "Oui", camera: "Oui", volet: "Non", options: "Alarme, COFFRE, Caméra", capital_secu: "1 million", stocks: "6866500", employes: "12", enseigne: "Chez Aya", ouverture: "2020-03-15" });
    expect(risqueCodeDuBareme(b, saisie)).toMatchObject({ type_commerce: "ELECTRONIQUE", gardien: "OUI", camera: "OUI", volet: "NON", options: "ALARME, COFFRE, CAMERA", capital_secu: "1000000", stocks: "6866500", employes: "12", enseigne: "Chez Aya", ouverture: "2020-03-15" });
  });

  it("une valeur de liste sans libellé rend son code dans les deux", () => {
    const sansLibelle: Saisie = { ...saisie, champs: { ...saisie.champs, capital_secu: "500000" } };
    expect(risqueDuBareme(b, sansLibelle).capital_secu).toBe("500000");
    expect(risqueCodeDuBareme(b, sansLibelle).capital_secu).toBe("500000");
  });

  it("un champ non imprimable (surDocuments: false) vaut « » dans risque ET risque_code, la balise existe", () => {
    expect(risqueDuBareme(b, saisie)).toHaveProperty("note_interne", "");
    expect(risqueCodeDuBareme(b, saisie)).toHaveProperty("note_interne", "");
    expect(risqueDuBareme(b, saisie).enseigne).not.toBe(""); // surDocuments absent : imprimable
  });

  it("un champ inapplicable ou facultatif vide vaut « » dans les deux", () => {
    expect(risqueCodeDuBareme(b, saisie).valeur_batiment).toBe("");
    expect(risqueCodeDuBareme(bareme, locataire).tempete_montant).toBe("");
  });
});

describe("risque_code dans le dictionnaire et au dépôt", () => {
  it("risque_code.<champ> est un nom connu, comme risque.<champ> ; une balise inconnue du barème est signalée pour les deux racines", () => {
    expect(estConnu("risque_code")).toBe(true);
    expect(estConnu("risque_code.occupation")).toBe(true);
    expect(estConnu("risque_codex.occupation")).toBe(false);
    const ici = { partie: "corps", paragraphe: 3, tableau: null, ligne: null, colonne: null, extrait: "" };
    const analyse = ["risque_code.occupation", "risque_code.typo", "risque.typo"].map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici }));
    const a = avertissementsRisque({ docx_valide: true, erreur: null, nombre_balises: 3, references: analyse, problemes: [], champs_word: [], blocs: [], filtres: [], polices: [], polices_absentes: [], textes: [] } as unknown as Analyse, new Set(codesRisqueDuBareme(bareme)));
    expect(a.map((x) => x.message.match(/« (risque\w*\.typo) »/)?.[1])).toEqual(["risque_code.typo", "risque.typo"]);
  });

  it("les balises risque_code vides sont facultatives, comme celles de risque", () => {
    expect(champsRisqueFacultatifs({ risque: { a: "x", b: "" }, risque_code: { a: "X", c: "" } })).toEqual(["risque.b", "risque_code.c"]);
  });
});

describe("valeurs intermédiaires et attributs tarifaires, dans risque ET risque_code (D54, SECURPRO inventé)", () => {
  /** Les deux racines portent la MÊME valeur : ni une liste ni un oui / non, rien à traduire. */
  const les2 = (b: typeof bareme, s: Saisie) => {
    const r = risqueDuBareme(b, s);
    expect(risqueCodeDuBareme(b, s)).toMatchObject(Object.fromEntries(Object.entries(r).filter(([k]) => /^(contenu|capital_immo|capitaux_totaux|seul_batiment|type_commerce_classe)$/.test(k))));
    return r;
  };

  it("les valeurs intermédiaires figées sont celles du moteur : contenu, capital immobilier, capitaux totaux", () => {
    const r = les2(bareme, locataire);
    expect(r).toMatchObject({ contenu: "8866500", capital_immo: "18000000", capitaux_totaux: "26866500" }); // 6 866 500 + 1 000 000 + 500 000 + 500 000 ; 150 000 × 120
    expect(les2(bareme, proprietaire)).toMatchObject({ contenu: "1000000", capital_immo: "20000000", capitaux_totaux: "21000000" });
  });

  it("l'attribut tarifaire de la valeur choisie d'une liste : risque.type_commerce_classe", () => {
    expect(les2(bareme, locataire).type_commerce_classe).toBe("2"); // Électronique
    expect(les2(bareme, proprietaire).type_commerce_classe).toBe("1"); // Bureau
    const quincaillerie: Saisie = { ...locataire, champs: { ...locataire.champs, type_commerce: "QUINCAILLERIE" } };
    expect(les2(bareme, quincaillerie).type_commerce_classe).toBe("4");
  });

  it("une liste sans attribut (occupation) n'a pas de balise d'attribut ; les codes publiés comprennent champs, attributs et intermédiaires", () => {
    const codes = codesRisqueDuBareme(bareme);
    expect(codes).toEqual(expect.arrayContaining(["type_commerce", "type_commerce_classe", "contenu", "capital_immo", "capitaux_totaux"]));
    expect(codes.filter((c) => c.startsWith("occupation_"))).toEqual([]);
    expect(Object.keys(risqueDuBareme(bareme, locataire)).sort()).toEqual([...codes].sort());
    expect(Object.keys(risqueCodeDuBareme(bareme, locataire)).sort()).toEqual([...codes].sort());
  });

  it("un champ liste non applicable donne un attribut vide ; une valeur intermédiaire qui en dépend est vide, jamais un zéro", () => {
    const variante = structuredClone(documentSecurpro) as unknown as { champs: { code: string; si?: unknown }[]; intermediaires: { code: string; op: unknown }[] };
    variante.champs.find((c) => c.code === "type_commerce")!.si = { champ: "occupation", egal: "PROPRIETAIRE" };
    variante.intermediaires.push({ code: "seul_batiment", op: "valeur_batiment" });
    const b = lireBareme(variante);
    const r = les2(b, locataire);
    expect(r.type_commerce).toBe("");
    expect(r.type_commerce_classe).toBe("");
    expect(r.seul_batiment).toBe(""); // valeur_batiment : propriétaire seulement
    expect(les2(b, proprietaire).seul_batiment).toBe("20000000");
  });

  it("un code déjà pris par un champ n'est pas masqué par une valeur intermédiaire de même code", () => {
    const variante = structuredClone(documentSecurpro) as unknown as { intermediaires: { code: string; op: unknown }[] };
    variante.intermediaires.push({ code: "stocks", op: { k: "1" } });
    const b = lireBareme(variante);
    expect(risqueDuBareme(b, locataire).stocks).toBe("6866500");
    expect(risqueCodeDuBareme(b, locataire).stocks).toBe("6866500");
  });
});

describe("champsRisqueFacultatifs : les balises vides s'écrivent vides", () => {
  it("seuls les champs risque vides sont facultatifs ; aucune donnée risque : liste vide", () => {
    expect(champsRisqueFacultatifs({ risque: { a: "x", b: "", c: "" } })).toEqual(["risque.b", "risque.c"]);
    expect(champsRisqueFacultatifs({})).toEqual([]);
    expect(champsRisqueFacultatifs({ risque: null })).toEqual([]);
  });
});

describe("avertissementsRisque : contrôle des modèles à l'enregistrement", () => {
  const ici = { partie: "corps", paragraphe: 3, tableau: null, ligne: null, colonne: null, extrait: "" };
  const analyse = (chemins: string[]): Analyse =>
    ({ docx_valide: true, erreur: null, nombre_balises: chemins.length, references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })), problemes: [], champs_word: [], blocs: [], filtres: [], polices: [], polices_absentes: [], textes: [] }) as unknown as Analyse;
  const codes = new Set(codesRisqueDuBareme(bareme));

  it("une balise risque.<code> inconnue du barème est signalée, une connue non, les autres champs ne sont pas concernés", () => {
    const a = avertissementsRisque(analyse(["risque.type_commerce", "risque.typo_commerce", "risque.typo_commerce", "police.numero"]), codes);
    expect(a).toHaveLength(1);
    expect(a[0].message).toContain("risque.typo_commerce");
    expect(a[0].message).toContain("type_commerce");
    expect(avertissementsRisque(analyse(["risque.loyer_mensuel", "prime.ttc"]), codes)).toEqual([]);
  });
});
