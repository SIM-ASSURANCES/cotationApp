// Session B4 (D58) : barème édité à l'écran. Même document que l'import (bareme_documents, BROUILLON), mêmes schéma et verifierBareme.
// Un barème publié ne se modifie jamais : sa correction est une NOUVELLE version, créée par le service existant (H157, D49).
// Données de test INVENTÉES (SECURPRO du fixture, taxes aux catégories propres à ce fichier : la base est partagée).
import { beforeAll, describe, expect, it } from "vitest";

import {
  baremeVide,
  champNeuf,
  garantieNeuve,
  lireBareme,
  resumeBareme,
  schemaBareme,
  supprimerChamp,
  verifierBareme,
  type Bareme,
} from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import { versionsProvisoiresSansBareme, type VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { basculerVersionAuBareme, empreinteBareme, enregistrerBrouillonBareme, ErreurBaremeInvalide, lireBaremePublie, publierBareme, rejouerLesEssaisBareme } from "./bareme";
import { creerBaremeVide, creerVersionDepuisBareme, lireBaremePourEdition } from "./bareme-edition";
import { exporterBaremePublieXlsx, importerBaremeXlsx } from "./bareme-excel";
import { creerBrouillon } from "./cotations";
import { debutTest } from "./dates-test";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion, listerVersions } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;
let IARD: string;
let INCENDIE: string;

const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

/** SECURPRO inventé aux catégories de taxe de ce fichier. */
function secuproDeTest(): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return lireBareme(d);
}

const versionBase = (dateEffet: string): VersionSaisie => ({
  dateEffet,
  modeTarification: "GARANTIES",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
  garantiesSaisieLibre: true,
  garanties: [],
  references: { csModeleCode: null, csVisa: null },
});

/** Un produit et sa première version : à venir (elle peut recevoir un barème puis basculer) ou en vigueur depuis 2020 (elle ne le peut plus). */
async function nouvelleVersion(options: { enVigueur?: boolean } = {}): Promise<{ code: string; versionId: number }> {
  const code = CODE("ECRAN");
  await creerProduit(technique, { code, libelle: "Produit édité à l'écran (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(technique, code, versionBase(options.enVigueur ? "2020-01-01" : debutTest()), null);
  const v = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } });
  return { code, versionId: v.id };
}

const lignes = (versionId: number) => obtenirPrisma().baremeDocument.findMany({ where: { versionId }, orderBy: { id: "asc" } });
const versionsDe = (code: string) => obtenirPrisma().produitVersion.findMany({ where: { produit: { code } }, orderBy: { dateEffet: "asc" } });

/** Change la version en contournant les déclencheurs : base de test seulement (on ne peut pas attendre une date d'effet). */
async function changerLaVersionPourTest(id: number, affectation: string): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe(`UPDATE produit_versions SET ${affectation} WHERE id = ${id}`);
  });
}

/** Publie le SECURPRO inventé sur une nouvelle version (brouillon écran → essais → publication). */
async function versionPubliee(): Promise<{ code: string; versionId: number; empreinte: string }> {
  const { code, versionId } = await nouvelleVersion();
  await enregistrerBrouillonBareme(technique, versionId, secuproDeTest(), null);
  const { empreinte } = await publierBareme(technique, versionId, "Barème SECURPRO inventé (test B4)", null);
  return { code, versionId, empreinte };
}

const dans = (jours: number) => ajouterJours(aujourdhui(), jours);

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const admin = await compte(idAdmin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: `${profil} Test`, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, commercial] = [await nouveau("TECHNIQUE"), await nouveau("COMMERCIAL")];
  INCENDIE = `INC_${CODE("T")}`.slice(0, 20);
  IARD = `IARD_${CODE("T")}`.slice(0, 20);
  await assurerBranche(INCENDIE);
  await assurerBranche(IARD);
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
});

describe("Créer un barème vide", () => {
  it("crée un brouillon valide, à la catégorie de taxe du produit, journalisé ; un second appel est refusé", async () => {
    const { code, versionId } = await nouvelleVersion();
    const { id, empreinte } = await creerBaremeVide(technique, versionId, "10.0.0.3");
    const [ligne] = await lignes(versionId);
    expect(ligne).toMatchObject({ id, statut: "BROUILLON", empreinte, creePar: technique.identifiant });
    const bareme = schemaBareme.parse(ligne.contenu);
    expect(bareme.produit.taxe).toBe(IARD);
    expect(verifierBareme(bareme)).toEqual([]); // le document vide passe les mêmes contrôles que n'importe quel barème
    expect(empreinteBareme(bareme)).toBe(empreinte);

    const entree = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.find((l) => l.objet === `bareme_document ${id}`)!;
    expect(entree.apres).toMatchObject({ versionId, statut: "BROUILLON", origine: "BAREME_VIDE", garanties: 1, champs: 0 });
    expect(entree.adresseIp).toBe("10.0.0.3");

    await expect(creerBaremeVide(technique, versionId, null)).rejects.toThrow(/déjà un barème/);
    const edition = (await lireBaremePourEdition(technique, versionId))!;
    expect(edition.produit.code).toBe(code);
    expect(edition.preparable).toBe(true);
    expect(edition.brouillon?.empreinte).toBe(empreinte);
    expect(edition.categoriesTaxe).toContain(IARD);
  });

  it("refusé sur une version déjà en vigueur dans un autre mode, et sur une version qui a un barème publié", async () => {
    const enVigueur = await nouvelleVersion({ enVigueur: true });
    await expect(creerBaremeVide(technique, enVigueur.versionId, null)).rejects.toThrow(/déjà en vigueur/);
    const publiee = await versionPubliee();
    await expect(creerBaremeVide(technique, publiee.versionId, null)).rejects.toThrow(/déjà un barème/);
  });
});

describe("Enregistrer à l'écran", () => {
  it("enregistre un barème modifié (champ liste, garantie à deux composantes), journalise l'avant et l'après", async () => {
    const { versionId } = await nouvelleVersion();
    const { id } = await creerBaremeVide(technique, versionId, null);
    const [brouillon] = await lignes(versionId);
    let b = schemaBareme.parse(brouillon.contenu);
    b = {
      ...b,
      champs: [{ ...champNeuf("zone", "Zone", "LISTE"), valeurs: [{ v: "URBAINE", l: "Urbaine" }, "RURALE"] }, champNeuf("capital", "Capital", "MONTANT")],
      garanties: [
        {
          ...garantieNeuve("incendie", "Incendie"),
          composantes: [
            { code: "batiment", assiette: "capital", taux: { unite: "PERMILLE", fixe: "1.5" } },
            { code: "contenu", souscription: "OPTIONNELLE", assiette: ["FOIS", "capital", "0.5"], taux: { unite: "POURCENT", fixe: "2" }, minimum: "2500" },
          ],
        },
      ],
    };
    const r = await enregistrerBrouillonBareme(technique, versionId, b, "10.0.0.4", { toleranceIntegrite: true });
    expect(r.problemes).toEqual([]);
    const [apres] = await lignes(versionId);
    expect(apres.id).toBe(id); // le même brouillon, remplacé
    expect(schemaBareme.parse(apres.contenu).garanties[0].composantes).toHaveLength(2);

    const journal = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.filter((l) => l.objet === `bareme_document ${id}`);
    const dernier = journal[0];
    expect(dernier.avant).toMatchObject({ statut: "BROUILLON", champs: 0, garanties: 1 });
    expect(dernier.apres).toMatchObject({ statut: "BROUILLON", champs: 2, garanties: 1, empreinte: r.empreinte });
    expect(dernier.apres).toMatchObject(resumeBareme(b));
  });

  it("un problème d'intégrité n'empêche pas d'enregistrer, mais bloque la publication ; l'import garde l'exigence entière", async () => {
    const { versionId } = await nouvelleVersion();
    const b = secuproDeTest();
    // Un taux « lu dans une table » sans sous-jacent qui le fournisse : TAUX_SANS_SOURCE, que seul un sous-jacent (classeur, B5) peut résoudre.
    const casse: Bareme = { ...b, garanties: b.garanties.map((g) => (g.code === "dde" ? { ...g, composantes: g.composantes.map((c) => ({ ...c, taux: { unite: "PERMILLE" as const, source: "E1" as const } })) } : g)) };
    expect(verifierBareme(casse).map((p) => p.code)).toContain("TAUX_SANS_SOURCE");

    await expect(enregistrerBrouillonBareme(technique, versionId, casse, null)).rejects.toBeInstanceOf(ErreurBaremeInvalide);
    expect(await lignes(versionId)).toHaveLength(0);

    const r = await enregistrerBrouillonBareme(technique, versionId, casse, null, { toleranceIntegrite: true });
    expect(r.problemes.map((p) => p.code)).toContain("TAUX_SANS_SOURCE");
    expect(await lignes(versionId)).toHaveLength(1);

    // La publication revalide tout : le contrôle bloquant l'arrête, et le refus est journalisé.
    const refus = (await publierBareme(technique, versionId, "Essai de publication", null).catch((e) => e)) as ErreurBaremeInvalide;
    expect(refus).toBeInstanceOf(ErreurBaremeInvalide);
    expect(refus.problemes.map((p) => p.code)).toContain("TAUX_SANS_SOURCE");
    expect((await lignes(versionId))[0].statut).toBe("BROUILLON");
    const idBrouillon = (await lignes(versionId))[0].id;
    const journal = (await lireJournal({ action: "BAREME_PUBLICATION_REFUSEE" })).lignes.find((l) => l.objet === `bareme_document ${idBrouillon}`);
    expect(journal).toBeDefined();
  });

  it("le schéma reste exigé même avec la tolérance : un document mal formé n'est pas enregistré", async () => {
    const { versionId } = await nouvelleVersion();
    const mal = { ...baremeVide(IARD), garanties: [] };
    const e = (await enregistrerBrouillonBareme(technique, versionId, mal, null, { toleranceIntegrite: true }).catch((x) => x)) as ErreurBaremeInvalide;
    expect(e).toBeInstanceOf(ErreurBaremeInvalide);
    expect(e.problemes[0]).toMatchObject({ code: "SCHEMA" });
    expect(await lignes(versionId)).toHaveLength(0);
  });

  it("les erreurs de l'écran sont celles de l'import : mêmes codes et mêmes messages", async () => {
    const b = secuproDeTest();
    const casse: Bareme = { ...b, tables: b.tables.map((t) => (t.code === "limites" ? { ...t, lignes: Object.fromEntries(Object.entries(t.lignes).slice(1)) } : t)) };
    const { versionId } = await nouvelleVersion();
    const parImport = (await enregistrerBrouillonBareme(technique, versionId, casse, null).catch((e) => e)) as ErreurBaremeInvalide;
    const parEcran = await enregistrerBrouillonBareme(technique, versionId, casse, null, { toleranceIntegrite: true });
    expect(parEcran.problemes).toEqual(parImport.problemes);
  });

  it("la suppression d'un champ lu est refusée par le domaine en nommant le lecteur, et le document n'est pas touché", async () => {
    const b = secuproDeTest();
    const r = supprimerChamp(b, "occupation");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.refus[0]).toMatch(/loyer_mensuel/);
  });
});

describe("Un barème publié ne se modifie jamais", () => {
  it("brouillon refusé par le service et par la base, contenu intouchable, aucune modification à l'écran", async () => {
    const { versionId, empreinte } = await versionPubliee();
    const avant = (await lignes(versionId))[0];
    await expect(enregistrerBrouillonBareme(technique, versionId, secuproDeTest(), null, { toleranceIntegrite: true })).rejects.toThrow(/déjà un barème publié/);
    await expect(obtenirPrisma().$executeRawUnsafe(`UPDATE bareme_documents SET contenu = '{}' WHERE id = ${avant.id}`)).rejects.toThrow(/barème publié/);
    await expect(
      obtenirPrisma().$executeRawUnsafe(`INSERT INTO bareme_documents (version_id, statut, schema_version, contenu, empreinte, cree_par) VALUES (${versionId}, 'BROUILLON', 1, '{}', '${"a".repeat(64)}', 'test')`),
    ).rejects.toThrow(/déjà un barème publié/);
    const apres = await lignes(versionId);
    expect(apres).toHaveLength(1);
    expect(apres[0]).toEqual(avant);
    expect(apres[0].empreinte).toBe(empreinte);
    const edition = (await lireBaremePourEdition(technique, versionId))!;
    expect(edition.brouillon).toBeNull(); // l'écran ne propose donc que la consultation
    expect(edition.publie?.empreinte).toBe(empreinte);
    expect(edition.codesFiges).toEqual(expect.arrayContaining(["type_commerce", "capital_immo", "stocks"]));
  });
});

describe("Droits : paramétrage des produits, contrôlés côté serveur", () => {
  it("un profil sans le droit est refusé partout", async () => {
    const { versionId } = await nouvelleVersion();
    await expect(creerBaremeVide(commercial, versionId, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(lireBaremePourEdition(commercial, versionId)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(enregistrerBrouillonBareme(commercial, versionId, baremeVide(IARD), null, { toleranceIntegrite: true })).rejects.toBeInstanceOf(ErreurAcces);
    await expect(rejouerLesEssaisBareme(commercial, versionId)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerVersionDepuisBareme(commercial, versionId, dans(30), null)).rejects.toBeInstanceOf(ErreurAcces);
    expect(await lignes(versionId)).toHaveLength(0);
  });
});

describe("Aller-retour : un barème modifié à l'écran, publié, exporté, réimporté", () => {
  it("garde la même empreinte", async () => {
    const { versionId } = await nouvelleVersion();
    // Modifications faites à l'écran, sans effet sur les essais : un champ facultatif, un bloc, une garantie optionnelle à deux composantes.
    let b = secuproDeTest();
    b = {
      ...b,
      blocs: [...b.blocs, { code: "divers", libelle: "Divers" }],
      champs: [...b.champs, { ...champNeuf("remarque", "Remarque du souscripteur", "TEXTE"), bloc: "divers", obligatoire: false, aide: "Texte libre, imprimé sur la police." }],
      garanties: [
        ...b.garanties,
        {
          ...garantieNeuve("assistance", "Assistance"),
          souscription: "OPTIONNELLE",
          definition: "Rapatriement et dépannage.",
          afficherSurDocuments: true,
          composantes: [
            { code: "dep", assiette: "stocks", taux: { unite: "PERMILLE", fixe: "0.4" } },
            { code: "rap", souscription: "OPTIONNELLE", assiette: ["PCT_PLAFOND", "stocks", "10", "500000"], taux: { unite: "POURCENT", fixe: "1" }, parTete: false },
          ],
        },
      ],
    };
    await enregistrerBrouillonBareme(technique, versionId, b, null, { toleranceIntegrite: true });
    const { empreinte } = await publierBareme(technique, versionId, "Barème modifié à l'écran (test)", null);

    const { contenu } = await exporterBaremePublieXlsx(technique, versionId);
    const autre = await nouvelleVersion();
    const importe = await importerBaremeXlsx(technique, autre.versionId, "retour.xlsx", contenu, null);
    expect(importe.empreinte).toBe(empreinte);
    expect(empreinteBareme((await lireBaremePublie(obtenirPrisma(), versionId)).bareme)).toBe(empreinte);
  });
});

describe("Corriger un barème publié : une nouvelle version, par le service existant (H157)", () => {
  async function versionEnVigueurAuBareme() {
    const { code, versionId, empreinte } = await versionPubliee();
    await basculerVersionAuBareme(technique, versionId, null);
    await changerLaVersionPourTest(versionId, "date_effet = DATE '2020-01-01'");
    return { code, versionId, empreinte };
  }
  const souscripteur: Souscripteur = { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ATELIERS TEST SARL (inventée)", telephone: "0700000000", email: "contact@test.exemple.ci", adresse: "Rue inventée, Abidjan" };

  it("crée la version à la date saisie avec le barème copié en brouillon ; le publié et les cotations qui le citent ne changent pas", async () => {
    const { code, versionId, empreinte } = await versionEnVigueurAuBareme();
    const essai = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0];
    const brut = {
      champs: Object.fromEntries(Object.entries(essai.entrees.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
      souscrit: essai.entrees.souscrit,
    };
    const cotationId = await creerBrouillon(
      commercial,
      {
        codeProduit: code,
        clientId: null,
        typeContrat: "INDIVIDUEL",
        souscripteur,
        dateEffet: aujourdhui(),
        dateEcheance: dans(364),
        nombreTranches: 1,
        lignes: [],
        motifForcage: null,
        assures: [],
        beneficiaires: [],
        contactsUrgence: [],
        risque: {},
        baremeBrut: brut,
      },
      null,
    );
    const prisma = obtenirPrisma();
    const cotationAvant = await prisma.cotation.findUniqueOrThrow({ where: { id: cotationId } });
    const publieAvant = (await lignes(versionId))[0];
    const sourceAvant = await prisma.produitVersion.findUniqueOrThrow({ where: { id: versionId } });
    const nombreDeVersions = (await versionsDe(code)).length;
    const date = dans(45);

    const cree = await creerVersionDepuisBareme(technique, versionId, date, "10.0.0.5");

    // La nouvelle version : date saisie, mode provisoire (H140), mêmes paramètres que la version de départ, copie du publié en brouillon.
    expect(cree.codeProduit).toBe(code);
    expect(await versionsDe(code)).toHaveLength(nombreDeVersions + 1);
    const nouvelle = await prisma.produitVersion.findUniqueOrThrow({ where: { id: cree.versionId } });
    expect(nouvelle.dateEffet.toISOString().slice(0, 10)).toBe(date);
    expect(nouvelle.modeTarification).toBe("GARANTIES");
    expect(nouvelle.arrondiPrecision).toBe(sourceAvant.arrondiPrecision);
    expect(nouvelle.validiteMois).toBe(sourceAvant.validiteMois);
    expect(nouvelle.creePar).toBe(technique.identifiant);
    const [copie] = await lignes(cree.versionId);
    expect(copie).toMatchObject({ statut: "BROUILLON", creePar: technique.identifiant });
    expect(copie.contenu).toEqual(publieAvant.contenu);
    // Même contenu, donc même empreinte (le SHA-256 du JSON canonique) : le couple (version, empreinte) distingue les deux lignes.
    expect(copie.empreinte).toBe(empreinte);
    expect(copie.versionId).not.toBe(publieAvant.versionId);

    // Le publié d'origine, sa version et la cotation qui le cite sont strictement inchangés.
    expect((await lignes(versionId))[0]).toEqual(publieAvant);
    expect(await prisma.produitVersion.findUniqueOrThrow({ where: { id: versionId } })).toEqual(sourceAvant);
    expect(await prisma.cotation.findUniqueOrThrow({ where: { id: cotationId } })).toEqual(cotationAvant);
    expect(((cotationAvant.donneesCalcul as { bareme?: { versionId: number; empreinte: string } }).bareme)).toMatchObject({ versionId, empreinte });

    // Deux entrées de journal : la version (service existant) et la copie du barème.
    const journal = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes;
    expect(journal.find((l) => l.objet === `produit_version ${cree.versionId}`)?.apres).toMatchObject({ produit: code, dateEffet: date, modeTarification: "GARANTIES" });
    const entreeCopie = journal.find((l) => l.objet === `bareme_document ${copie.id}`)!;
    expect(entreeCopie.apres).toMatchObject({ versionId: cree.versionId, statut: "BROUILLON", origine: "COPIE_DU_PUBLIE", copieDe: { versionId, empreinte } });

    // L'alerte H140 s'applique à la nouvelle version : à venir, « Par garanties », sans barème publié.
    const { versions } = (await listerVersions(technique, code))!;
    const alertes = versionsProvisoiresSansBareme(versions, new Set([versionId]), aujourdhui());
    expect(alertes.map((a) => a.id)).toEqual([cree.versionId]);
    expect(alertes[0].joursRestants).toBe(45);

    // Une fois modifiée à l'écran, la copie suit le parcours normal ; le publié reste celui de la version en vigueur.
    const edition = (await lireBaremePourEdition(technique, cree.versionId))!;
    expect(edition.brouillon).not.toBeNull();
    expect(edition.preparable).toBe(true);
  });

  it("refuse une date passée, d'aujourd'hui ou illisible, sans rien créer", async () => {
    const { code, versionId } = await versionEnVigueurAuBareme();
    const nombre = (await versionsDe(code)).length;
    for (const date of [ajouterJours(aujourdhui(), -1), aujourdhui(), "", "31/12/2030", "2030-02-30"]) {
      await expect(creerVersionDepuisBareme(technique, versionId, date, null)).rejects.toBeInstanceOf(ErreurMetier);
    }
    await expect(creerVersionDepuisBareme(technique, versionId, ajouterJours(aujourdhui(), -1), null)).rejects.toThrow(/postérieure à aujourd'hui/);
    expect(await versionsDe(code)).toHaveLength(nombre);
  });

  it("refuse quand une version à venir a déjà un barème (en la nommant), et ne crée rien", async () => {
    const { code, versionId } = await versionEnVigueurAuBareme();
    const premiere = await creerVersionDepuisBareme(technique, versionId, dans(20), null);
    const nombre = (await versionsDe(code)).length;
    const message = await creerVersionDepuisBareme(technique, versionId, dans(40), null).catch((e) => (e as Error).message);
    expect(message).toMatch(/a déjà un brouillon de barème/);
    expect(message).toContain(dans(20).split("-").reverse().join("/"));
    expect(message).toMatch(/ouvrez-la/);
    expect(await versionsDe(code)).toHaveLength(nombre);
    // Une fois ce brouillon publié, le message dit « publié ».
    await publierBareme(technique, premiere.versionId, "Correction", null);
    await expect(creerVersionDepuisBareme(technique, versionId, dans(40), null)).rejects.toThrow(/a déjà un barème publié/);
  });

  it("une version à venir SANS barème n'empêche pas la création, et la même date d'effet est refusée par la règle existante sans rien laisser", async () => {
    const { code, versionId } = await versionEnVigueurAuBareme();
    const date = dans(60);
    await creerVersion(technique, code, versionBase(date), null);
    const avant = await obtenirPrisma().baremeDocument.count();
    await expect(creerVersionDepuisBareme(technique, versionId, date, null)).rejects.toThrow(/Une version existe déjà à cette date d'effet/);
    expect(await obtenirPrisma().baremeDocument.count()).toBe(avant); // la version et sa copie vont ensemble : rien n'est resté
    await expect(creerVersionDepuisBareme(technique, versionId, dans(61), null)).resolves.toMatchObject({ codeProduit: code });
  });

  it("n'est possible que sur un barème publié : un brouillon se modifie directement", async () => {
    const { versionId } = await nouvelleVersion();
    await enregistrerBrouillonBareme(technique, versionId, secuproDeTest(), null);
    await expect(creerVersionDepuisBareme(technique, versionId, dans(30), null)).rejects.toThrow(/Seul un barème publié/);
  });
});
