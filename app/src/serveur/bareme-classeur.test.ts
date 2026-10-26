// Classeur Excel du barème (B9, D50) : aller-retour, une erreur par type, fichiers piégés. Aucun .xlsx réel : tous les fichiers sont
// générés ici. Données INVENTÉES (SECURPRO du fixture).
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { jsonCanonique, calculerBareme, composerBareme, lireBareme, type Bareme } from "@/domaine/bareme";
import { baremeSecurpro, documentSecurpro, parametresEssai } from "@/domaine/bareme/securpro-fixture";

import { analyserClasseur, ETIQUETTE, FEUILLE, TAILLE_MAX_CLASSEUR } from "./bareme-classeur-lecture";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { empreinteBareme } from "./bareme";
import { ErreurMetier } from "./types";

const modele = () => construireClasseur(baremeSecurpro(), { titre: "Modèle (test)", modele: true });

async function charger(octets: Uint8Array): Promise<ExcelJS.Workbook> {
  const c = new ExcelJS.Workbook();
  await c.xlsx.load(Buffer.from(octets) as unknown as ArrayBuffer);
  return c;
}
const ecrire = async (c: ExcelJS.Workbook) => new Uint8Array(await c.xlsx.writeBuffer());

/** Modifie le modèle puis le rend sous forme de fichier. */
async function modifie(f: (c: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const c = await charger(await modele());
  f(c);
  return ecrire(c);
}

const refs = async (octets: Uint8Array) => (await analyserClasseur(octets)).erreurs.map((e) => `${e.ref} ${e.regle}`);
const cellule = (c: ExcelJS.Workbook, feuille: string, adresse: string) => c.getWorksheet(feuille)!.getCell(adresse);

describe("classeur du barème : aller-retour", () => {
  it("le modèle (SECURPRO inventé) se relit sans erreur, avec la même empreinte que le document d'origine", async () => {
    const r = await analyserClasseur(await modele());
    expect(r.erreurs).toEqual([]);
    expect(empreinteBareme(r.bareme)).toBe(empreinteBareme(baremeSecurpro()));
    expect(jsonCanonique(r.bareme)).toBe(jsonCanonique(baremeSecurpro()));
  });

  it("le barème relu donne 139 420 F TTC sur le premier jeu d'essai", async () => {
    const r = await analyserClasseur(await modele());
    const essai = r.bareme!.jeuxEssai[0].entrees;
    const calcul = calculerBareme(r.bareme!, { champs: essai.champs, souscrit: essai.souscrit }, parametresEssai());
    expect(calcul.ok).toBe(true);
    if (calcul.ok) expect(composerBareme(calcul.lignes, parametresEssai()).totaux.arrondi.ttc.toFixed()).toBe("139420");
  });

  it("exporter, relire, réexporter : le classeur exporté porte l'empreinte et redonne la même empreinte", async () => {
    const b = baremeSecurpro();
    const empreinte = empreinteBareme(b);
    const exporte = await construireClasseur(b, { titre: "Export (test)", empreinte });
    const lisezmoi = (await charger(exporte)).getWorksheet(FEUILLE.lisezmoi)!;
    const lignes: string[] = [];
    lisezmoi.eachRow((row) => lignes.push(`${String(row.getCell(1).value)}=${String(row.getCell(2).value)}`));
    expect(lignes).toContain(`${ETIQUETTE.empreinte}=${empreinte}`);
    const relu = await analyserClasseur(exporte);
    expect(relu.erreurs).toEqual([]);
    expect(empreinteBareme(relu.bareme)).toBe(empreinte);
    const encore = await analyserClasseur(await construireClasseur(relu.bareme!, { titre: "Export (test)", empreinte }));
    expect(empreinteBareme(encore.bareme)).toBe(empreinte);
  });

  it("l'ordre des clés d'un document n'a pas d'effet sur l'empreinte (le classeur ne le conserve pas)", () => {
    const inverse = JSON.parse(JSON.stringify(documentSecurpro, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
    expect(empreinteBareme(inverse)).toBe(empreinteBareme(documentSecurpro));
  });

  it("les tables à deux entrées sont des grilles, et les listes déroulantes sont posées", async () => {
    const c = await charger(await modele());
    const tables = c.getWorksheet(FEUILLE.tables)!;
    const lignes: string[][] = [];
    tables.eachRow((row) => lignes.push((row.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
    const i = lignes.findIndex((l) => l[0] === "TABLE" && l[1] === "secu_incendie");
    expect(lignes[i]).toEqual(["TABLE", "secu_incendie", "gardien", "extincteurs"]);
    expect(lignes[i + 1]).toEqual(["", "OUI", "NON"]);
    expect(lignes[i + 2][0]).toBe("OUI");
    expect(c.getWorksheet(FEUILLE.champs)!.getCell("D2").dataValidation.type).toBe("list");
    expect(c.getWorksheet(FEUILLE.sousJacents)!.getCell("B2").dataValidation.formulae?.[0]).toContain("E1");
    expect(c.getWorksheet(FEUILLE.composantes)!.getCell("E2").dataValidation.formulae?.[0]).toContain("PERMILLE");
  });
});

describe("classeur du barème : erreurs nommées par feuille, cellule et règle", () => {
  it("case vide dans une table : feuille, cellule et nom de la table", async () => {
    const octets = await modifie((c) => {
      const t = c.getWorksheet(FEUILLE.tables)!;
      let cible = "";
      t.eachRow((row, n) => {
        if (row.getCell(1).value === "TABLE" && row.getCell(2).value === "secu_incendie") cible = `C${n + 2}`; // 2e colonne de la première ligne de la grille
      });
      t.getCell(cible).value = null;
    });
    const e = (await analyserClasseur(octets)).erreurs;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ regle: "CASE_VIDE", message: "case vide dans la table secu_incendie" });
    expect(e[0].ref).toMatch(/^Tables!C\d+$/);
  });

  it("formule Excel : refusée, jamais évaluée (case de texte, de nombre et de table)", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.champs, "B2").value = { formula: '"a"&"b"', result: "ab" };
      cellule(c, FEUILLE.composantes, "F3").value = { formula: "1+1", result: 2 };
      const t = c.getWorksheet(FEUILLE.tables)!;
      t.getCell("B3").value = { formula: "0.5*2", result: 1 };
    });
    const e = await refs(octets);
    expect(e).toContain("Champs!B2 FORMULE_REFUSEE");
    expect(e).toContain("Composantes!F3 FORMULE_REFUSEE");
    expect(e).toContain("Tables!B3 FORMULE_REFUSEE");
  });

  it("formule dans une case numérique (minimum) : refusée et nommée", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.composantes, "H3").value = { formula: "2500", result: 2500 };
    });
    expect(await refs(octets)).toEqual(["Composantes!H3 FORMULE_REFUSEE"]);
  });

  it("nombre invalide (négatif, texte) : la cellule et la règle du schéma", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.composantes, "H3").value = "beaucoup";
    });
    const e = (await analyserClasseur(octets)).erreurs;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ ref: "Composantes!H3", regle: "VALEUR_INVALIDE" });
    expect(e[0].message).toContain("« beaucoup »");
  });

  it("valeur hors liste (type de champ) : la cellule et les valeurs admises", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.champs, "D2").value = "BIZARRE";
    });
    const e = (await analyserClasseur(octets)).erreurs;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ ref: "Champs!D2", regle: "VALEUR_NON_ADMISE" });
    expect(e[0].message).toContain("TEXTE, NOMBRE");
  });

  it("expression illisible : la cellule de l'assiette", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.composantes, "D2").value = "FOIS(stocks; ";
    });
    const e = (await analyserClasseur(octets)).erreurs;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ ref: "Composantes!D2", regle: "EXPRESSION_ILLISIBLE" });
  });

  it("référence inconnue (verifierBareme) : rattachée à la cellule de la ligne en cause", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.composantes, "D2").value = "champ_qui_n_existe_pas";
    });
    const e = (await analyserClasseur(octets)).erreurs;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ ref: "Composantes!B2", regle: "REFERENCE_INCONNUE" });
  });

  it("ligne de table manquante (verifierBareme) : rattachée à la table", async () => {
    const octets = await modifie((c) => {
      const t = c.getWorksheet(FEUILLE.tables)!;
      let n0 = 0;
      t.eachRow((row, n) => {
        if (row.getCell(1).value === "TABLE" && row.getCell(2).value === "secu_incendie") n0 = n;
      });
      t.spliceRows(n0 + 2, 1); // retire la première ligne de la grille
    });
    const e = (await analyserClasseur(octets)).erreurs;
    expect(e.map((x) => x.regle)).toContain("TABLE_INCOMPLETE");
    expect(e.find((x) => x.regle === "TABLE_INCOMPLETE")!.ref).toMatch(/^Tables!B\d+$/);
  });

  it("colonne absente, colonne inconnue, feuille absente", async () => {
    const sansType = await modifie((c) => {
      c.getWorksheet(FEUILLE.champs)!.getCell("D1").value = "genre";
    });
    const e = await refs(sansType);
    expect(e).toContain("Champs!D1 COLONNE_INCONNUE");
    expect(e).toContain("Champs!A1 COLONNE_ABSENTE");
    const sansGaranties = await modifie((c) => c.removeWorksheet(c.getWorksheet(FEUILLE.garanties)!.id));
    expect(await refs(sansGaranties)).toContain("Garanties!A1 FEUILLE_ABSENTE");
  });

  it("champ inconnu dans Valeurs, garantie inconnue dans Composantes", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.valeurs, "A2").value = "champ_fantome";
      cellule(c, FEUILLE.composantes, "A2").value = "garantie_fantome";
    });
    const e = await refs(octets);
    expect(e).toContain("Valeurs!A2 CHAMP_INCONNU");
    expect(e).toContain("Composantes!A2 GARANTIE_INCONNUE");
  });

  it("colonne non applicable à l'effet d'un sous-jacent", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.sousJacents, "F2").value = "MINIMUM"; // « mode » sur un E1
    });
    expect(await refs(octets)).toEqual(["SousJacents!F2 COLONNE_NON_APPLICABLE"]);
  });

  it("toutes les erreurs d'un même fichier sont rassemblées", async () => {
    const octets = await modifie((c) => {
      cellule(c, FEUILLE.champs, "B2").value = { formula: "1", result: 1 };
      cellule(c, FEUILLE.composantes, "D2").value = "FOIS(";
      cellule(c, FEUILLE.valeurs, "A2").value = "champ_fantome";
    });
    expect((await analyserClasseur(octets)).erreurs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("classeur du barème : fichiers piégés", () => {
  it("un fichier vide, trop gros ou qui n'est pas un classeur est refusé avant tout chargement", async () => {
    await expect(analyserClasseur(new Uint8Array())).rejects.toThrow(/vide/);
    await expect(analyserClasseur(new Uint8Array(TAILLE_MAX_CLASSEUR + 1))).rejects.toThrow(/dépasse/);
    await expect(analyserClasseur(new TextEncoder().encode("ceci n'est pas un zip"))).rejects.toBeInstanceOf(ErreurMetier);
  });

  it("une archive trop volumineuse une fois décompressée est refusée par JSZip avant ExcelJS", async () => {
    const zip = new JSZip();
    zip.file("xl/worksheets/sheet1.xml", "a".repeat(31 * 1024 * 1024)); // se compresse en quelques Ko
    const bombe = new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    expect(bombe.byteLength).toBeLessThan(TAILLE_MAX_CLASSEUR);
    await expect(analyserClasseur(bombe)).rejects.toThrow(/décompressé/);
  });

  it("une archive qui compte trop de parties est refusée", async () => {
    const zip = new JSZip();
    for (let i = 0; i < 250; i++) zip.file(`xl/p${i}.xml`, "<a/>");
    const octets = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    await expect(analyserClasseur(octets)).rejects.toThrow(/trop de parties/);
  });

  it("un classeur à feuille démesurée est refusé sans lire ses lignes", async () => {
    const octets = await modifie((c) => {
      c.getWorksheet(FEUILLE.champs)!.getCell("A25000").value = "x";
    });
    expect(await refs(octets)).toContain("Champs!A1 FEUILLE_TROP_GRANDE");
  });
});

describe("classeur du barème : accessoires par tranche d'effectif (B6a)", () => {
  const avecTranches = (): Bareme => {
    const d = structuredClone(documentSecurpro) as unknown as { produit: { accessoires: unknown }; garanties: { code: string; accessoires?: unknown }[] };
    d.produit.accessoires = { mode: "PAR_TRANCHE", tranches: [{ de: 1, a: 5, montant: "2500" }, { de: 6, a: 10, montant: "4000" }] };
    d.garanties.find((g) => g.code === "vol")!.accessoires = { mode: "PAR_TRANCHE", tranches: [{ de: 1, a: 3, montant: "1000.50" }, { de: 4, a: 9, montant: "3000" }] };
    return lireBareme(d);
  };

  it("aller-retour à empreinte identique, au niveau du produit et de la garantie", async () => {
    const b = avecTranches();
    const r = await analyserClasseur(await construireClasseur(b, { titre: "Tranches (test)" }));
    expect(r.erreurs).toEqual([]);
    expect(empreinteBareme(r.bareme)).toBe(empreinteBareme(b));
  });

  it("des tranches illisibles ou avec un trou sont nommées par cellule", async () => {
    const octets = await construireClasseur(avecTranches(), { titre: "Tranches (test)" });
    const illisibles = await charger(octets);
    illisibles.getWorksheet(FEUILLE.lisezmoi)!.eachRow((row) => {
      if (row.getCell(1).value === ETIQUETTE.accessoiresMontant) row.getCell(2).value = "1-5 2500";
    });
    const lecture = await analyserClasseur(await ecrire(illisibles));
    expect(lecture.erreurs.map((e) => e.regle)).toContain("TRANCHES_ILLISIBLES");

    const trou = await charger(octets);
    const lm = trou.getWorksheet(FEUILLE.lisezmoi)!;
    lm.eachRow((row) => {
      if (row.getCell(1).value === ETIQUETTE.accessoiresMontant) row.getCell(2).value = "1-5: 2500; 8-10: 4000";
    });
    const e = (await analyserClasseur(await ecrire(trou))).erreurs;
    expect(e.map((x) => x.regle)).toContain("TRANCHES_TROU");
    expect(e.find((x) => x.regle === "TRANCHES_TROU")!.message).toContain("effectifs 6 à 7");
  });
});
