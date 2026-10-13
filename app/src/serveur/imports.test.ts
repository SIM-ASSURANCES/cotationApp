import { describe, expect, it } from "vitest";

import { fabriquerZip } from "@/domaine/imports/archive-test";

import { lireFichierImport } from "./imports";
import { ErreurMetier } from "./types";

describe("lecture d'un fichier d'import : classeur piégé (audit B2)", () => {
  it("un .xlsx qui se décompresse en plus de 30 Mo est refusé AVANT le chargement", async () => {
    const bombe = fabriquerZip([{ nom: "xl/worksheets/sheet1.xml", donnees: Buffer.alloc(60 * 1024 * 1024, 0x61) }]);
    expect(bombe.byteLength).toBeLessThan(200_000); // sous la limite de 10 Mo du fichier
    const debut = Date.now();
    await expect(lireFichierImport("bombe.xlsx", bombe)).rejects.toThrow(/trop volumineux une fois décompressé/);
    expect(Date.now() - debut).toBeLessThan(2000); // aucune décompression, aucun chargement
  });

  it("une taille déclarée mensongère ne contourne pas le contrôle : ExcelJS (JSZip) refuse de décompresser", async () => {
    // Le répertoire dit 10 octets, la partie en contient 60 Mo : le contrôle de taille passe, le chargement doit échouer.
    const menteur = fabriquerZip([{ nom: "xl/worksheets/sheet1.xml", donnees: Buffer.alloc(60 * 1024 * 1024, 0x61), tailleDeclaree: 10 }]);
    await expect(lireFichierImport("menteur.xlsx", menteur)).rejects.toThrow(/illisible/);
  });

  it("les formats CSV restent lus, un fichier vide ou trop gros reste refusé", async () => {
    expect(await lireFichierImport("a.csv", new TextEncoder().encode("nom_prenoms;date_naissance;formule\nAwa Inventée;14/03/1988;SOLO"))).toHaveLength(1);
    await expect(lireFichierImport("a.xlsx", new Uint8Array(0))).rejects.toThrow(/vide/);
  });

  it("archive tronquée ou corrompue : message clair (ErreurMetier), jamais une erreur du serveur", async () => {
    const bon = fabriquerZip([{ nom: "xl/workbook.xml", donnees: Buffer.from("<workbook/>") }]);
    const tronque = bon.slice(0, bon.length - 30);
    const corrompu = bon.slice();
    corrompu.fill(0x41, 40, 80); // abîme l'en-tête de la première partie
    const hasard = new Uint8Array(4096).map((_, i) => (i * 131) % 251);
    for (const fichier of [tronque, corrompu, hasard]) {
      const erreur = await lireFichierImport("abime.xlsx", fichier).then(
        () => null,
        (e: unknown) => e,
      );
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).message).toMatch(/illisible/);
    }
  });
});
