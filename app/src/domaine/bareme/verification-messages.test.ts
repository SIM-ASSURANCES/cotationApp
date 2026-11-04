import { describe, expect, it } from "vitest";

import { lireBareme } from "./schema";
import { documentSecurpro } from "./securpro-fixture";
import { verifierBareme } from "./verification";

type Doc = typeof documentSecurpro;
const variante = (modifie: (d: Doc) => void) => {
  const d = structuredClone(documentSecurpro);
  modifie(d);
  return verifierBareme(lireBareme(d), { publication: true });
};
const message = (p: { code: string; message: string }[], code: string) => p.find((x) => x.code === code)?.message ?? "";

// D63 : un message de vérification dit QUOI FAIRE, sans changer la règle (les codes et les cas refusés sont ceux de verification.test.ts).
describe("verifierBareme : les messages disent quoi faire", () => {
  it("TAUX_SANS_SOURCE, aucun E1 : créer un sous-jacent E1 qui lit une table et vise la composante", () => {
    const p = variante((d) => {
      d.sousJacents = d.sousJacents.filter((s) => s.code !== "classe");
    });
    const m = message(p, "TAUX_SANS_SOURCE");
    expect(m).toContain("aucun ne la vise");
    expect(m).toContain("Créez un sous-jacent E1 qui lit une table et vise cette composante");
  });

  it("TAUX_SANS_SOURCE, deux E1 : n'en garder qu'un", () => {
    const p = variante((d) => {
      d.sousJacents.push({ code: "x", effet: "E1", table: "taux_incendie", cibles: ["incendie"] } as never);
    });
    const m = message(p, "TAUX_SANS_SOURCE");
    expect(m).toContain("2 la visent");
    expect(m).toContain("Gardez un seul sous-jacent E1");
  });

  it("E1_SUR_TAUX_FIXE : retirer la cible, ou lire le taux dans une table", () => {
    const p = variante((d) => {
      d.sousJacents.push({ code: "x", effet: "E1", table: "taux_incendie", cibles: ["dde"] } as never);
    });
    const m = message(p, "E1_SUR_TAUX_FIXE");
    expect(m).toContain("a un taux fixe, un sous-jacent E1 ne peut pas le remplacer.");
    expect(m).toContain("Retirez cette composante des cibles du sous-jacent");
  });
});
