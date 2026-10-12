// Session 6.0 (§3) : chaque lien de la documentation pointe vers un fichier (et un titre) qui existe, et chaque commande
// citée par le README existe dans package.json ou docker-compose.yml.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (relatif: string) => readFileSync(join(RACINE, relatif), "utf8");

/** Ancre d'un titre telle que GitHub la calcule : minuscules, ponctuation retirée, espaces en tirets. */
const ancre = (titre: string) =>
  titre
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/ /g, "-");
const ancresDe = (markdown: string) => new Set([...markdown.matchAll(/^#{1,6} (.+)$/gm)].map((m) => ancre(m[1])));

/** Liens relatifs d'un fichier Markdown qui ne mènent nulle part. */
function liensCasses(fichier: string): string[] {
  const contenu = lire(fichier);
  const casses: string[] = [];
  for (const [, cible] of contenu.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(cible)) continue;
    const [chemin, fragment] = cible.split("#");
    const vise = chemin === "" ? join(RACINE, fichier) : join(RACINE, dirname(fichier), decodeURIComponent(chemin));
    if (!existsSync(vise)) {
      casses.push(`${fichier} : ${cible} (fichier absent)`);
      continue;
    }
    if (fragment && vise.endsWith(".md") && !ancresDe(readFileSync(vise, "utf8")).has(decodeURIComponent(fragment))) casses.push(`${fichier} : ${cible} (titre absent)`);
  }
  return casses;
}

describe("documentation : liens et commandes", () => {
  it("chaque lien relatif du README, du guide d'installation, du guide de déploiement et de app/README.md existe", () => {
    expect(["README.md", "app/README.md", "docs/installation.md", "docs/deploiement.md", "docs/guide-balisage.md"].flatMap(liensCasses)).toEqual([]);
  });

  it("chaque « npm run … » du README existe dans app/package.json", () => {
    const scripts = Object.keys((JSON.parse(lire("app/package.json")) as { scripts: Record<string, string> }).scripts);
    const cites = [...lire("README.md").matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    expect(cites.length).toBeGreaterThan(5);
    expect(cites.filter((c) => !scripts.includes(c))).toEqual([]);
  });

  it("chaque service cité par une commande « docker compose » du README existe dans docker-compose.yml", () => {
    const compose = lire("docker-compose.yml");
    const services = [...compose.slice(compose.indexOf("\nservices:"), compose.indexOf("\nvolumes:")).matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1]);
    expect(services).toEqual(expect.arrayContaining(["app", "generateur", "postgres", "redis", "travailleur", "outils"]));
    const cites = [...lire("README.md").matchAll(/docker compose (?:run --rm(?: -e \S+)*|exec|logs) ([\w-]+)/g)].map((m) => m[1]);
    expect(cites.length).toBeGreaterThan(2);
    expect(cites.filter((c) => !services.includes(c))).toEqual([]);
  });
});
