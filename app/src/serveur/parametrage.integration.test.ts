// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { lireJournal } from "./audit";
import { initialiserProfilsEtDroits } from "./droits";
import {
  calculerPourProduit,
  creerProduit,
  creerTaxe,
  creerVersion,
  listerTaxes,
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
  cotation: { validiteJours: 90, formulesMax: 3 },
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
    await creerTaxe(technique, { branche, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerProduit(technique, { code, libelle: "Santé BENI (test)", gamme: "RELAX", branche }, null);
    await creerVersion(technique, code, versionBeni(), null);
  });

  it("T1 : Solo 288 000, Famille 15 600 000, total 15 888 000", async () => {
    const r = await calculerPourProduit(technique, {
      codeProduit: code,
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
      codeProduit: code,
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

    const r = await calculerPourProduit(technique, {
      codeProduit: codeT3,
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
    await creerTaxe(technique, { branche, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await creerTaxe(technique, { branche, tauxPourcent: "1.9", assiette: "NETTE_ACCESSOIRES", dateEffet: "2026-09-01", dateFin: null }, null);
    await creerProduit(technique, { code, libelle: "Historique (test)", gamme: "RELAX", branche }, null);
    await creerVersion(technique, code, versionBeni({ dateEffet: "2026-01-01", formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "100000", accessoireMode: "AUCUN", accessoireValeur: "0" }] }), null);
    await creerVersion(technique, code, versionBeni({ dateEffet: "2026-09-01", formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "120000", accessoireMode: "AUCUN", accessoireValeur: "0" }] }), null);
  });

  it("utilise la version du produit en vigueur à la date du document", async () => {
    const ancien = await calculerPourProduit(technique, { codeProduit: code, ...ANNEE, dateDocument: "2026-08-15", lignes });
    const recent = await calculerPourProduit(technique, { codeProduit: code, ...ANNEE, dateDocument: "2026-10-05", lignes });

    expect(ancien.resultat.lignes[0].arrondi.nette.toString()).toBe("100000");
    expect(ancien.versionDu).toBe("2026-01-01");
    expect(recent.resultat.lignes[0].arrondi.nette.toString()).toBe("120000");
    expect(recent.versionDu).toBe("2026-09-01");
  });

  it("utilise le taux de taxe en vigueur à la date d'effet de la police", async () => {
    const avant = await calculerPourProduit(technique, { codeProduit: code, dateEffet: "2026-07-22", dateEcheance: "2026-12-31", dateDocument: "2026-10-05", lignes });
    const apres = await calculerPourProduit(technique, { codeProduit: code, dateEffet: "2026-10-01", dateEcheance: "2026-12-31", dateDocument: "2026-10-05", lignes });

    expect(avant.taxe.tauxPourcent).toBe("1.5");
    expect(apres.taxe.tauxPourcent).toBe("1.9");
  });

  it("refuse un document daté avant la première version, et une date sans taxe", async () => {
    await expect(calculerPourProduit(technique, { codeProduit: code, ...ANNEE, dateDocument: "2025-06-01", lignes })).rejects.toThrow(/Aucun paramétrage/);
    await expect(calculerPourProduit(technique, { codeProduit: code, dateEffet: "2019-01-01", dateEcheance: "2019-12-31", lignes })).rejects.toThrow(/Aucune taxe/);
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

  it("refuse deux versions ou deux taxes à la même date d'effet", async () => {
    await expect(creerVersion(technique, code, versionBeni({ dateEffet: "2026-09-01" }), null)).rejects.toThrow(/existe déjà/);
    await expect(creerTaxe(technique, { branche, tauxPourcent: "2", assiette: "NETTE", dateEffet: "2026-09-01", dateFin: null }, null)).rejects.toThrow(/existe déjà/);
  });
});

describe("règles de gestion", () => {
  const code = unique("REG").toUpperCase().replace(/-/g, "_");
  const branche = `REG_${code}`;

  beforeAll(async () => {
    await creerTaxe(technique, { branche, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
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
    const taxe = { branche: "AUTRE", tauxPourcent: "1", assiette: "NETTE" as const, dateEffet: "2026-01-01", dateFin: null };

    await expect(creerTaxe(commercial, taxe, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerTaxe(comptabilite, taxe, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerProduit(commercial, { code: "X", libelle: "x", gamme: "x", branche: "X" }, null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerVersion(comptabilite, code, versionBeni({ dateEffet: "2026-12-01" }), null)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("laisse consulter et calculer au commercial et à la comptabilité, pas à l'Admin système", async () => {
    const demande = { codeProduit: code, ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] };

    await expect(calculerPourProduit(commercial, demande)).resolves.toBeDefined();
    await expect(listerTaxes(comptabilite)).resolves.toBeDefined();
    await expect(calculerPourProduit(admin, demande)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("signale la double validation au-dessus du seuil de TTC du produit", async () => {
    const petit = await calculerPourProduit(technique, { codeProduit: code, ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] });
    const grand = await calculerPourProduit(technique, { codeProduit: code, ...ANNEE, lignes: [{ codeFormule: "FAMILLE", effectif: 10 }] });

    expect(petit.doubleValidationRequise).toBe(false);
    expect(grand.doubleValidationRequise).toBe(true);
  });

  it("applique la répartition 40/30/30 et les frais de fractionnement (taxés), et limite le nombre de tranches", async () => {
    const r = await calculerPourProduit(technique, { codeProduit: code, ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 3 }], nombreTranches: 3 });

    expect(r.resultat.fraisFractionnement?.arrondi.accessoires.toString()).toBe("5000");
    // 288 000 (3 Solo) + frais de fractionnement 5 000 + taxe de 1,5 % sur ces frais (75)
    expect(r.resultat.totaux.arrondi.ttc.toString()).toBe("293075");
    expect(r.echeancier!.map((x) => x.montant.toString())).toEqual(["117230", "87923", "87922"]);
    const somme = r.echeancier!.reduce((s, x) => s.plus(x.montant), r.resultat.totaux.arrondi.ttc.minus(r.resultat.totaux.arrondi.ttc));
    expect(somme.toString()).toBe("293075");
    await expect(
      calculerPourProduit(technique, { codeProduit: code, ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }], nombreTranches: 5 }),
    ).rejects.toThrow(/de 1 à 4 tranche/);
  });

  it("refuse une formule inconnue, un produit inconnu et une version invalide", async () => {
    await expect(calculerPourProduit(technique, { codeProduit: code, ...ANNEE, lignes: [{ codeFormule: "NOPE", effectif: 1 }] })).rejects.toThrow(/inconnue/);
    await expect(calculerPourProduit(technique, { codeProduit: "INCONNU", ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] })).rejects.toBeInstanceOf(ErreurMetier);
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
