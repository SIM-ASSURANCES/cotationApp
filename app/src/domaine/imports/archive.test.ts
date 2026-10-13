import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { ENTREES_MAX_XLSX, problemesArchiveXlsx, TAILLE_DECOMPRESSEE_MAX_XLSX } from "./archive";
import { fabriquerZip } from "./archive-test";

describe("archive Excel : contrôle avant chargement (audit B2)", () => {
  it("un vrai classeur de 5 000 lignes passe", async () => {
    const classeur = new ExcelJS.Workbook();
    const feuille = classeur.addWorksheet("Adherents");
    feuille.addRow(["nom_prenoms", "date_naissance", "formule"]);
    for (let i = 1; i <= 5000; i++) feuille.addRow([`Adhérent ${i} Inventé`, "1990-01-01", "SOLO"]);
    const octets = new Uint8Array(await classeur.xlsx.writeBuffer());
    expect(problemesArchiveXlsx(octets)).toEqual([]);
  });

  it("une archive qui se décompresse en plus de 30 Mo est refusée sans rien décompresser", () => {
    const bombe = fabriquerZip([{ nom: "xl/worksheets/sheet1.xml", donnees: Buffer.alloc(TAILLE_DECOMPRESSEE_MAX_XLSX + 1, 0x61) }]);
    expect(bombe.byteLength).toBeLessThan(100_000); // quelques Ko compressés : la limite de 10 Mo du fichier ne la voyait pas
    expect(problemesArchiveXlsx(bombe)).toEqual([expect.stringMatching(/trop volumineux une fois décompressé/)]);
  });

  it("la somme des parties compte, pas seulement chaque partie", () => {
    const morceau = Buffer.alloc(11 * 1024 * 1024, 0x61);
    const trois = fabriquerZip([1, 2, 3].map((n) => ({ nom: `xl/p${n}.xml`, donnees: morceau })));
    expect(problemesArchiveXlsx(trois)).toHaveLength(1);
    const deux = fabriquerZip([1, 2].map((n) => ({ nom: `xl/p${n}.xml`, donnees: morceau })));
    expect(problemesArchiveXlsx(deux)).toEqual([]);
  });

  it("une taille décompressée déclarée énorme est refusée (déclaration mensongère)", () => {
    const menteur = fabriquerZip([{ nom: "xl/workbook.xml", donnees: Buffer.from("<a/>"), tailleDeclaree: 4_000_000_000 }]);
    expect(problemesArchiveXlsx(menteur)).toHaveLength(1);
  });

  it("trop de parties : refusé", () => {
    const beaucoup = fabriquerZip(Array.from({ length: ENTREES_MAX_XLSX + 1 }, (_, i) => ({ nom: `p${i}.xml`, donnees: Buffer.from("x") })));
    expect(problemesArchiveXlsx(beaucoup)).toEqual([expect.stringMatching(/trop de parties/)]);
  });

  it("le répertoire est retrouvé même derrière un commentaire d'archive", () => {
    const avecCommentaire = fabriquerZip([{ nom: "a.xml", donnees: Buffer.alloc(TAILLE_DECOMPRESSEE_MAX_XLSX + 1) }], "commentaire ".repeat(500));
    expect(problemesArchiveXlsx(avecCommentaire)).toEqual([expect.stringMatching(/trop volumineux/)]);
  });

  it("un fichier qui n'est pas un ZIP, vide ou tronqué : « illisible », jamais d'exception", () => {
    expect(problemesArchiveXlsx(new Uint8Array(0))).toEqual([expect.stringMatching(/illisible/)]);
    expect(problemesArchiveXlsx(new TextEncoder().encode("ceci n'est pas un classeur Excel, loin de là, vraiment pas du tout"))).toEqual([expect.stringMatching(/illisible/)]);
    const bon = fabriquerZip([{ nom: "a.xml", donnees: Buffer.from("x") }]);
    expect(problemesArchiveXlsx(bon.slice(0, bon.length - 10))).toEqual([expect.stringMatching(/illisible/)]);
    const abime = bon.slice();
    abime[abime.length - 6] = 0xff; // décalage du répertoire central hors du fichier
    expect(problemesArchiveXlsx(abime)).toEqual([expect.stringMatching(/illisible/)]);
  });
});
