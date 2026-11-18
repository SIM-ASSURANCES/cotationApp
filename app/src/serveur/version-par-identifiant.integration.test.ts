// D67 : une cotation et une facture désignent leur version de produit par son IDENTIFIANT (colonne version_id).
// Ce fichier éprouve la MIGRATION (sur des bases jetables rejouées jusqu'à la veille de la migration, puis migrées) et les garanties de la base
// (gel de version_id avec la cotation émise, clé étrangère RESTRICT). Les factures émises, avoirs, rééditions et reçus sont éprouvés dans
// factures.integration.test.ts (describe « D67 »). Toutes les données sont inventées.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";

import { assurerBranche } from "./branches-test";
import { obtenirPrisma } from "./prisma";

const DOSSIER = join(process.cwd(), "prisma", "migrations");
const MIGRATION = "20261110090000_version_par_identifiant";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

const noms = readdirSync(DOSSIER, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const sqlDe = (nom: string) => readFileSync(join(DOSSIER, nom, "migration.sql"), "utf8");

function urlVers(base: string): string {
  const u = new URL(process.env.TEST_DATABASE_URL!);
  u.pathname = `/${base}`;
  return u.toString();
}

/** Base jetable (nom en _test) sur laquelle on rejoue les migrations d'AVANT D67. */
async function baseAvantMigration(suffixe: string): Promise<{ client: Client; nom: string }> {
  const nom = `${decodeURIComponent(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1)).replace(/_test$/, "")}_${suffixe}_test`;
  const admin = new Client({ connectionString: urlVers("postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${nom}"`);
  await admin.end();
  const client = new Client({ connectionString: urlVers(nom) });
  await client.connect();
  for (const m of noms.filter((n) => n < MIGRATION)) await client.query(sqlDe(m));
  return { client, nom };
}

async function supprimerBase(nom: string): Promise<void> {
  const admin = new Client({ connectionString: urlVers("postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
  await admin.end();
}

const id = async (client: Client, requete: string, valeurs: unknown[] = []): Promise<number> => (await client.query(requete, valeurs)).rows[0].id as number;

/** Deux produits ; le premier a DEUX versions (dates différentes), le second une version à la date de la première version du premier. */
async function semerProduits(client: Client) {
  await client.query(`INSERT INTO branches (code, libelle, cree_par) VALUES ('SANTE', 'Santé (test)', 'test') ON CONFLICT DO NOTHING`);
  const p1 = await id(client, `INSERT INTO produits (code, libelle, gamme, branche, cree_par) VALUES ('PRD_UN', 'Produit un (test)', 'STANDARD', 'SANTE', 'test') RETURNING id`);
  const p2 = await id(client, `INSERT INTO produits (code, libelle, gamme, branche, cree_par) VALUES ('PRD_DEUX', 'Produit deux (test)', 'STANDARD', 'SANTE', 'test') RETURNING id`);
  const version = (produit: number, date: string) =>
    id(client, `INSERT INTO produit_versions (produit_id, date_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, cree_par) VALUES ($1, $2, 1, 'PROCHE', 'LIGNE', 'TAXE', false, 'test') RETURNING id`, [produit, date]);
  return { p1, p2, v1a: await version(p1, "2026-01-01"), v1b: await version(p1, "2026-06-01"), v2: await version(p2, "2026-01-01") };
}

const cotation = (client: Client, produit: number, dateVersion: string, statut: string, numero: string | null) =>
  id(
    client,
    `INSERT INTO cotations (statut, numero, produit_id, version_date_effet, souscripteur, date_effet, date_echeance, lignes, auteur_id, auteur_identifiant, modifie_le)
     VALUES ($1, $2, $3, $4, '{}', '2026-07-01', '2027-06-30', '[]', 1, 'test', now()) RETURNING id`,
    [statut, numero, produit, dateVersion],
  );

const police = (client: Client, cotationId: number, numero: string, produitCode: string) =>
  id(
    client,
    `INSERT INTO polices (numero, cotation_id, produit_code, souscripteur, assures, risque, formules_retenues, donnees_calcul, resultat, ttc_total, echeancier, date_effet, date_echeance, cree_par)
     VALUES ($1, $2, $3, '{}', '[]', '{}', '[]', '{}', '{}', 1000, '[]', '2026-07-01', '2027-06-30', 'test') RETURNING id`,
    [numero, cotationId, produitCode],
  );

const facture = (client: Client, type: string, statut: string, numero: string | null, policeId: number, produit: number, dateVersion: string, dateEffet: string) =>
  id(
    client,
    `INSERT INTO factures (type, statut, numero, police_id, produit_id, version_date_effet, date_effet, date_echeance, contenu, ttc, cree_par_id, cree_par, emise_le, date_emission)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '2030-12-31', '{}', 1000, 1, 'test', CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, CASE WHEN $3::text IS NULL THEN NULL ELSE DATE '2026-07-01' END) RETURNING id`,
    [type, statut, numero, policeId, produit, dateVersion, dateEffet],
  );

describe("migration D67 : remplissage de version_id depuis (produit, version_date_effet)", () => {
  let base: { client: Client; nom: string };
  afterAll(async () => {
    await base?.client.end();
    if (base) await supprimerBase(base.nom);
  });

  it("chaque cotation et chaque facture, de deux versions d'un même produit, pointe vers SA version (figées comprises, déclencheurs rétablis)", async () => {
    base = await baseAvantMigration("migr_ok");
    const { client } = base;
    const { p1, p2, v1a, v1b, v2 } = await semerProduits(client);

    // Cotations de tous les statuts, dont des figées (EMISE, ACCEPTEE) : le remplissage doit les atteindre.
    const cA = await cotation(client, p1, "2026-01-01", "EMISE", "COT-A");
    const cB = await cotation(client, p1, "2026-06-01", "ACCEPTEE", "COT-B");
    const cBrouillon = await cotation(client, p1, "2026-06-01", "BROUILLON", null);
    const cAutreProduit = await cotation(client, p2, "2026-01-01", "REFUSEE", "COT-C"); // même date que la version A du produit un
    const pA = await police(client, cA, "POL-A", "PRD_UN");
    const pB = await police(client, cB, "POL-B", "PRD_UN");
    const pC = await police(client, cAutreProduit, "POL-C", "PRD_DEUX");
    const fA = await facture(client, "AFFAIRE_NOUVELLE", "EMISE", "FAC-A", pA, p1, "2026-01-01", "2026-07-01");
    const fB = await facture(client, "AFFAIRE_NOUVELLE", "EMISE", "FAC-B", pB, p1, "2026-06-01", "2026-07-01");
    const fRenouvellementA = await facture(client, "RENOUVELLEMENT", "EMISE", "FAC-A2", pA, p1, "2026-01-01", "2027-07-01"); // émise : figée
    const fC = await facture(client, "AFFAIRE_NOUVELLE", "BROUILLON", null, pC, p2, "2026-01-01", "2026-07-01");

    await client.query(sqlDe(MIGRATION));

    const versionDe = async (table: "cotations" | "factures", ligne: number) => (await client.query(`SELECT version_id FROM ${table} WHERE id = $1`, [ligne])).rows[0].version_id as number;
    expect(await versionDe("cotations", cA)).toBe(v1a);
    expect(await versionDe("cotations", cB)).toBe(v1b);
    expect(await versionDe("cotations", cBrouillon)).toBe(v1b);
    expect(await versionDe("cotations", cAutreProduit)).toBe(v2); // même date que v1a, autre produit : jamais confondue
    expect(await versionDe("factures", fA)).toBe(v1a);
    expect(await versionDe("factures", fB)).toBe(v1b);
    expect(await versionDe("factures", fRenouvellementA)).toBe(v1a);
    expect(await versionDe("factures", fC)).toBe(v2);

    // Aucune date n'a changé ; la colonne est obligatoire ; les déclencheurs de gel sont de nouveau actifs.
    expect((await client.query(`SELECT to_char(version_date_effet, 'YYYY-MM-DD') AS d FROM cotations WHERE id = $1`, [cB])).rows[0].d).toBe("2026-06-01");
    expect((await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'cotations' AND column_name = 'version_id'`)).rows[0].is_nullable).toBe("NO");
    expect((await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'factures' AND column_name = 'version_id'`)).rows[0].is_nullable).toBe("NO");
    const declencheurs = await client.query(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('cotations_figees', 'factures_intangibles') ORDER BY tgname`);
    expect(declencheurs.rows).toEqual([
      { tgname: "cotations_figees", tgenabled: "O" },
      { tgname: "factures_intangibles", tgenabled: "O" },
    ]);
    await expect(client.query(`UPDATE cotations SET version_id = ${v1a} WHERE id = ${cB}`)).rejects.toThrow(/modification interdite/);
  });

  it("une ligne sans version correspondante : la migration ÉCHOUE avec un message clair, et rien n'est modifié (colonne absente, déclencheurs actifs)", async () => {
    const { client, nom } = await baseAvantMigration("migr_ko");
    try {
      const { p1 } = await semerProduits(client);
      const bonne = await cotation(client, p1, "2026-01-01", "EMISE", "COT-OK");
      const orpheline = await cotation(client, p1, "2030-03-03", "BROUILLON", null); // aucune version du produit à cette date
      const pBonne = await police(client, bonne, "POL-OK", "PRD_UN");
      const factureOrpheline = await facture(client, "AFFAIRE_NOUVELLE", "EMISE", "FAC-KO", pBonne, p1, "2030-03-03", "2026-07-01");

      const echec = await client.query(sqlDe(MIGRATION)).catch((e: unknown) => e as Error);
      expect(echec).toBeInstanceOf(Error);
      const message = (echec as Error).message;
      expect(message).toMatch(/^migration version_par_identifiant : 1 cotation\(s\) \(identifiants : \d+\) et 1 facture\(s\) \(identifiants : \d+\) ne trouvent aucune version de produit/);
      expect(message).toContain(String(orpheline));
      expect(message).toContain(String(factureOrpheline));
      expect(message).toMatch(/migration annulée, aucune donnée modifiée/);

      // Tout est annulé : pas de colonne à moitié remplie, déclencheurs de gel toujours actifs, anciennes colonnes intactes.
      expect((await client.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE column_name = 'version_id' AND table_name IN ('cotations', 'factures')`)).rows[0].n).toBe(0);
      const declencheurs = await client.query(`SELECT tgenabled FROM pg_trigger WHERE tgname IN ('cotations_figees', 'factures_intangibles')`);
      expect(declencheurs.rows).toEqual([{ tgenabled: "O" }, { tgenabled: "O" }]);
      expect((await client.query(`SELECT count(*)::int AS n FROM cotations`)).rows[0].n).toBe(2);
    } finally {
      await client.end();
      await supprimerBase(nom);
    }
  });
});

describe("garanties de la base : version_id d'une cotation émise est figé, une version référencée ne se supprime pas", () => {
  async function sql(requete: string): Promise<string> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(requete);
      return "accepté";
    } catch (erreur) {
      return (erreur as Error).message;
    } finally {
      await client.end();
    }
  }

  let produitId: number;
  let versionA: number;
  let versionB: number;

  beforeAll(async () => {
    fixerDateMinimumEffetPourTests("2026-01-01");
    const prisma = obtenirPrisma();
    await assurerBranche("SANTE");
    const produit = await prisma.produit.create({ data: { code: CODE("D67"), libelle: "Produit D67 (test)", gamme: "STANDARD", branche: "SANTE", branchePrincipale: "MALADIE", creePar: "admin" } });
    produitId = produit.id;
    const donnees = { produitId, arrondiPrecision: 1, arrondiSens: "PROCHE", arrondiNiveau: "LIGNE", arrondiComposante: "TAXE", prorataActif: false, creePar: "admin" };
    versionA = (await prisma.produitVersion.create({ data: { ...donnees, dateEffet: new Date("2026-01-01") } })).id;
    versionB = (await prisma.produitVersion.create({ data: { ...donnees, dateEffet: new Date("2026-06-01") } })).id;
  });

  afterAll(async () => {
    fixerDateMinimumEffetPourTests(null);
    await obtenirPrisma().$disconnect();
  });

  const nouvelle = (statut: string, numero: string | null, versionId: number, versionDateEffet: string) =>
    obtenirPrisma().cotation.create({
      data: { produitId, versionId, versionDateEffet: new Date(versionDateEffet), statut, numero, dateEffet: new Date("2026-07-01"), dateEcheance: new Date("2027-06-30"), souscripteur: { type: "PHYSIQUE", nom: "TEST" }, lignes: [], auteurId: 1, auteurIdentifiant: "test" },
    });

  it("une cotation ÉMISE : modifier version_id est refusé par la base ; ses autres modifications permises (statut) restent permises", async () => {
    const c = await nouvelle("EMISE", CODE("COT"), versionA, "2026-01-01");
    expect(await sql(`UPDATE cotations SET version_id = ${versionB} WHERE id = ${c.id}`)).toMatch(/les données d'une cotation émise ne se modifient pas/);
    expect((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id: c.id } })).versionId).toBe(versionA);
    // Le gel n'a pas durci le reste : une cotation émise passe toujours à « acceptée » sans toucher à ses données.
    expect(await sql(`UPDATE cotations SET statut = 'ACCEPTEE' WHERE id = ${c.id}`)).toBe("accepté");
    expect(await sql(`UPDATE cotations SET version_id = ${versionB} WHERE id = ${c.id}`)).toMatch(/modification interdite \(statut ACCEPTEE\)/);
  });

  it("un brouillon peut encore changer de version (recalcul), jamais vers une version inexistante", async () => {
    const c = await nouvelle("BROUILLON", null, versionA, "2026-01-01");
    expect(await sql(`UPDATE cotations SET version_id = ${versionB}, version_date_effet = DATE '2026-06-01' WHERE id = ${c.id}`)).toBe("accepté");
    expect(await sql(`UPDATE cotations SET version_id = 2147483000 WHERE id = ${c.id}`)).toMatch(/cotations_version_id_fkey/);
  });

  it("une version désignée par une cotation ne se supprime pas (ON DELETE RESTRICT), même quand rien d'autre ne l'interdit ; une version libre se supprime", async () => {
    const prisma = obtenirPrisma();
    // Version à date future : le déclencheur « paramétrage historisé » n'interdit que la suppression d'une version en vigueur.
    const donnees = { produitId, arrondiPrecision: 1, arrondiSens: "PROCHE", arrondiNiveau: "LIGNE", arrondiComposante: "TAXE", prorataActif: false, creePar: "admin" };
    const future = await prisma.produitVersion.create({ data: { ...donnees, dateEffet: new Date("2099-01-01") } });
    await nouvelle("BROUILLON", null, future.id, "2099-01-01");
    expect(await sql(`DELETE FROM produit_versions WHERE id = ${future.id}`)).toMatch(/violates foreign key constraint "cotations_version_id_fkey"/);
    const libre = await prisma.produitVersion.create({ data: { ...donnees, dateEffet: new Date("2099-02-01") } });
    expect(await sql(`DELETE FROM produit_versions WHERE id = ${libre.id}`)).toBe("accepté");
  });
});
