import { spawnSync } from "node:child_process";

/**
 * Lecture du texte d'un PDF pour les tests de bout en bout (`*.e2e.test.ts`). Un e2e qui lit un PDF a BESOIN de `pdftotext` (paquet
 * `poppler-utils`, installé dans l'image de test : `app/Dockerfile.tests`) : s'il manque, le test ÉCHOUE avec un message clair, il ne
 * s'arrête plus en silence avant ses contrôles de texte.
 */

export const MESSAGE_PDFTOTEXT_ABSENT =
  "pdftotext est introuvable : les tests de bout en bout lisent le texte des PDF avec cet outil. Installez poppler-utils (apt-get install poppler-utils) ou utilisez l'image de test app/Dockerfile.tests.";

/** Espace insécable (U+00A0) et espace fine insécable (U+202F, séparateur de milliers de `toLocaleString("fr-FR")`) → espace ordinaire. */
export const espacesOrdinaires = (texte: string): string => texte.replace(/[  ]/g, " ");

/** Échoue (message clair) si `pdftotext` n'est pas installé. À appeler dans le `beforeAll` d'un e2e qui lit des PDF, pour échouer avant le travail long. */
export function exigerPdftotext(): void {
  if (spawnSync("pdftotext", ["-v"]).error !== undefined) throw new Error(MESSAGE_PDFTOTEXT_ABSENT);
}

function extraire(pdf: Uint8Array): string {
  exigerPdftotext();
  const r = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(pdf), maxBuffer: 20_000_000 });
  if (r.status !== 0) throw new Error(`pdftotext n'a pas pu lire le PDF (code ${String(r.status)}) : ${r.stderr.toString("utf8").trim()}`);
  return espacesOrdinaires(r.stdout.toString("utf8"));
}

/** Texte d'un PDF, les espaces insécables ramenés à l'espace ordinaire ; les retours à la ligne sont conservés (lecture ligne à ligne). */
export const texteDuPdf = (pdf: Uint8Array): string => extraire(pdf);

/** Même texte, tous les blancs réduits à une espace : les cellules étroites d'un tableau passent à la ligne dans le texte extrait. */
export const texteCompactDuPdf = (pdf: Uint8Array): string => extraire(pdf).replace(/\s+/g, " ");
