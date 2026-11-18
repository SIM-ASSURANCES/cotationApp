// D68 : migration 20261111090000_horodatage_versions_produit (instants, fin de la date 9999-12-31) et clé étrangère composite (H214).
// Bases jetables (nom en _test) rejouées jusqu'à la veille de la migration, avec des données posées À LA MAIN dans l'état d'avant, puis migrées.
// Toutes les données sont inventées.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const DOSSIER = join(process.cwd(), "prisma", "migrations");
const MIGRATION = "20261111090000_horodatage_versions_produit";
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

const ouvertes: { client: Client; nom: string }[] = [];

/** Base jetable sur laquelle on rejoue les migrations d'AVANT D68 (les deux migrations D68 sont appliquées par le test). */
async function baseAvantMigration(suffixe: string): Promise<Client> {
  const nom = `${decodeURIComponent(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1)).replace(/_test$/, "")}_${suffixe}_test`;
  const admin = new Client({ connectionString: urlVers("postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${nom}"`);
  await admin.end();
  const client = new Client({ connectionString: urlVers(nom) });
  await client.connect();
  for (const m of noms.filter((n) => n < MIGRATION)) await client.query(sqlDe(m));
  ouvertes.push({ client, nom });
  return client;
}

afterAll(async () => {
  for (const { client, nom } of ouvertes) {
    await client.end();
    const admin = new Client({ connectionString: urlVers("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
    await admin.end();
  }
});

const id = async (client: Client, requete: string, valeurs: unknown[] = []): Promise<number> => (await client.query(requete, valeurs)).rows[0].id as number;
const produit = (c: Client, code: string) => id(c, `INSERT INTO produits (code, libelle, gamme, branche, cree_par) VALUES ($1, 'Produit (test D68)', 'STANDARD', 'SANTE', 'test') RETURNING id`, [code]);
/** Version posée dans l'état d'AVANT D68 : une date (obligatoire, unique par produit), pas d'instant. */
const version = (c: Client, produitId: number, date: string, mode = "FORMULE") =>
  id(c, `INSERT INTO produit_versions (produit_id, date_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, mode_tarification, cree_par) VALUES ($1, $2, 1, 'PROCHE', 'LIGNE', 'TAXE', false, $3, 'test') RETURNING id`, [produitId, date, mode]);
const cotation = (c: Client, produitId: number, versionId: number, date: string, statut: string, numero: string | null) =>
  id(c, `INSERT INTO cotations (statut, numero, produit_id, version_id, version_date_effet, souscripteur, date_effet, date_echeance, lignes, auteur_id, auteur_identifiant, modifie_le) VALUES ($1, $2, $3, $4, $5, '{}', '2026-07-01', '2027-06-30', '[]', 1, 'test', now()) RETURNING id`, [statut, numero, produitId, versionId, date]);
const police = (c: Client, cotationId: number, numero: string, produitCode: string) =>
  id(c, `INSERT INTO polices (numero, cotation_id, produit_code, souscripteur, assures, risque, formules_retenues, donnees_calcul, resultat, ttc_total, echeancier, date_effet, date_echeance, cree_par) VALUES ($1, $2, $3, '{}', '[]', '{}', '[]', '{}', '{}', 1000, '[]', '2026-07-01', '2027-06-30', 'test') RETURNING id`, [numero, cotationId, produitCode]);
const facture = (c: Client, policeId: number, produitId: number, versionId: number, date: string, numero: string) =>
  id(c, `INSERT INTO factures (type, statut, numero, police_id, produit_id, version_id, version_date_effet, date_effet, date_echeance, contenu, ttc, cree_par_id, cree_par, emise_le, date_emission) VALUES ('AFFAIRE_NOUVELLE', 'EMISE', $1, $2, $3, $4, $5, '2026-07-01', '2027-06-30', '{}', 1000, 1, 'test', now(), DATE '2026-07-01') RETURNING id`, [numero, policeId, produitId, versionId, date]);

const migrerD68 = async (c: Client) => {
  await c.query(sqlDe(MIGRATION));
  await c.query(sqlDe("20261111100000_horodatage_versions_modele"));
};

describe("D68 test 6 — migration : instants posés, versions en 9999 converties, cotations et factures inchangées", () => {
  it("minuit (Abidjan) de date_effet pour chaque version ; 9999-12-31 devient « en préparation » (ni date ni instant) ; rien ne change ailleurs", async () => {
    const c = await baseAvantMigration("d68_migr");
    await c.query(`INSERT INTO branches (code, libelle, cree_par) VALUES ('SANTE', 'Santé (test)', 'test') ON CONFLICT DO NOTHING`);
    const p1 = await produit(c, "PRD_D68_UN");
    const p2 = await produit(c, "PRD_D68_DEUX");
    const [a, b, aujourdhui] = [await version(c, p1, "2026-01-01"), await version(c, p1, "2026-06-01"), await version(c, p2, new Date().toISOString().slice(0, 10))];
    const prep = await version(c, p1, "9999-12-31", "BAREME"); // version « dès la publication » d'avant D68
    const cotA = await cotation(c, p1, a, "2026-01-01", "EMISE", "COT-A");
    const cotB = await cotation(c, p1, b, "2026-06-01", "ACCEPTEE", "COT-B");
    const cotBrouillon = await cotation(c, p2, aujourdhui, new Date().toISOString().slice(0, 10), "BROUILLON", null);
    const polA = await police(c, cotA, "POL-A", "PRD_D68_UN");
    const facA = await facture(c, polA, p1, a, "2026-01-01", "FAC-A");
    const polB = await police(c, cotB, "POL-B", "PRD_D68_UN");
    const facB = await facture(c, polB, p1, b, "2026-06-01", "FAC-B");

    const avant = async () => ({
      cotations: (await c.query(`SELECT row_to_json(t) AS ligne FROM cotations t ORDER BY id`)).rows.map((r) => r.ligne),
      factures: (await c.query(`SELECT row_to_json(t) AS ligne FROM factures t ORDER BY id`)).rows.map((r) => r.ligne),
    });
    const [etatAvant, versionsAvant] = [await avant(), (await c.query(`SELECT count(*)::int AS n FROM produit_versions`)).rows[0].n];

    await migrerD68(c);

    // Instants : minuit à Abidjan (UTC+0) de la date d'effet ; date_effet inchangée.
    const instants = Object.fromEntries((await c.query(`SELECT id, to_char(date_effet, 'YYYY-MM-DD') AS d, to_char(instant_effet AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS i FROM produit_versions`)).rows.map((r) => [r.id, [r.d, r.i]]));
    expect(instants[a]).toEqual(["2026-01-01", "2026-01-01T00:00:00"]);
    expect(instants[b]).toEqual(["2026-06-01", "2026-06-01T00:00:00"]);
    const jour = new Date().toISOString().slice(0, 10);
    expect(instants[aujourdhui]).toEqual([jour, `${jour}T00:00:00`]);
    // La version en 9999 est « en préparation » : ni date ni instant ; plus aucune ligne en 9999.
    expect(instants[prep]).toEqual([null, null]);
    expect((await c.query(`SELECT count(*)::int AS n FROM produit_versions WHERE date_effet >= DATE '3000-01-01'`)).rows[0].n).toBe(0);
    expect((await c.query(`SELECT count(*)::int AS n FROM produit_versions`)).rows[0].n).toBe(versionsAvant);
    // Cotations et factures : identiques, ligne à ligne (colonnes de version comprises).
    expect(await avant()).toEqual(etatAvant);
    expect([cotBrouillon, facA, facB].every((n) => n > 0)).toBe(true);
    // Les déclencheurs de gel sont rétablis (migration S1 et S2).
    const declencheurs = await c.query(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('cotations_figees', 'factures_intangibles', 'produit_versions_historisees', 'modele_versions_figees') ORDER BY tgname`);
    expect(declencheurs.rows.map((r) => r.tgenabled)).toEqual(["O", "O", "O", "O"]);
    // L'ancienne unicité par date a disparu : deux versions d'un même produit peuvent partager une date, à deux instants.
    await expect(c.query(`INSERT INTO produit_versions (produit_id, instant_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, cree_par) VALUES (${p1}, TIMESTAMPTZ '2026-06-01 11:00:00+00', 1, 'PROCHE', 'LIGNE', 'TAXE', false, 'test')`)).resolves.toBeDefined();
    expect((await c.query(`SELECT count(*)::int AS n FROM produit_versions WHERE produit_id = ${p1} AND date_effet = DATE '2026-06-01'`)).rows[0].n).toBe(2);
  });
});

describe("D68 test 7 — H214 : une cotation ou une facture ne désigne que une version de SON produit ; la date suit la version", () => {
  it("version d'un autre produit refusée par la base ; version_date_effet recopié depuis la version désignée ; version en préparation non désignable", async () => {
    const c = await baseAvantMigration("d68_h214");
    await c.query(`INSERT INTO branches (code, libelle, cree_par) VALUES ('SANTE', 'Santé (test)', 'test') ON CONFLICT DO NOTHING`);
    const [p1, p2] = [await produit(c, "PRD_H214_UN"), await produit(c, "PRD_H214_DEUX")];
    const [v1, v2] = [await version(c, p1, "2026-01-01"), await version(c, p2, "2026-02-02")];
    const prep = await version(c, p1, "9999-12-31", "BAREME");
    const cot = await cotation(c, p1, v1, "2026-01-01", "BROUILLON", null);
    const pol = await police(c, await cotation(c, p1, v1, "2026-01-01", "ACCEPTEE", "COT-H214"), "POL-H214", "PRD_H214_UN");
    const fac = await facture(c, pol, p1, v1, "2026-01-01", "FAC-H214");
    await migrerD68(c);

    const refus = async (requete: string) => c.query(requete).then(() => "accepté", (e: Error) => e.message);
    // Cotation : version d'un autre produit.
    expect(await refus(`UPDATE cotations SET version_id = ${v2} WHERE id = ${cot}`)).toMatch(/cotations_version_id_fkey/);
    expect(await refus(`INSERT INTO cotations (statut, produit_id, version_id, version_date_effet, souscripteur, date_effet, date_echeance, lignes, auteur_id, auteur_identifiant, modifie_le) VALUES ('BROUILLON', ${p1}, ${v2}, DATE '2026-02-02', '{}', '2026-07-01', '2027-06-30', '[]', 1, 'test', now())`)).toMatch(/cotations_version_id_fkey/);
    // Facture : même règle.
    expect(await refus(`INSERT INTO factures (type, statut, police_id, produit_id, version_id, version_date_effet, date_effet, date_echeance, contenu, ttc, cree_par_id, cree_par) VALUES ('RENOUVELLEMENT', 'BROUILLON', ${pol}, ${p1}, ${v2}, DATE '2026-02-02', '2027-07-01', '2028-06-30', '{}', 1000, 1, 'test')`)).toMatch(/factures_version_id_fkey/);
    // La date suit la version désignée : une date erronée est corrigée par la base, à l'insertion comme à la mise à jour.
    expect(await refus(`UPDATE cotations SET version_date_effet = DATE '2030-05-05' WHERE id = ${cot}`)).toBe("accepté");
    expect((await c.query(`SELECT to_char(version_date_effet, 'YYYY-MM-DD') AS d FROM cotations WHERE id = ${cot}`)).rows[0].d).toBe("2026-01-01");
    const insere = await c.query(`INSERT INTO factures (type, statut, police_id, produit_id, version_id, version_date_effet, date_effet, date_echeance, contenu, ttc, cree_par_id, cree_par) VALUES ('RENOUVELLEMENT', 'BROUILLON', ${pol}, ${p1}, ${v1}, DATE '2031-01-01', '2027-07-01', '2028-06-30', '{}', 1000, 1, 'test') RETURNING to_char(version_date_effet, 'YYYY-MM-DD') AS d`);
    expect(insere.rows[0].d).toBe("2026-01-01");
    // Une cotation ou une facture émise ne change pas de version (gel inchangé).
    expect(await refus(`UPDATE factures SET version_id = ${v1} WHERE id = ${fac}`)).toMatch(/émise, elle ne se modifie plus/); // facture émise : seule son annulation s'ajoute
    expect(await refus(`UPDATE factures SET version_date_effet = DATE '2031-01-01' WHERE id = ${fac}`)).toMatch(/émise, elle ne se modifie plus/); // le gel juge la valeur reçue
    expect((await c.query(`SELECT to_char(version_date_effet, 'YYYY-MM-DD') AS d FROM factures WHERE id = ${fac}`)).rows[0].d).toBe("2026-01-01");
    // Une version en préparation (sans date) ne peut pas être désignée.
    expect(await refus(`UPDATE cotations SET version_id = ${prep} WHERE id = ${cot}`)).toMatch(/version de produit en préparation/);
  });
});
