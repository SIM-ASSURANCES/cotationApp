import { describe, expect, it } from "vitest";

import {
  ASSIETTES_TAXE,
  COMPOSANTES,
  MODES_ACCESSOIRE,
  NIVEAUX_ARRONDI,
  calculer,
  type Composants,
  type RegleArrondi,
} from "./calcul";
import { genererEcheancier } from "./echeancier";
import { PRECISIONS, SENS_ARRONDI, arrondir, montant } from "./montant";

/** Générateur pseudo-aléatoire déterministe : les tests sont reproductibles à l'identique. */
function aleatoire(graine: number) {
  let s = graine;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const entre = (a: () => number, min: number, max: number) => min + Math.floor(a() * (max - min + 1));
/** Montant décimal aléatoire, avec 2 décimales, fabriqué en texte (jamais en nombre à virgule). */
const montantTexte = (a: () => number, maxEntier: number) => `${entre(a, 1, maxEntier)}.${String(entre(a, 0, 99)).padStart(2, "0")}`;

const estMultiple = (m: ReturnType<typeof montant>, precision: number) => m.mod(precision).isZero();

function coherent(c: Composants): boolean {
  return c.ttc.eq(c.nette.plus(c.accessoires).plus(c.taxe));
}

describe("invariants du moteur sur 72 règles d'arrondi × 40 cotations aléatoires", () => {
  const regles: RegleArrondi[] = PRECISIONS.flatMap((precision) =>
    SENS_ARRONDI.flatMap((sens) =>
      NIVEAUX_ARRONDI.flatMap((niveau) => COMPOSANTES.map((composanteAbsorbante) => ({ precision, sens, niveau, composanteAbsorbante }))),
    ),
  );

  it("couvre bien 72 règles", () => {
    expect(regles).toHaveLength(72);
  });

  it("TTC = nette + accessoires + taxe après arrondi, partout, et montants multiples de la précision", () => {
    const hasard = aleatoire(20261005);
    for (const regle of regles) {
      for (let i = 0; i < 40; i += 1) {
        const lignes = Array.from({ length: entre(hasard, 1, 3) }, (_, k) => ({
          code: `F${k}`,
          primeUnitaire: montantTexte(hasard, 500_000),
          effectif: entre(hasard, 1, 80),
          accessoire: { mode: MODES_ACCESSOIRE[entre(hasard, 0, 4)], valeur: montantTexte(hasard, 5000) },
        }));
        const jour = entre(hasard, 1, 28);
        const resultat = calculer({
          dateEffet: `2026-0${entre(hasard, 1, 9)}-${String(jour).padStart(2, "0")}`,
          dateEcheance: "2026-12-31",
          parametres: {
            prorata: { actif: hasard() > 0.3, primeMinimale: hasard() > 0.7 ? montantTexte(hasard, 20000) : null },
            arrondi: regle,
            taxe: { tauxPourcent: ["1.5", "0", "3", "2.25"][entre(hasard, 0, 3)], assiette: ASSIETTES_TAXE[entre(hasard, 0, 1)] },
            fraisFractionnement: hasard() > 0.5 ? "1500" : undefined,
          },
          lignes,
        });

        const toutes = [...resultat.lignes, ...(resultat.fraisFractionnement ? [resultat.fraisFractionnement] : [])];
        for (const ligne of toutes) {
          expect(coherent(ligne.arrondi), `ligne ${ligne.code}, règle ${JSON.stringify(regle)}`).toBe(true);
          expect(coherent(ligne.exact)).toBe(true);
          for (const c of [ligne.arrondi.nette, ligne.arrondi.accessoires, ligne.arrondi.taxe, ligne.arrondi.ttc]) {
            expect(estMultiple(c, regle.precision), `${c} multiple de ${regle.precision}`).toBe(true);
          }
        }
        expect(coherent(resultat.totaux.arrondi), `totaux, règle ${JSON.stringify(regle)}`).toBe(true);
        if (regle.niveau === "LIGNE") {
          const sommeTtc = toutes.reduce((s, l) => s.plus(l.arrondi.ttc), montant("0"));
          expect(resultat.totaux.arrondi.ttc.eq(sommeTtc), "total = somme des lignes arrondies").toBe(true);
        } else {
          expect(
            resultat.totaux.arrondi.ttc.eq(arrondir(resultat.totaux.exact.ttc, regle.precision, regle.sens)),
            "total = somme exacte arrondie",
          ).toBe(true);
        }
      }
    }
  });
});

describe("échéancier : la somme égale le TTC pour des TTC et des nombres de tranches aléatoires", () => {
  it("1 000 cas, avec arrondi à 1, 10, 100 et 1 000 F", () => {
    const hasard = aleatoire(424242);
    for (let i = 0; i < 1000; i += 1) {
      const precision = PRECISIONS[i % 4];
      const nombre = entre(hasard, 1, 12);
      const ttc = String(entre(hasard, nombre * precision * 2, 900_000_000));
      const tranches = genererEcheancier({
        ttc,
        nombreTranches: nombre,
        dateEffet: "2026-03-31",
        arrondi: { precision, sens: SENS_ARRONDI[i % 3] },
      });

      const total = tranches.reduce((s, t) => s.plus(t.montant), montant("0"));
      expect(total.eq(ttc), `TTC ${ttc} en ${nombre} tranches (précision ${precision})`).toBe(true);
      expect(tranches).toHaveLength(nombre);
    }
  });
});
