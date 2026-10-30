// Garde-fou de la session B5 : l'attendu d'un jeu d'essai est TAPÉ par la Technique, jamais rempli avec le résultat du moteur (l'essai
// deviendrait une tautologie). On vérifie sur les sources que ni le module d'édition des essais ni l'onglet ne touchent au calcul.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ici = dirname(fileURLToPath(import.meta.url));

describe("garde-fou : l'attendu n'est jamais rempli par le moteur", () => {
  it("les modules d'édition des essais n'importent ni le moteur ni l'exécution des essais", () => {
    const interdits = [/from "\.\/bareme"/, /from "\.\/essais"/, /from "\.\/garantie"/, /from "\.\/operandes"/, /calculerBareme|rejouerJeuxEssai|composerBareme/];
    const source = readFileSync(join(ici, "domaine/bareme/edition-essais.ts"), "utf8");
    for (const motif of interdits) expect(source).not.toMatch(motif);
  });
  it("aucun composant de l'éditeur ne lit un résultat de calcul pour pré-remplir un attendu", () => {
    const composant = readFileSync(join(ici, "composants/bareme/OngletEssais.tsx"), "utf8");
    expect(composant).not.toMatch(/calculerBareme|rejouerJeuxEssai|composerBareme|\.lignes\.map\(.*nette/);
    // Les seuls montants lus par l'onglet sont ceux de l'attendu déjà tapé (l.nette…) et les écarts affichés après un rejeu.
    expect(composant).toContain("jamais calculé par l&apos;application");
  });
});
