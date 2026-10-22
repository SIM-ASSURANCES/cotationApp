// Les déclencheurs de la base se reconnaissent à leur code d'erreur (refus-base.ts) : ce test, sans base de données, garde cette règle
// vraie pour toute migration, présente ou future. Un nouveau déclencheur qui lèverait un autre code, ou qui poserait un champ réservé
// aux erreurs natives (constraint, table, detail…), verrait son message remplacé par le message générique à l'écran.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DOSSIER = join(process.cwd(), "prisma", "migrations");

const instructions = readdirSync(DOSSIER, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    const sql = readFileSync(join(DOSSIER, d.name, "migration.sql"), "utf8");
    return [...sql.matchAll(/RAISE\s+EXCEPTION\b([^;]*);/g)].map((m) => ({ migration: d.name, texte: m[1] }));
  });

describe("RAISE EXCEPTION des migrations", () => {
  it("toutes les instructions sont repérées (aucune n'est coupée par un point-virgule dans un message)", () => {
    const total = readdirSync(DOSSIER, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .reduce((n, d) => n + (readFileSync(join(DOSSIER, d.name, "migration.sql"), "utf8").match(/RAISE\s+EXCEPTION\b/g) ?? []).length, 0);
    expect(instructions.length).toBe(total);
    expect(total).toBeGreaterThan(50);
  });

  it("chacune lève P0001 (sans ERRCODE), restrict_violation ou check_violation", () => {
    const autres = instructions.filter((i) => {
      const code = i.texte.match(/ERRCODE\s*=\s*'(\w+)'/)?.[1];
      return code !== undefined && !["restrict_violation", "check_violation"].includes(code);
    });
    expect(autres.map((i) => `${i.migration} : ${i.texte.trim().slice(0, 80)}`)).toEqual([]);
  });

  it("aucune ne pose DETAIL, CONSTRAINT, TABLE, COLUMN, SCHEMA ou DATATYPE (réservés aux erreurs natives dans le filtre)", () => {
    const fautives = instructions.filter((i) => /\b(DETAIL|CONSTRAINT|TABLE|COLUMN|SCHEMA|DATATYPE)\s*=/.test(i.texte));
    expect(fautives.map((i) => `${i.migration} : ${i.texte.trim().slice(0, 80)}`)).toEqual([]);
  });
});
