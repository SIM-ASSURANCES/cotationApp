import { afterEach, describe, expect, it } from "vitest";

import { espacesOrdinaires, exigerPdftotext, MESSAGE_PDFTOTEXT_ABSENT, texteDuPdf } from "./pdf-test";

// Aide des tests de bout en bout qui lisent le texte des PDF : normalisation des espaces et échec EXPLICITE sans pdftotext.

const PATH = process.env.PATH;
afterEach(() => {
  process.env.PATH = PATH;
});

describe("espacesOrdinaires : le texte d'un PDF et les montants attendus se comparent sur la même base", () => {
  it("espace insécable (U+00A0) et espace fine insécable (U+202F, toLocaleString fr-FR) deviennent une espace ordinaire", () => {
    expect(espacesOrdinaires("139 420 F CFA")).toBe("139 420 F CFA");
    expect(espacesOrdinaires(Number(139420).toLocaleString("fr-FR"))).toBe("139 420");
    expect(espacesOrdinaires("a b")).toBe("a b");
  });
});

describe("pdftotext absent : le test échoue avec un message clair, il ne s'arrête plus en silence", () => {
  it("exigerPdftotext et texteDuPdf lèvent le message qui dit quoi installer", () => {
    process.env.PATH = "";
    expect(() => exigerPdftotext()).toThrow(MESSAGE_PDFTOTEXT_ABSENT);
    expect(() => texteDuPdf(new Uint8Array([37, 80, 68, 70]))).toThrow(/poppler-utils/);
    expect(MESSAGE_PDFTOTEXT_ABSENT).toContain("app/Dockerfile.tests");
  });
});
