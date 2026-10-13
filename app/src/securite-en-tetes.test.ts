import { describe, expect, it } from "vitest";

import nextConfig, { politiqueDeSecurite } from "../next.config";

describe("Content-Security-Policy (audit M3)", () => {
  const production = politiqueDeSecurite(false);
  const directives = new Map(production.split("; ").map((d) => [d.split(" ")[0], d] as const));

  it("interdit l'encadrement, les objets, les changements de base d'URL et l'envoi de formulaires ou de données vers un autre site", () => {
    expect(directives.get("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directives.get("object-src")).toBe("object-src 'none'");
    expect(directives.get("base-uri")).toBe("base-uri 'self'");
    expect(directives.get("form-action")).toBe("form-action 'self'");
    expect(directives.get("connect-src")).toBe("connect-src 'self'");
    expect(directives.get("default-src")).toBe("default-src 'self'");
  });

  it("n'autorise aucun script d'un autre site, et pas eval en production (seulement en développement)", () => {
    expect(directives.get("script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(production).not.toContain("unsafe-eval");
    expect(production).not.toMatch(/https?:|\*/);
    expect(politiqueDeSecurite(true)).toContain("'unsafe-eval'");
  });

  it("est envoyée sur toutes les routes, avec les autres en-têtes de sécurité", async () => {
    const regles = await nextConfig.headers!();
    const toutes = regles.find((r) => r.source === "/:path*")!;
    const noms = toutes.headers.map((h) => h.key);
    expect(noms).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Frame-Options", "Strict-Transport-Security", "X-Content-Type-Options"]));
  });
});
