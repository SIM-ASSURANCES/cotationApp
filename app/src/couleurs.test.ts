// Refonte visuelle V1 : plus AUCUNE couleur en dur dans le code. Les couleurs vivent dans app/globals.css (tokens) et sont
// exposées en classes Tailwind sémantiques (bg-primary, text-danger, border-border…). Ce test parcourt les sources et refuse :
//   - une classe de la palette Tailwind (bg-blue-600, text-zinc-700, border-red-300…) ;
//   - bg-white, text-white, bg-black… (utiliser bg-surface, text-primary-foreground…) ;
//   - une valeur arbitraire de couleur (bg-[#123456], shadow-[…rgba(…)]) ;
//   - un littéral de couleur dans le code (« #004b9c », rgb(), rgba(), hsl()) ou une couleur en style en ligne ;
//   - un ancien token de la charte d'avant la refonte (sim-bleu, sim-ciel, sim-marine, bordure, bandeau-sim).
// Méthode retenue plutôt qu'une règle ESLint : un seul fichier à lire, des messages qui disent quoi utiliser à la place, et il
// couvre aussi les littéraux hors classes (icônes générées) ; une règle no-restricted-syntax reste possible (voir D30).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RACINE_SRC = dirname(fileURLToPath(import.meta.url));

/** Fichiers où une couleur est écrite en clair, à dessein : les tokens eux-mêmes, et les icônes générées par next/og (qui ne lit pas les variables CSS). */
const AUTORISES = ["app/globals.css", "composants/ui/pictogramme.ts"];

const PALETTE = "(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|stone|neutral|mauve|olive|mist|taupe)";
const PREFIXES = "(?:bg|text|border|border-[xytblrse]|ring|ring-offset|inset-ring|outline|fill|stroke|divide|from|to|via|accent|decoration|placeholder|shadow|inset-shadow|drop-shadow|text-shadow|caret)";

const REGLES: { motif: RegExp; message: string }[] = [
  // « neutral-bg » et « neutral-border » sont des tokens ; seul « neutral-500 » (avec chiffres) est la palette Tailwind.
  { motif: new RegExp(`(?<![\\w-])${PREFIXES}-${PALETTE}-\\d{2,3}(?:/\\d+)?(?![\\w-])`, "g"), message: "classe de la palette Tailwind : utiliser un token (primary, danger, warning, info, success, neutral, muted…)" },
  { motif: new RegExp(`(?<![\\w-])${PREFIXES}-(?:white|black)(?:/\\d+)?(?![\\w-])`, "g"), message: "bg-white / text-white / …-black : utiliser bg-surface, text-primary-foreground, text-foreground…" },
  { motif: /\[(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\()/g, message: "valeur arbitraire de couleur dans une classe" },
  // bg-[red], text-[color:tomato] : un nom de couleur CSS entre crochets, dans une classe (et non un indice de tableau).
  { motif: new RegExp(`(?<![\\w-])${PREFIXES}-\\[(?:color:[^\\]]+|[a-z]+)\\]`, "g"), message: "nom de couleur CSS dans une classe arbitraire" },
  { motif: /["'`]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})["'`]/g, message: "littéral de couleur hexadécimal" },
  { motif: /(?<![A-Za-z0-9-])(?:rgba?|hsla?)\(/g, message: "couleur rgb()/rgba()/hsl() dans le code" },
  { motif: /sim-(?:bleu|ciel|marine)(?![\w-])|(?<![\w-])(?:border-bordure|bg-bordure|text-bordure|bandeau-sim)(?![\w-])/g, message: "ancien token d'avant la refonte" },
];

/** Constats d'un texte source : [numéro de ligne, extrait, message]. */
export function constatsDeCouleur(source: string): [number, string, string][] {
  const constats: [number, string, string][] = [];
  const lignes = source.split("\n");
  lignes.forEach((ligne, i) => {
    for (const { motif, message } of REGLES) {
      for (const m of ligne.matchAll(motif)) constats.push([i + 1, m[0], message]);
    }
  });
  // Un style en ligne peut tenir sur plusieurs lignes : on cherche sur le texte entier, puis on retrouve le numéro de ligne. Seule une
  // valeur littérale est refusée : `background: COULEURS_ICONE.fond` (icônes next/og, qui ne lisent pas les variables CSS) est permis. Seule une
  // valeur littérale est refusée : `background: COULEURS_ICONE.fond` (icônes next/og, qui ne lisent pas les variables CSS) est permis.
  for (const m of source.matchAll(/style=\{\{[^}]*\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*["'`]/g)) {
    constats.push([source.slice(0, m.index).split("\n").length, m[0].replace(/\s+/g, " "), "couleur en style en ligne"]);
  }
  return constats.sort((a, b) => a[0] - b[0]);
}

function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === "generated" || nom === "node_modules" ? [] : sources(chemin);
    return /\.(?:tsx?|css|mts)$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : [];
  });
}

describe("aucune couleur en dur dans le code (design system, refonte visuelle)", () => {
  it("les sources de src/ n'utilisent que les tokens de globals.css", () => {
    const fichiers = sources(RACINE_SRC);
    expect(fichiers.length).toBeGreaterThan(40); // le parcours trouve bien l'application
    const fautes = fichiers
      .filter((f) => !AUTORISES.includes(relative(RACINE_SRC, f).replaceAll("\\", "/")))
      .flatMap((f) => constatsDeCouleur(readFileSync(f, "utf8")).map(([ligne, extrait, message]) => `${relative(RACINE_SRC, f)}:${ligne} « ${extrait} » : ${message}`));
    expect(fautes).toEqual([]);
  });

  it("la détection voit bien les écritures interdites (le test n'est pas aveugle)", () => {
    const interdits = [
      'className="bg-blue-600"',
      'className="text-zinc-700 hover:text-red-800"',
      'className="border-red-300/50"',
      'className="bg-white p-4"',
      'className="text-white"',
      'className="bg-[#004b9c]"',
      'className="shadow-[0_4px_10px_rgba(0,0,0,0.25)]"',
      'const fond = "#004B9C";',
      "const fond = '#fff';",
      "const c = rgb(0, 75, 156);",
      '<div style={{ color: "x" }} />',
      'className="text-sim-bleu"',
      'className="border-bordure"',
      'className="bandeau-sim"',
      'className="ring-neutral-500"',
      'className="bg-mauve-500 text-taupe-700 border-olive-200 bg-mist-100"',
      'className="inset-shadow-red-500 drop-shadow-red-500 inset-ring-red-500"',
      'className="text-[color:tomato] bg-[red]"',
      '<div style={{\n  color: "red",\n}} />',
    ];
    for (const source of interdits) expect(constatsDeCouleur(source), source).not.toEqual([]);
  });

  it("la détection laisse passer les tokens du design system et les chaînes ordinaires", () => {
    const permis = [
      'className="bg-primary text-primary-foreground hover:bg-primary-hover"',
      'className="border-border bg-surface text-foreground"',
      'className="bg-danger-bg text-danger border-danger-border"',
      'className="bg-neutral-bg text-neutral border-neutral-border"',
      'className="bg-primary/10 text-sidebar-section"',
      'className="bg-sim-blue-dark text-sim-blue-light"',
      'className="shadow-elevated-lg animate-fade-in-up ease-out-strong"',
      '<a href="#contenu">Aller au contenu</a>',
      "const identifiant = '#abc-1';",
      "const premier = lignes[index]; const coul = tableau[rouge];",
      "<div style={{ background: COULEURS_ICONE.fond, width: 32 }} />",
      'className="shadow-[0_0_0_1px_var(--color-border)]"',
    ];
    for (const source of permis) expect(constatsDeCouleur(source), source).toEqual([]);
  });
});
