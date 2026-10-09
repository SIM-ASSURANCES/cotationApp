// Ordre des migrations Prisma (demande de Thierry du 08/10/2026, session 4b). Prisma applique les migrations dans
// l'ordre ALPHABÉTIQUE de leur dossier : sur une base neuve, une migration nommée avant une autre passe avant elle.
// Ce test, sans base de données, vérifie :
//   1. que chaque nom suit le format AAAAMMJJHHMMSS_nom et que les horodatages sont STRICTEMENT croissants (pas de doublon) ;
//   2. que toute migration ajoutée après la session 4a porte un horodatage postérieur à 20261009100000, et toute migration
//      ajoutée après la 4b un horodatage postérieur à 20261009110000 (phase 5) ;
//   3. qu'aucune migration ne dépend d'un objet (table, fonction, type) créé par une migration nommée APRÈS elle.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DOSSIER = join(process.cwd(), "prisma", "migrations");

/** Dernière migration de la session 4a : toute migration nouvelle doit être nommée après elle. */
const DERNIERE_MIGRATION_4A = "20261009100000";

/** Migrations existantes à la fin de la session 4a (déjà appliquées sur des bases : jamais renommées). */
const MIGRATIONS_4A = [
  "20261005123713_init",
  "20261005143951_auth_profils_audit",
  "20261005151311_parametrage_produits",
  "20261005165029_validite_en_mois",
  "20261005170237_cotations",
  "20261006125718_modeles",
  "20261006144739_documents_emis",
  "20261008100000_taxes_type_contrat_cotation",
  "20261008120000_branches_fiscales",
  "20261009090000_contrats_4a",
  "20261009100000_validation_contrat_et_droits",
];

/** Migrations ajoutées par la session 4b ; toute migration plus récente est nommée après la dernière (phase 5). */
const MIGRATIONS_4B = ["20261009110000_factures_paiements_recus"];
const DERNIERE_MIGRATION_4B = "20261009110000";

/** Migration de la session 5a ; toute migration plus récente (corrections de la 5a, 5b) est nommée après elle. */
const MIGRATIONS_5A = ["20261009120000_import_masse_stockage_differe"];
const DERNIERE_MIGRATION_5A = "20261009120000";

type Migration = { nom: string; sql: string };

/** SQL sans commentaires ni textes entre apostrophes (messages d'erreur, valeurs) : seuls restent les identifiants. */
export function nettoyer(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Objets créés par une migration : tables, fonctions, types (énumérations), en minuscules. */
export function objetsCrees(sql: string): string[] {
  const propre = nettoyer(sql);
  const motifs = [
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi,
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?([a-z_][a-z0-9_]*)"?/gi,
    /CREATE\s+TYPE\s+"?([a-z_][a-z0-9_]*)"?/gi,
  ];
  return [...new Set(motifs.flatMap((m) => [...propre.matchAll(m)].map((r) => r[1].toLowerCase())))];
}

/** Un objet est-il cité dans le SQL (identifiant entier, entre guillemets ou non) ? */
export function cite(sql: string, objet: string): boolean {
  return new RegExp(`(^|[^a-z0-9_])"?${objet}"?($|[^a-z0-9_])`, "i").test(nettoyer(sql));
}

/** Dépendances « à l'envers » : migration qui cite un objet créé seulement par une migration nommée après elle. */
export function dependancesInversees(migrations: Migration[]): string[] {
  const ordre = [...migrations].sort((a, b) => a.nom.localeCompare(b.nom));
  const createur = new Map<string, number>();
  ordre.forEach((m, i) => {
    for (const objet of objetsCrees(m.sql)) if (!createur.has(objet)) createur.set(objet, i);
  });
  const problemes: string[] = [];
  ordre.forEach((m, i) => {
    for (const [objet, j] of createur) {
      if (j > i && cite(m.sql, objet)) problemes.push(`${m.nom} utilise « ${objet} », créé par ${ordre[j].nom}, nommée après elle.`);
    }
  });
  return problemes;
}

/** Noms mal formés ou horodatages non strictement croissants. */
export function problemesNoms(noms: string[]): string[] {
  const problemes: string[] = [];
  const tries = [...noms].sort();
  tries.forEach((nom, i) => {
    const r = /^(\d{14})_[a-z0-9_]+$/.exec(nom);
    if (!r) {
      problemes.push(`« ${nom} » : nom attendu AAAAMMJJHHMMSS_nom (minuscules, chiffres, _).`);
      return;
    }
    const h = r[1];
    const date = new Date(`${h.slice(0, 4)}-${h.slice(4, 6)}-${h.slice(6, 8)}T${h.slice(8, 10)}:${h.slice(10, 12)}:${h.slice(12, 14)}Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19).replace(/\D/g, "") !== h) problemes.push(`« ${nom} » : horodatage impossible.`);
    if (i > 0 && tries[i - 1].slice(0, 14) >= h) problemes.push(`« ${nom} » : même horodatage que « ${tries[i - 1]} » (ordre d'application ambigu).`);
  });
  return problemes;
}

const migrations = (): Migration[] =>
  readdirSync(DOSSIER, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ nom: e.name, sql: readFileSync(join(DOSSIER, e.name, "migration.sql"), "utf8") }));

describe("ordre des migrations du dépôt", () => {
  const toutes = migrations();
  const noms = toutes.map((m) => m.nom);

  it("les noms sont bien formés et leurs horodatages strictement croissants", () => {
    expect(problemesNoms(noms)).toEqual([]);
  });

  it("les migrations de la 4a sont toutes là, sous leur nom d'origine", () => {
    expect(noms.filter((n) => MIGRATIONS_4A.includes(n)).sort()).toEqual(MIGRATIONS_4A);
  });

  it(`toute nouvelle migration est nommée après ${DERNIERE_MIGRATION_4A}`, () => {
    const nouvelles = noms.filter((n) => !MIGRATIONS_4A.includes(n));
    expect(nouvelles.filter((n) => n.slice(0, 14) <= DERNIERE_MIGRATION_4A)).toEqual([]);
  });

  it(`toute migration plus récente que la 4b est nommée après ${DERNIERE_MIGRATION_4B}`, () => {
    expect(noms.filter((n) => MIGRATIONS_4B.includes(n))).toEqual(MIGRATIONS_4B);
    const nouvelles = noms.filter((n) => !MIGRATIONS_4A.includes(n) && !MIGRATIONS_4B.includes(n));
    expect(nouvelles.filter((n) => n.slice(0, 14) <= DERNIERE_MIGRATION_4B)).toEqual([]);
  });

  it(`toute migration plus récente que la 5a est nommée après ${DERNIERE_MIGRATION_5A}`, () => {
    expect(noms.filter((n) => MIGRATIONS_5A.includes(n))).toEqual(MIGRATIONS_5A);
    const nouvelles = noms.filter((n) => !MIGRATIONS_4A.includes(n) && !MIGRATIONS_4B.includes(n) && !MIGRATIONS_5A.includes(n));
    expect(nouvelles.filter((n) => n.slice(0, 14) <= DERNIERE_MIGRATION_5A)).toEqual([]);
  });

  it("aucune migration ne dépend d'une migration nommée après elle", () => {
    expect(dependancesInversees(toutes)).toEqual([]);
  });
});

describe("contrôles eux-mêmes (cas inventés)", () => {
  it("détecte un horodatage en double, un nom mal formé et une date impossible", () => {
    expect(problemesNoms(["20261009100000_a", "20261009100000_b"])).toHaveLength(1);
    expect(problemesNoms(["2026_a"])).toHaveLength(1);
    expect(problemesNoms(["20261332100000_a"])).toHaveLength(1);
    expect(problemesNoms(["20261009100000_a", "20261009100001_b"])).toEqual([]);
  });

  it("détecte une migration qui utilise une table créée plus tard, pas l'inverse ; ignore commentaires et textes", () => {
    const creeFactures = { nom: "20261010000000_factures", sql: 'CREATE TABLE "factures" ("id" SERIAL);' };
    const utilise = (nom: string) => ({ nom, sql: 'ALTER TABLE "factures" ADD COLUMN "x" INTEGER;' });
    expect(dependancesInversees([creeFactures, utilise("20261009000000_avant")])).toHaveLength(1);
    expect(dependancesInversees([creeFactures, utilise("20261011000000_apres")])).toEqual([]);
    const commentaire = { nom: "20261009000000_avant", sql: "-- les factures viendront plus tard\nSELECT 'factures';" };
    expect(dependancesInversees([creeFactures, commentaire])).toEqual([]);
  });

  it("détecte une fonction de déclencheur créée plus tard", () => {
    const fonction = { nom: "20261011000000_f", sql: "CREATE OR REPLACE FUNCTION facture_figee() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;" };
    const declencheur = { nom: "20261010000000_t", sql: 'CREATE TRIGGER t BEFORE UPDATE ON "x" FOR EACH ROW EXECUTE FUNCTION facture_figee();' };
    expect(dependancesInversees([fonction, declencheur])).toHaveLength(1);
  });
});
