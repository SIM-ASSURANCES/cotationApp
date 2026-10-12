// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { BrancheSaisie } from "@/domaine/calcul/taxes";

import { assurerBranche } from "./branches-test";
import { lireJournal } from "./audit";
import { initialiserProfilsEtDroits } from "./droits";
import {
  calculerPourProduit,
  creerProduit,
  creerTaxe,
  creerVersion,
  creerBranche,
  initialiserBranches,
  initialiserTaxes,
  listerBranches,
  listerTaxes,
  modifierBranche,
  type TaxeDemarrage,
} from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let comptabilite: UtilisateurCourant;
let commercial: UtilisateurCourant;

async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

/** Produit de test inspiré de l'offre BENI (CDC T1) : 2 formules, taxe 1,5 %, arrondi au franc. */
const versionBeni = (surcharge: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet: "2026-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: true, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [
    { code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" },
    { code: "FAMILLE", libelle: "Famille", tauxCouverture: null, primeUnitaire: "252657.63", accessoireMode: "FIXE", accessoireValeur: "210000" },
  ],
  ...surcharge,
});

const ANNEE = { dateEffet: "2026-01-01", dateEcheance: "2026-12-31" };

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const id = unique("admin");
  await creerAdministrateurInitial({ identifiant: id, nom: "Admin", motDePasse: MDP });
  admin = await compte(id);
  technique = await nouveauCompte("TECHNIQUE");
  comptabilite = await nouveauCompte("COMPTABILITE");
  commercial = await nouveauCompte("COMMERCIAL");
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("T1 et T3 de bout en bout, avec les paramètres lus en base", () => {
  const code = unique("BENI").toUpperCase().replace(/-/g, "_");
  const branche = `SANTE_${code}`;

  beforeAll(async () => {
    // Taux santé GROUPE de la loi (1,5 %, D18) : T1 et T2 sont des contrats groupe.
    await assurerBranche(branche);
    await creerTaxe(technique, { branche, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerProduit(technique, { code, libelle: "Santé BENI (test)", gamme: "RELAX", branche }, null);
    await creerVersion(technique, code, versionBeni(), null);
  });

  it("T1 : Solo 288 000, Famille 15 600 000, total 15 888 000", async () => {
    const r = await calculerPourProduit(technique, {
      codeProduit: code, regimeTaxe: "GROUPE",
      ...ANNEE,
      lignes: [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }],
    });
    const [solo, famille] = r.resultat.lignes;

    expect(solo.arrondi.nette.toString()).toBe("280744");
    expect(solo.arrondi.taxe.toString()).toBe("4256");
    expect(solo.arrondi.ttc.toString()).toBe("288000");
    expect(famille.arrondi.nette.toString()).toBe("15159458");
    expect(famille.arrondi.taxe.toString()).toBe("230542");
    expect(famille.arrondi.ttc.toString()).toBe("15600000");
    expect(r.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    expect(solo.ttcParUnite.toString()).toBe("96000");
    expect(famille.ttcParUnite.toString()).toBe("260000");
  });

  it("T1 : l'échéancier en 4 tranches fait exactement 15 888 000", async () => {
    const r = await calculerPourProduit(technique, {
      codeProduit: code, regimeTaxe: "GROUPE",
      ...ANNEE,
      lignes: [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }],
      nombreTranches: 4,
    });

    expect(r.echeancier).toHaveLength(4);
    expect(r.echeancier!.reduce((s, t) => s.plus(t.montant), r.resultat.totaux.arrondi.ttc.minus(r.resultat.totaux.arrondi.ttc)).toString()).toBe("15888000");
  });

  it("T3 : 163 jours, taxe de 1,5 % (1 809,495 avant arrondi), jamais 2 292", async () => {
    const codeT3 = `${code}_T3`;
    await creerProduit(technique, { code: codeT3, libelle: "Individuel (test T3)", gamme: "RELAX", branche }, null);
    // Prime annuelle choisie pour que la prime nette proratisée sur 163 jours soit de 120 633.
    await creerVersion(
      technique,
      codeT3,
      versionBeni({
        formules: [{ code: "IND", libelle: "Individuelle", tauxCouverture: null, primeUnitaire: "270129.1104294478527607361963190184049080", accessoireMode: "AUCUN", accessoireValeur: "0" }],
      }),
      null,
    );

    // H30 (fermée, réponse de la Technique du 09/10/2026) : le 1,5 % de T3 dans le CDC est un cas spécial dû à une erreur ;
    // la règle normale (individuel 4 %) s'applique. Le test garde les montants du CDC, donc le régime GROUPE explicite.
    const r = await calculerPourProduit(technique, {
      codeProduit: codeT3, regimeTaxe: "GROUPE",
      dateEffet: "2026-07-22",
      dateEcheance: "2026-12-31",
      lignes: [{ codeFormule: "IND", effectif: 1 }],
    });
    const l = r.resultat.lignes[0];

    expect(r.resultat.joursCouverts).toBe(163);
    expect(l.arrondi.nette.toString()).toBe("120633");
    expect(l.exact.taxe.toDecimalPlaces(6).toString()).toBe("1809.495");
    expect(l.exact.taxe.eq(2292)).toBe(false);
    expect(l.arrondi.taxe.toString()).toBe("1809");
  });
});

describe("historisation par date d'effet (CDC §7)", () => {
  const code = unique("HIST").toUpperCase().replace(/-/g, "_");
  const branche = `HIST_${code}`;
  const lignes = [{ codeFormule: "SOLO", effectif: 1 }];

  beforeAll(async () => {
    await assurerBranche(branche);
    await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "1.9", assiette: "NETTE_ACCESSOIRES", dateEffet: "2026-09-01", dateFin: null }, null);
    await creerProduit(technique, { code, libelle: "Historique (test)", gamme: "RELAX", branche }, null);
    await creerVersion(technique, code, versionBeni({ dateEffet: "2026-01-01", formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "100000", accessoireMode: "AUCUN", accessoireValeur: "0" }] }), null);
    await creerVersion(technique, code, versionBeni({ dateEffet: "2026-09-01", formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "120000", accessoireMode: "AUCUN", accessoireValeur: "0" }] }), null);
  });

  it("utilise la version du produit en vigueur à la date du document", async () => {
    const ancien = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, dateDocument: "2026-08-15", lignes });
    const recent = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, dateDocument: "2026-10-05", lignes });

    expect(ancien.resultat.lignes[0].arrondi.nette.toString()).toBe("100000");
    expect(ancien.versionDu).toBe("2026-01-01");
    expect(recent.resultat.lignes[0].arrondi.nette.toString()).toBe("120000");
    expect(recent.versionDu).toBe("2026-09-01");
  });

  it("utilise le taux de taxe en vigueur à la date d'effet de la police", async () => {
    const avant = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", dateEffet: "2026-07-22", dateEcheance: "2026-12-31", dateDocument: "2026-10-05", lignes });
    const apres = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", dateEffet: "2026-10-01", dateEcheance: "2026-12-31", dateDocument: "2026-10-05", lignes });

    expect(avant.taxe.tauxPourcent).toBe("1.5");
    expect(apres.taxe.tauxPourcent).toBe("1.9");
  });

  it("refuse un document daté avant la première version, et une date sans taxe", async () => {
    await expect(calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, dateDocument: "2025-06-01", lignes })).rejects.toThrow(/Aucun paramétrage/);
    await expect(calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", dateEffet: "2019-01-01", dateEcheance: "2019-12-31", lignes })).rejects.toThrow(/Aucune taxe/);
  });

  it("refuse de modifier ou supprimer une ligne en vigueur, même en SQL direct", async () => {
    const prisma = obtenirPrisma();
    await expect(prisma.$executeRawUnsafe(`UPDATE taxes SET taux_pourcent = 9 WHERE branche = '${branche}'`)).rejects.toThrow(/paramétrage historisé/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM taxes WHERE branche = '${branche}'`)).rejects.toThrow(/paramétrage historisé/);
    await expect(prisma.$executeRawUnsafe(`UPDATE produit_versions SET arrondi_precision = 1000`)).rejects.toThrow(/paramétrage historisé/);
    await expect(prisma.$executeRawUnsafe(`UPDATE formules SET prime_unitaire = 1`)).rejects.toThrow(/paramétrage historisé/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM formules`)).rejects.toThrow(/paramétrage historisé/);
  });

  it("permet de corriger une version à date future, pas encore en vigueur", async () => {
    await creerVersion(technique, code, versionBeni({ dateEffet: "2999-01-01" }), null);
    const prisma = obtenirPrisma();

    await expect(prisma.$executeRawUnsafe(`UPDATE produit_versions SET arrondi_precision = 10 WHERE date_effet = '2999-01-01'`)).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM formules WHERE produit_version_id IN (SELECT id FROM produit_versions WHERE date_effet = '2999-01-01')`)).resolves.toBe(2);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM produit_versions WHERE date_effet = '2999-01-01'`)).resolves.toBe(1);
  });

  it("refuse deux versions à la même date d'effet, et deux taux dont les périodes se chevauchent", async () => {
    await expect(creerVersion(technique, code, versionBeni({ dateEffet: "2026-09-01" }), null)).rejects.toThrow(/existe déjà/);
    await expect(creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "2", assiette: "NETTE", dateEffet: "2026-09-01", dateFin: null }, null)).rejects.toThrow(/Période refusée/);
  });
});

describe("règles de gestion", () => {
  const code = unique("REG").toUpperCase().replace(/-/g, "_");
  const branche = `REG_${code}`;

  beforeAll(async () => {
    await assurerBranche(branche);
    await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerProduit(technique, { code, libelle: "Règles (test)", gamme: "RELAX", branche }, null);
    await creerVersion(
      technique,
      code,
      versionBeni({
        seuilValidationTtc: "1000000",
        fractionnement: { tranchesMax: 4, repartitionPourcent: ["40", "30", "30"], decalagesMois: null, frais: "5000" },
      }),
      null,
    );
  });

  it("réserve l'écriture aux profils « Oui » ou « Valide » : ni commercial, ni comptabilité (simple proposition)", async () => {
    const taxe = { branche: "AUTRE", typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "1", assiette: "NETTE" as const, dateEffet: "2026-01-01", dateFin: null };

    await expect(creerTaxe(commercial, taxe, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerTaxe(comptabilite, taxe, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerProduit(commercial, { code: "X", libelle: "x", gamme: "x", branche: "X" }, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerVersion(comptabilite, code, versionBeni({ dateEffet: "2026-12-01" }), null)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("laisse consulter et calculer au commercial et à la comptabilité, pas à l'Admin système", async () => {
    const demande = { codeProduit: code, regimeTaxe: "GROUPE" as const, ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] };

    await expect(calculerPourProduit(commercial, demande)).resolves.toBeDefined();
    await expect(listerTaxes(comptabilite)).resolves.toBeDefined();
    await expect(calculerPourProduit(admin, demande)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("signale la double validation au-dessus du seuil de TTC du produit", async () => {
    const petit = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] });
    const grand = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes: [{ codeFormule: "FAMILLE", effectif: 10 }] });

    expect(petit.doubleValidationRequise).toBe(false);
    expect(grand.doubleValidationRequise).toBe(true);
  });

  it("applique la répartition 40/30/30 et les frais de fractionnement (taxés), et limite le nombre de tranches", async () => {
    const r = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 3 }], nombreTranches: 3 });

    expect(r.resultat.fraisFractionnement?.arrondi.accessoires.toString()).toBe("5000");
    // 288 000 (3 Solo) + frais de fractionnement 5 000 + taxe de 1,5 % sur ces frais (75)
    expect(r.resultat.totaux.arrondi.ttc.toString()).toBe("293075");
    expect(r.echeancier!.map((x) => x.montant.toString())).toEqual(["117230", "87923", "87922"]);
    const somme = r.echeancier!.reduce((s, x) => s.plus(x.montant), r.resultat.totaux.arrondi.ttc.minus(r.resultat.totaux.arrondi.ttc));
    expect(somme.toString()).toBe("293075");
    await expect(
      calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }], nombreTranches: 5 }),
    ).rejects.toThrow(/de 1 à 4 tranche/);
  });

  it("refuse une formule inconnue, un produit inconnu et une version invalide", async () => {
    await expect(calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes: [{ codeFormule: "NOPE", effectif: 1 }] })).rejects.toThrow(/inconnue/);
    await expect(calculerPourProduit(technique, { codeProduit: "INCONNU", regimeTaxe: "GROUPE", ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] })).rejects.toBeInstanceOf(ErreurMetier);
    await expect(
      creerVersion(technique, code, versionBeni({ dateEffet: "2027-01-01", fractionnement: { tranchesMax: 4, repartitionPourcent: ["50", "40"], decalagesMois: null, frais: "0" } }), null),
    ).rejects.toThrow(/100/);
  });

  it("journalise chaque modification du paramétrage", async () => {
    const { lignes } = await lireJournal({ action: "PARAMETRE_MODIFIE" });

    expect(lignes.some((l) => l.objet?.startsWith("produit_version"))).toBe(true);
    expect(lignes.some((l) => l.objet?.startsWith("taxe"))).toBe(true);
    expect(lignes.some((l) => l.utilisateur === technique.identifiant)).toBe(true);
  });
});

describe("taxes par branche et type de contrat (D18)", () => {
  const taxe = (branche: string, surcharge: Record<string, unknown> = {}) => ({
    branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "1", assiette: "NETTE_ACCESSOIRES" as const, dateEffet: "2026-01-01", dateFin: null, ...surcharge,
  });

  it("un nouveau taux clôture le taux ouvert à la veille ; les autres chevauchements sont refusés avec un message clair", async () => {
    const branche = unique("PER").toUpperCase().replace(/-/g, "_");
    await assurerBranche(branche);
    await creerTaxe(technique, taxe(branche, { tauxPourcent: "1.5", dateEffet: "2020-01-01" }), null);
    await creerTaxe(technique, taxe(branche, { tauxPourcent: "2", dateEffet: "2027-01-01" }), null);

    const lignes = (await listerTaxes(technique)).filter((t) => t.branche === branche);
    expect(lignes.map((t) => [t.dateEffet, t.dateFin, t.tauxPourcent])).toEqual([["2027-01-01", null, "2"], ["2020-01-01", "2026-12-31", "1.5"]]);
    expect(lignes[0].creePar).toBe(technique.identifiant);
    const journal = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.find((l) => l.objet === `taxe ${lignes[1].id}` && l.avant !== null)!;
    expect(journal.avant).toEqual({ dateFin: null });
    expect(journal.apres).toMatchObject({ dateFin: "2026-12-31" });

    await expect(creerTaxe(technique, taxe(branche, { dateEffet: "2026-06-01", dateFin: "2026-06-30" }), null)).rejects.toThrow(/Période refusée.*chevauche/);
    await expect(creerTaxe(technique, taxe(branche, { dateEffet: "2027-01-01" }), null)).rejects.toThrow(/Période refusée/);
    // Un autre régime de taxe est une autre clé : pas de chevauchement.
    await expect(creerTaxe(technique, taxe(branche, { typeContrat: "GROUPE", dateEffet: "2026-06-01" }), null)).resolves.toBeUndefined();
  });

  it("la base refuse elle-même deux périodes qui se chevauchent et toute modification autre que la clôture", async () => {
    const branche = unique("SQL").toUpperCase().replace(/-/g, "_");
    await assurerBranche(branche);
    await creerTaxe(technique, taxe(branche, { dateEffet: "2020-01-01" }), null);
    const prisma = obtenirPrisma();

    await expect(
      prisma.$executeRawUnsafe(`INSERT INTO taxes (branche, taux_pourcent, assiette, date_effet, cree_par) VALUES ('${branche}', 3, 'NETTE', '2025-01-01', 'sql')`),
    ).rejects.toThrow(/taxes_sans_chevauchement/);
    await expect(prisma.$executeRawUnsafe(`UPDATE taxes SET taux_pourcent = 9, date_fin = '2026-12-31' WHERE branche = '${branche}'`)).rejects.toThrow(/paramétrage historisé/);
    await expect(prisma.$executeRawUnsafe(`UPDATE taxes SET date_fin = '2026-12-31' WHERE branche = '${branche}'`)).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(`UPDATE taxes SET date_fin = '2027-12-31' WHERE branche = '${branche}'`)).rejects.toThrow(/paramétrage historisé/);
  });

  it("le calcul prend la ligne la plus précise pour le régime de taxe (H29 fermée) et refuse un taux mixte", async () => {
    const branche = unique("PREC").toUpperCase().replace(/-/g, "_");
    await assurerBranche(branche);
    await creerTaxe(technique, taxe(branche, { tauxPourcent: "7.25", dateEffet: "2020-01-01" }), null);
    await creerTaxe(technique, taxe(branche, { typeContrat: "INDIVIDUEL", tauxPourcent: "4", dateEffet: "2020-01-01" }), null);
    const code = unique("PREC").toUpperCase().replace(/-/g, "_");
    await creerProduit(technique, { code, libelle: "Précision (test)", gamme: "RELAX", branche }, null);
    await creerVersion(technique, code, versionBeni({ dateEffet: "2020-01-01" }), null);
    const demande = (regimeTaxe: string) => calculerPourProduit(technique, { codeProduit: code, regimeTaxe, ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] });

    expect((await demande("INDIVIDUEL")).taxe).toMatchObject({ tauxPourcent: "4", typeContrat: "INDIVIDUEL" });
    expect((await demande("GROUPE")).taxe).toMatchObject({ tauxPourcent: "7.25", typeContrat: null });
    await expect(demande("FAMILLE")).rejects.toThrow(/régime de taxe/); // un type de contrat n'est pas un régime
    await expect(demande("")).rejects.toBeInstanceOf(ErreurMetier); // régime absent (formulaire vide)
    // Une ligne de taux ne se rattache plus qu'à un régime (Individuel, Groupe) ou à tous.
    await expect(creerTaxe(technique, taxe(branche, { typeContrat: "FAMILLE", dateEffet: "2030-01-01" }), null)).rejects.toThrow(/régime de taxe est invalide/);

    const mixte = unique("MIX").toUpperCase().replace(/-/g, "_");
    await assurerBranche(mixte);
    await creerTaxe(technique, taxe(mixte, { tauxPourcent: null, tauxMixte: true, commentaire: "12,5 % incendie ; 7,25 % reste", dateEffet: "2020-01-01" }), null);
    const codeMixte = `${code}_M`;
    await creerProduit(technique, { code: codeMixte, libelle: "Mixte (test)", gamme: "RELAX", branche: mixte }, null);
    await creerVersion(technique, codeMixte, versionBeni({ dateEffet: "2020-01-01" }), null);
    await expect(calculerPourProduit(technique, { codeProduit: codeMixte, regimeTaxe: "INDIVIDUEL", ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] })).rejects.toThrow(
      "taux mixte non pris en charge : à paramétrer",
    );
    await expect(creerTaxe(technique, taxe(unique("X").toUpperCase().replace(/-/g, "_"), { tauxPourcent: "3", tauxMixte: true }), null)).rejects.toBeInstanceOf(ErreurMetier);
  });

  it("charge les taux de la loi depuis les données de démarrage, une seule fois, sans écraser un taux existant", async () => {
    const fichier = JSON.parse(readFileSync(fileURLToPath(new URL("../../prisma/donnees/taxes-loi.json", import.meta.url)), "utf8")) as { lignes: TaxeDemarrage[] };

    const branches = JSON.parse(readFileSync(fileURLToPath(new URL("../../prisma/donnees/branches.json", import.meta.url)), "utf8")) as { lignes: BrancheSaisie[] };
    await initialiserBranches(branches.lignes);
    expect(await initialiserBranches(branches.lignes)).toBe(0);
    await initialiserTaxes(fichier.lignes);
    expect(await initialiserTaxes(fichier.lignes)).toBe(0);
    const taux = (await listerTaxes(technique)).filter((t) => ["IA", "DECES", "SANTE", "IARD", "INCENDIE", "MOTO", "VOYAGE", "RECOLTE"].includes(t.branche));
    expect(taux.map((t) => [t.branche, t.typeContrat, t.tauxPourcent, t.tauxMixte])).toEqual(
      expect.arrayContaining([
        ["IA", null, "7.25", false],
        ["DECES", null, "0", false],
        ["SANTE", "INDIVIDUEL", "4", false],
        ["SANTE", "GROUPE", "1.5", false],
        ["IARD", null, "7.25", false],
        ["INCENDIE", null, "12.5", false],
        ["MOTO", null, "7.25", false],
        ["VOYAGE", null, "7.25", false],
        ["RECOLTE", null, "7.25", false],
      ]),
    );
  });
});

describe("branches fiscales paramétrables (D21)", () => {
  const code = () => unique("BR").toUpperCase().replace(/-/g, "_");
  const taxe = (branche: string) => ({ branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "2", assiette: "NETTE_ACCESSOIRES" as const, dateEffet: "2026-01-01", dateFin: null });

  it("réserve l'écriture à la Technique, refuse un doublon et un code invalide, journalise la création", async () => {
    const c = code();

    await expect(creerBranche(commercial, { code: c, libelle: "Test" }, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerBranche(technique, { code: "mauvais code", libelle: "Test" }, null)).rejects.toBeInstanceOf(ErreurMetier);
    await expect(creerBranche(technique, { code: c, libelle: " " }, null)).rejects.toThrow(/libellé/);
    await creerBranche(technique, { code: c, libelle: "Moto" }, null);
    await expect(creerBranche(technique, { code: c, libelle: "Moto" }, null)).rejects.toThrow(/existe déjà/);
    expect((await listerBranches(comptabilite)).find((b) => b.code === c)).toMatchObject({ libelle: "Moto", actif: true });
    expect((await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.some((l) => l.objet === `branche ${c}` && l.utilisateur === technique.identifiant)).toBe(true);
  });

  it("refuse un taux ou un produit sur une branche inconnue ; la désactivation bloque les nouveaux, pas les anciens", async () => {
    const c = code();

    await expect(creerTaxe(technique, taxe(c), null)).rejects.toThrow(/pas dans la liste des branches/);
    await expect(creerProduit(technique, { code: c, libelle: "P", gamme: "G", branche: c }, null)).rejects.toThrow(/pas dans la liste des branches/);
    await creerBranche(technique, { code: c, libelle: "Récolte" }, null);
    await creerTaxe(technique, taxe(c), null);
    await modifierBranche(technique, c, { libelle: "Récolte (agricole)", actif: false }, null);
    await expect(creerTaxe(technique, { ...taxe(c), dateEffet: "2027-01-01" }, null)).rejects.toThrow(/désactivée/);
    await expect(creerProduit(technique, { code: c, libelle: "P", gamme: "G", branche: c }, null)).rejects.toThrow(/désactivée/);
    expect((await listerTaxes(technique)).some((t) => t.branche === c)).toBe(true); // les taux existants restent
    const modif = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.find((l) => l.objet === `branche ${c}` && l.avant !== null)!;
    expect(modif.avant).toEqual({ libelle: "Récolte", actif: true });
    expect(modif.apres).toEqual({ libelle: "Récolte (agricole)", actif: false });
  });

  it("la base empêche de supprimer une branche, de changer son code, ou de la supprimer alors qu'un taux l'utilise", async () => {
    const c = code();
    await creerBranche(technique, { code: c, libelle: "Voyage" }, null);
    const prisma = obtenirPrisma();

    await expect(prisma.$executeRawUnsafe(`UPDATE branches SET code = '${c}X' WHERE code = '${c}'`)).rejects.toThrow(/seuls le libellé/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM branches WHERE code = '${c}'`)).rejects.toThrow(/suppression interdite/);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO taxes (branche, taux_pourcent, assiette, date_effet, cree_par) VALUES ('INCONNUE_${c}', 1, 'NETTE', '2026-01-01', 'sql')`)).rejects.toThrow(/taxes_branche_fkey/);
  });
});
