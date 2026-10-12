// Le proxy (premier filtre d'authentification) ne doit PAS s'exécuter sur les icônes générées ni sur les fichiers
// statiques : sinon un visiteur non connecté verrait sa requête de favicon redirigée vers /connexion.
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

// proxy.ts importe Auth.js, qui charge « next/server » : introuvable hors de Next.js. Ce test ne lit que `config`, donc
// l'authentification est remplacée par un faux. Le matcher, lui, doit rester un littéral dans proxy.ts (Next l'analyse à la
// construction et refuse un identifiant importé) : on ne peut pas l'extraire dans un fichier voisin, on importe le vrai.
vi.mock("next-auth", () => ({ default: () => ({ auth: () => undefined }) }));
vi.mock("@/serveur/auth.config", () => ({ authConfig: {} }));

import { config } from "./proxy";

/**
 * Approximation du matcher compilé par Next.js : le motif est ancré (^ … $) sur le chemin de la requête. Next ajoute en réalité
 * (path-to-regexp) un préfixe /_next/data et un suffixe .json/.rsc facultatifs, sans effet sur ces chemins : les verdicts ont
 * été comparés avec ceux des vraies fonctions de Next 16.3.8 (getMiddlewareMatchers) lors de la relecture de la refonte V1.
 */
const regles = (config.matcher as string[]).map((motif) => new RegExp(`^${motif}$`));
const passeParLeProxy = (chemin: string) => regles.some((regle) => regle.test(chemin));

describe("matcher du proxy", () => {
  it("n'a qu'un seul motif", () => {
    expect(regles).toHaveLength(1);
  });

  it.each(["/icon", "/apple-icon", "/logo-sim-couleur.svg", "/logo-sim-blanc.svg", "/_next/static/x.js", "/_next/image", "/favicon.ico"])(
    "%s ne passe pas par le proxy",
    (chemin) => {
      expect(passeParLeProxy(chemin)).toBe(false);
    },
  );

  it.each(["/", "/cotations", "/connexion", "/acces-refuse", "/icons", "/icon/x", "/apple-icons", "/apple-icon/x", "/verif/abc", "/api/sante", "/api/auth/signin"])(
    "%s passe par le proxy",
    (chemin) => {
      expect(passeParLeProxy(chemin)).toBe(true);
    },
  );
});

/** URL de chaque page, route d'API et icône de l'application, déduites des fichiers de src/app (groupes de routes retirés, [param] → x). */
function urlsDeLApplication(): string[] {
  const racine = join(dirname(fileURLToPath(import.meta.url)), "app");
  const urls: string[] = [];
  const parcourir = (dossier: string) => {
    for (const nom of readdirSync(dossier)) {
      const chemin = join(dossier, nom);
      if (statSync(chemin).isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!/^(?:page|route|icon|apple-icon)\.(?:tsx?|jsx?)$/.test(nom)) continue;
      const segments = relative(racine, dirname(chemin))
        .split(sep)
        .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
        .map((segment) => segment.replace(/^\[.*\]$/, "x"));
      if (/^(?:icon|apple-icon)\./.test(nom)) segments.push(nom.replace(/\.\w+$/, ""));
      urls.push(`/${segments.join("/")}`);
    }
  };
  parcourir(racine);
  return urls;
}

describe("matcher du proxy : aucune page de l'application n'échappe à l'authentification", () => {
  it("seules les deux icônes générées ne passent pas par le proxy", () => {
    const urls = urlsDeLApplication();
    expect(urls.length).toBeGreaterThan(30); // le parcours trouve bien les pages
    expect(urls).toEqual(expect.arrayContaining(["/icon", "/apple-icon", "/connexion", "/acces-refuse", "/verif/x"]));
    expect(urls.filter((url) => !passeParLeProxy(url)).sort()).toEqual(["/apple-icon", "/icon"]);
  });
});
