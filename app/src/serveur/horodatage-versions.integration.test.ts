// D68 : une version de produit entre en vigueur à un INSTANT (date et heure). Vraie base de test ; l'horloge de l'application est fixée par
// `fixerHorlogePourTests` (les instants de mise en vigueur et « maintenant » la suivent), la base garde sa propre horloge (`now()`).
// Produits et données INVENTÉS (SECURPRO inventé, 139 420 F).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lireBareme } from "@/domaine/bareme";
import { ajouterJours, aujourdhui, fixerHorlogePourTests } from "@/domaine/calcul/dates";
import { DATE_EFFET_A_LA_PUBLICATION, enVigueur, type VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { controlerAvantPublication, enregistrerBrouillonBareme, lireBaremePublie, publierBareme, rejouerLesEssaisBareme } from "./bareme";
import { creerVersionDepuisBareme } from "./bareme-edition";
import { creerBrouillon, modifierBrouillon, soumettre, type SaisieCotation } from "./cotations";
import { debutTest, finTest } from "./dates-test";
import { initialiserProfilsEtDroits } from "./droits";
import { assurerBranche } from "./branches-test";
import { creerProduit, creerTaxe, creerVersion, listerVersions, resoudreVersion, taxeEnVigueur } from "./parametrage";
import { fixerSeuilGlobalDeTest, retablirSeuilGlobalDeTest } from "./parametres-test";
import { baremeAuxBranches, creerBranchesFiscales, creerProduitAuBareme, versionAuBareme, type BranchesFiscales } from "./produit-bareme-test";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";
import { Client } from "pg";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;
let branches: BranchesFiscales;

/** Le jour des tests (horloge réelle, lu une fois) et l'heure de l'application, fixée à `hh:mm` ce jour-là (Abidjan = UTC+0). */
const JOUR = aujourdhui();
const horloge = (heure: number, minute = 0) => fixerHorlogePourTests(new Date(`${JOUR}T${String(heure).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`));

const souscripteur: Souscripteur = { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ATELIERS DU LAGON SARL (inventée)", telephone: "0700000000", email: "contact@ateliers-lagon.exemple.ci", adresse: "Zone industrielle, Abidjan" };
const effet = debutTest();
const echeance = finTest(effet);

type Entrees = { champs: Record<string, string | boolean | string[]>; souscrit: string[]; effectif?: number };
const brutDe = (e: Entrees) => ({
  champs: Object.fromEntries(Object.entries(e.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
  souscrit: e.souscrit,
  ...(e.effectif !== undefined ? { effectif: String(e.effectif) } : {}),
});
const essaiDe = async (versionId: number): Promise<Entrees> => (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0].entrees as Entrees;

const saisieBareme = (code: string, e: Entrees): SaisieCotation => ({
  codeProduit: code, clientId: null, typeContrat: "INDIVIDUEL", souscripteur, dateEffet: effet, dateEcheance: echeance, nombreTranches: 1, lignes: [], motifForcage: null,
  assures: [], beneficiaires: [], contactsUrgence: [], risque: {}, baremeBrut: brutDe(e),
});
const saisieFormule = (code: string): SaisieCotation => ({
  codeProduit: code, clientId: null, typeContrat: "INDIVIDUEL", souscripteur, dateEffet: effet, dateEcheance: echeance, nombreTranches: 1, lignes: [{ codeFormule: "SOLO", effectif: 1 }], motifForcage: null,
  assures: [], beneficiaires: [], contactsUrgence: [], risque: {},
});

const versionFormule = (dateEffet: string, prime: string): VersionSaisie => ({
  dateEffet,
  modeTarification: "FORMULE",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: prime, accessoireMode: "AUCUN", accessoireValeur: "0" }],
});

const versionDeLaCotation = async (id: number) => (await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).versionId;
const primeDeLaCotation = async (id: number) => ((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).donneesCalcul as { lignes: { primeUnitaire: string }[] }).lignes[0].primeUnitaire;
const versionsDe = (code: string) => obtenirPrisma().produitVersion.findMany({ where: { produit: { code } }, orderBy: { instantEffet: "asc" } });
const instantsDe = async (code: string) => (await versionsDe(code)).filter((v) => v.instantEffet !== null).map((v) => ({ id: v.id, dateEffet: v.dateEffet!.toISOString().slice(0, 10), instantEffet: v.instantEffet!.toISOString() }));

beforeAll(async () => {
  await fixerSeuilGlobalDeTest("2000000000");
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const admin = await compte(idAdmin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, commercial] = [await nouveau("TECHNIQUE"), await nouveau("COMMERCIAL")];
  branches = await creerBranchesFiscales(technique, CODE("H").slice(-8));
});

afterAll(async () => {
  fixerHorlogePourTests(null);
  try {
    await retablirSeuilGlobalDeTest();
  } finally {
    await obtenirPrisma().$disconnect();
  }
});

describe("D68 test 1 — produit au barème : deux corrections publiées le même jour (10 h, 11 h)", () => {
  it("une cotation créée entre les deux garde la 1re jusqu'à l'émission ; une cotation créée après 11 h prend la 2e ; un brouillon recalculé après 11 h prend la 2e", async () => {
    const code = CODE("SECURPRO_H1");
    horloge(9, 0);
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const essai = await essaiDe(v1);

    horloge(10, 0);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, "", null);
    await publierBareme(technique, v2, "Première correction du jour (test D68)", null);

    horloge(10, 30);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v2);
    const cotationA = await creerBrouillon(commercial, saisieBareme(code, essai), null); // émise plus tard
    const cotationB = await creerBrouillon(commercial, saisieBareme(code, essai), null); // brouillon recalculé plus tard
    expect([await versionDeLaCotation(cotationA), await versionDeLaCotation(cotationB)]).toEqual([v2, v2]);
    const cotationD = await creerBrouillon(commercial, saisieBareme(code, essai), null); // restera brouillon jusqu'après 11 h
    horloge(10, 45);
    expect((await soumettre(commercial, cotationA, null)).statut).toBe("EMISE"); // émise AVANT la 2e correction : figée avec la 1re

    horloge(11, 0);
    const { versionId: v3 } = await creerVersionDepuisBareme(technique, v2, "", null);
    await publierBareme(technique, v3, "Deuxième correction du jour (test D68)", null);
    const versions = await instantsDe(code);
    expect(versions.map((v) => v.id)).toEqual([v1, v2, v3]);
    expect(new Set([versions[1].dateEffet, versions[2].dateEffet])).toEqual(new Set([JOUR])); // même jour, deux instants
    expect(versions[1].instantEffet).toBe(`${JOUR}T10:00:00.000Z`);
    expect(versions[2].instantEffet).toBe(`${JOUR}T11:00:00.000Z`);

    horloge(11, 30);
    // La cotation A, créée entre les deux et émise avant la 2e, garde la 1re (version_id) ; la base la fige (cotation_figee).
    expect(await versionDeLaCotation(cotationA)).toBe(v2);
    await expect(obtenirPrisma().cotation.update({ where: { id: cotationA }, data: { versionId: v3 } })).rejects.toThrow();
    expect(await versionDeLaCotation(cotationA)).toBe(v2);
    // Un brouillon est recalculé à sa soumission avec la version en vigueur à ce moment (D65, comportement d'avant) : après 11 h, la 2e.
    expect((await soumettre(commercial, cotationD, null)).statut).toBe("EMISE");
    expect(await versionDeLaCotation(cotationD)).toBe(v3);
    // Une cotation créée après 11 h prend la 2e.
    expect(await versionDeLaCotation(await creerBrouillon(commercial, saisieBareme(code, essai), null))).toBe(v3);
    // Un brouillon recalculé après 11 h prend la 2e.
    await modifierBrouillon(commercial, cotationB, saisieBareme(code, essai), null);
    expect(await versionDeLaCotation(cotationB)).toBe(v3);
    // À 10 h 30, la 1re servait ; à 11 h, la 2e.
    expect(enVigueur((await listerVersions(technique, code))!.versions, `${JOUR}T10:30:00.000Z`)?.id).toBe(v2);
    expect(enVigueur((await listerVersions(technique, code))!.versions, `${JOUR}T11:00:00.000Z`)?.id).toBe(v3);
    expect(lireBareme((await lireBaremePublie(obtenirPrisma(), v3)).bareme)).toEqual(lireBareme((await lireBaremePublie(obtenirPrisma(), v1)).bareme));
  });
});

describe("D68 test 2 — produit par formules : deux versions le même jour", () => {
  it("même logique : la cotation d'entre 10 h et 11 h garde la prime de la 1re ; après 11 h, la 2e ; un brouillon recalculé prend la 2e", async () => {
    const code = CODE("FORMULES_H2");
    horloge(9, 0);
    await creerProduit(technique, { code, libelle: "Produit à formules (test D68)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
    await creerVersion(technique, code, versionFormule(ajouterJours(JOUR, -10), "1000"), null);

    horloge(10, 0);
    await creerVersion(technique, code, versionFormule(JOUR, "2000"), null); // date du jour : l'instant de l'enregistrement
    horloge(10, 30);
    const [cotationA, cotationB] = [await creerBrouillon(commercial, saisieFormule(code), null), await creerBrouillon(commercial, saisieFormule(code), null)];
    expect([await primeDeLaCotation(cotationA), await primeDeLaCotation(cotationB)]).toEqual(["2000", "2000"]);
    horloge(10, 45);
    expect((await soumettre(commercial, cotationA, null)).statut).toBe("EMISE"); // émise avant la 2e version du jour : figée avec la 1re

    horloge(11, 0);
    await creerVersion(technique, code, versionFormule(JOUR, "3000"), null); // même date : accepté, instant 11 h
    const [, v2, v3] = await instantsDe(code);
    expect([v2.instantEffet, v3.instantEffet]).toEqual([`${JOUR}T10:00:00.000Z`, `${JOUR}T11:00:00.000Z`]);

    horloge(11, 30);
    expect(await primeDeLaCotation(cotationA)).toBe("2000"); // émise avant 11 h : 1re
    expect(await primeDeLaCotation(await creerBrouillon(commercial, saisieFormule(code), null))).toBe("3000"); // après 11 h : 2e
    await modifierBrouillon(commercial, cotationB, saisieFormule(code), null);
    expect(await primeDeLaCotation(cotationB)).toBe("3000"); // brouillon recalculé : 2e
    // Deux versions au même INSTANT restent refusées (même date future, ou même instant).
    await expect(creerVersion(technique, code, versionFormule(ajouterJours(JOUR, 5), "4000"), null)).resolves.toBeDefined();
    await expect(creerVersion(technique, code, versionFormule(ajouterJours(JOUR, 5), "5000"), null)).rejects.toThrow(/Une version existe déjà à cette date d'effet/);
  });
});

describe("D68 test 3 — version à date future", () => {
  it("sans effet avant minuit de sa date (Abidjan), en vigueur à minuit pile et après", async () => {
    const code = CODE("FUTUR_H3");
    horloge(9, 0);
    await creerProduit(technique, { code, libelle: "Produit à version future (test D68)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
    await creerVersion(technique, code, versionFormule(ajouterJours(JOUR, -10), "1000"), null);
    const demain = ajouterJours(JOUR, 1);
    await creerVersion(technique, code, versionFormule(demain, "2000"), null);
    const [v1, v2] = await instantsDe(code);
    expect(v2.instantEffet).toBe(`${demain}T00:00:00.000Z`);

    fixerHorlogePourTests(new Date(new Date(`${demain}T00:00:00.000Z`).getTime() - 1)); // 23 h 59 min 59,999 s
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1.id);
    fixerHorlogePourTests(new Date(`${demain}T00:00:00.000Z`));
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v2.id);
    horloge(23, 59);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1.id);
  });
});

describe("D68 test 4 — D66 : version en préparation invisible jusqu'à sa publication, aucune date 9999 en base", () => {
  it("une version « dès la publication » n'a ni date ni instant, ne sert nulle part, puis sert dès l'instant de sa publication", async () => {
    const code = CODE("PREPARATION_H4");
    horloge(9, 0);
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    horloge(10, 0);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, "", null);
    const prep = await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v2 } });
    expect([prep.dateEffet, prep.instantEffet]).toEqual([null, null]);
    expect((await listerVersions(technique, code))!.versions.find((v) => v.id === v2)).toMatchObject({ enPreparation: true, instantEffet: null });
    horloge(10, 30);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1); // invisible
    expect(await obtenirPrisma().produitVersion.count({ where: { OR: [{ dateEffet: new Date("9999-12-31T00:00:00.000Z") }, { dateEffet: { gte: new Date("3000-01-01T00:00:00.000Z") } }] } })).toBe(0);
    // Une seule version « dès la publication » en préparation par produit.
    await expect(creerVersionDepuisBareme(technique, v1, "", null)).rejects.toThrow(/déjà en préparation|a déjà un brouillon/);
    horloge(11, 0);
    await publierBareme(technique, v2, "Entrée en vigueur à l'instant (test D68)", null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v2 } })).instantEffet?.toISOString()).toBe(`${JOUR}T11:00:00.000Z`);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v2);
    fixerHorlogePourTests(new Date(`${JOUR}T10:59:59.999Z`));
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1);
  });
});

describe("D68 test 5 — la base fige une version dès que son instant est atteint (now())", () => {
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

  it("une version en vigueur depuis une heure est refusée en modification et en suppression ; une version à venir reste modifiable", async () => {
    const prisma = obtenirPrisma();
    await assurerBranche("SANTE");
    const produit = await prisma.produit.create({ data: { code: CODE("FIGEE_H5"), libelle: "Produit figé (test D68)", gamme: "STANDARD", branche: "SANTE", branchePrincipale: "MALADIE", creePar: "admin" } });
    const commun = { produitId: produit.id, arrondiPrecision: 1, arrondiSens: "PROCHE", arrondiNiveau: "LIGNE", arrondiComposante: "TAXE", prorataActif: false, creePar: "admin" };
    const maintenant = Date.now();
    const enVigueurDepuis = await prisma.produitVersion.create({ data: { ...commun, instantEffet: new Date(maintenant - 3_600_000) } });
    const aVenir = await prisma.produitVersion.create({ data: { ...commun, instantEffet: new Date(maintenant + 3_600_000) } });
    // La date de l'instant est tenue par la base : jamais de date qui contredise l'instant.
    expect((await prisma.produitVersion.findUniqueOrThrow({ where: { id: aVenir.id } })).dateEffet?.toISOString().slice(0, 10)).toBe(new Date(maintenant + 3_600_000).toISOString().slice(0, 10));

    expect(await sql(`UPDATE produit_versions SET arrondi_precision = 10 WHERE id = ${enVigueurDepuis.id}`)).toMatch(/paramétrage historisé : UPDATE interdit sur produit_versions \(en vigueur depuis le \d{4}-\d{2}-\d{2}\)/);
    expect(await sql(`UPDATE produit_versions SET instant_effet = now() + interval '1 day' WHERE id = ${enVigueurDepuis.id}`)).toMatch(/paramétrage historisé/);
    expect(await sql(`DELETE FROM produit_versions WHERE id = ${enVigueurDepuis.id}`)).toMatch(/paramétrage historisé : DELETE interdit/);
    expect(await sql(`UPDATE produit_versions SET arrondi_precision = 10 WHERE id = ${aVenir.id}`)).toBe("accepté");
    // Une date posée sans instant donne l'instant de minuit ; un instant donné l'emporte sur une date contradictoire (cohérence tenue par la base).
    expect(await sql(`UPDATE produit_versions SET date_effet = DATE '2099-03-04' WHERE id = ${aVenir.id}`)).toBe("accepté");
    expect((await prisma.produitVersion.findUniqueOrThrow({ where: { id: aVenir.id } })).instantEffet?.toISOString()).toBe("2099-03-04T00:00:00.000Z");
    expect(await sql(`UPDATE produit_versions SET date_effet = DATE '2099-01-01', instant_effet = TIMESTAMPTZ '2099-03-05 10:30:00+00' WHERE id = ${aVenir.id}`)).toBe("accepté");
    const lue = await prisma.produitVersion.findUniqueOrThrow({ where: { id: aVenir.id } });
    expect([lue.dateEffet?.toISOString().slice(0, 10), lue.instantEffet?.toISOString()]).toEqual(["2099-03-05", "2099-03-05T10:30:00.000Z"]);
    // Pas de deuxième version au même instant pour un produit.
    expect(await sql(`INSERT INTO produit_versions (produit_id, instant_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, cree_par) VALUES (${produit.id}, TIMESTAMPTZ '2099-03-05 10:30:00+00', 1, 'PROCHE', 'LIGNE', 'TAXE', false, 'test')`)).toMatch(/produit_versions_produit_id_instant_effet_key/);
    // Seule une version au barème peut être sans instant.
    expect(await sql(`INSERT INTO produit_versions (produit_id, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, cree_par) VALUES (${produit.id}, 1, 'PROCHE', 'LIGNE', 'TAXE', false, 'test')`)).toMatch(/produit_versions_instant_sauf_preparation/);
  });
});

describe("D68 test 9 — les essais lisent la taxe au JOUR de la mise en vigueur, pas à l'instant", () => {
  it("un taux « piège » à une autre date ne change pas les essais d'une seconde publication le même jour", async () => {
    const suffixe = CODE("TXH").slice(-8);
    const incendie = `INC_${suffixe}`;
    const iard = `IARD_${suffixe}`;
    for (const [branche, juste, piege] of [[incendie, "12.5", "40"], [iard, "7.25", "50"]] as const) {
      await assurerBranche(branche);
      await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: juste, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: ajouterJours(JOUR, 0) }, null);
      await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: piege, assiette: "NETTE_ACCESSOIRES", dateEffet: ajouterJours(JOUR, 1), dateFin: null }, null);
    }
    // Le piège existe bien : lu demain (ou à la date provisoire d'avant D68), le taux n'est pas le bon.
    expect((await taxeEnVigueur(obtenirPrisma(), iard, "INDIVIDUEL", ajouterJours(JOUR, 1))).tauxPourcent).toBe("50");
    const code = CODE("SECURPRO_TX_H9");
    horloge(9, 0);
    await creerProduit(technique, { code, libelle: "Sécur Pro (inventé, taxes D68)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: iard }, null);
    await creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
    const v1 = (await versionsDe(code))[0].id;
    await enregistrerBrouillonBareme(technique, v1, baremeAuxBranches({ incendie, iard }), null);
    expect(await rejouerLesEssaisBareme(technique, v1)).toEqual([]);
    await publierBareme(technique, v1, "Première publication du jour (test D68)", null);

    // Seconde publication le même jour : les essais lisent la taxe du JOUR (juste), jamais celle d'une autre date.
    horloge(10, 0);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, "", null);
    expect(await rejouerLesEssaisBareme(technique, v2)).toEqual([]);
    expect((await controlerAvantPublication(technique, v2)).ecarts).toEqual([]);
    await publierBareme(technique, v2, "Seconde publication du jour (test D68)", null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v2 } })).instantEffet?.toISOString()).toBe(`${JOUR}T10:00:00.000Z`);
  });
});
