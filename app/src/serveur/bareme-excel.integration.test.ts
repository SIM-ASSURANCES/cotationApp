// Session B9 (D50) : import / export Excel du barème, de bout en bout sur la base de test. Les classeurs sont GÉNÉRÉS ici (aucun .xlsx
// dans le dépôt) à partir du SECURPRO inventé ; les catégories de taxe sont celles, aléatoires, de ce fichier (la base est partagée).
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { lireBareme, type Bareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { basculerVersionAuBareme, calculerAvecBaremePublie, enregistrerBrouillonBareme, ErreurPublicationBareme, lireBaremePublie, publierBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { ErreurImportBareme, FEUILLE } from "./bareme-classeur-lecture";
import { exporterBaremePublieXlsx, importerBaremeXlsx, modeleBaremeXlsx } from "./bareme-excel";
import { debutTest } from "./dates-test";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
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

/** SECURPRO inventé, aux catégories de taxe de ce fichier. */
function baremeDeTest(retouche: (d: { jeuxEssai: { attendu: { ttc?: string } }[] }) => void = () => {}): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[]; jeuxEssai: { attendu: { ttc?: string } }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  retouche(d);
  return lireBareme(d);
}

const classeurDeTest = (b: Bareme = baremeDeTest()) => construireClasseur(b, { titre: "Classeur de test" });

const versionSaisie: VersionSaisie = {
  dateEffet: debutTest(),
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
};

async function nouvelleVersion(): Promise<number> {
  const code = CODE("XLSX");
  await creerProduit(technique, { code, libelle: "Produit importé (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(technique, code, versionSaisie, null);
  return (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } })).id;
}

const lignes = (versionId: number) => obtenirPrisma().baremeDocument.findMany({ where: { versionId } });

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
  IARD = await assurerBranche(CODE("IARD"));
  INCENDIE = await assurerBranche(CODE("INCENDIE"));
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
});

describe("Import Excel du barème", () => {
  it("le SECURPRO inventé s'importe en BROUILLON, se publie et calcule 139 420 F TTC", async () => {
    const versionId = await nouvelleVersion();
    const { id, empreinte } = await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await classeurDeTest(), "10.0.0.3");
    const [brouillon] = await lignes(versionId);
    expect(brouillon).toMatchObject({ id, statut: "BROUILLON", empreinte, publiePar: null });

    const publie = await publierBareme(technique, versionId, "Publication du classeur importé", null);
    expect(publie.empreinte).toBe(empreinte);
    const lu = await lireBaremePublie(obtenirPrisma(), versionId);
    expect(lu.bareme.jeuxEssai[0].attendu.ttc).toBe("139420");
    await basculerVersionAuBareme(technique, versionId, null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: versionId } })).modeTarification).toBe("BAREME");

    const journal = (await lireJournal({ action: "BAREME_IMPORTE" })).lignes.find((l) => l.objet === `bareme_document ${id}`)!;
    expect(journal.apres).toMatchObject({ versionId, fichier: "securpro.xlsx", empreinte });
    expect(journal.adresseIp).toBe("10.0.0.3");
  });

  it("un barème importé dont un essai échoue est un brouillon, mais sa publication est refusée (écart ligne à ligne)", async () => {
    const versionId = await nouvelleVersion();
    await importerBaremeXlsx(technique, versionId, "ecart.xlsx", await classeurDeTest(baremeDeTest((d) => (d.jeuxEssai[0].attendu.ttc = "139421"))), null);
    const e = (await publierBareme(technique, versionId, "Tentative", null).catch((x) => x)) as ErreurPublicationBareme;
    expect(e).toBeInstanceOf(ErreurPublicationBareme);
    expect(e.details.some((d) => d.includes("ttc total : attendu 139421, obtenu 139420"))).toBe(true);
    expect((await lignes(versionId))[0].statut).toBe("BROUILLON");
  });

  it("une seule erreur : rien n'est enregistré, toutes les erreurs sont nommées ; le brouillon précédent reste intact", async () => {
    const versionId = await nouvelleVersion();
    const premier = await importerBaremeXlsx(technique, versionId, "bon.xlsx", await classeurDeTest(), null);

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(Buffer.from(await classeurDeTest()) as unknown as ArrayBuffer);
    classeur.getWorksheet(FEUILLE.champs)!.getCell("D2").value = "BIZARRE";
    classeur.getWorksheet(FEUILLE.composantes)!.getCell("F3").value = { formula: "1+1", result: 2 };
    const faux = new Uint8Array(await classeur.xlsx.writeBuffer());

    const e = (await importerBaremeXlsx(technique, versionId, "faux.xlsx", faux, null).catch((x) => x)) as ErreurImportBareme;
    expect(e).toBeInstanceOf(ErreurImportBareme);
    expect(e.details).toEqual(expect.arrayContaining([expect.stringMatching(/^Composantes!F3 : .*\(règle FORMULE_REFUSEE\)$/)]));
    const l = await lignes(versionId);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: premier.id, empreinte: premier.empreinte });

    // Erreur de schéma seule (sans formule) : nommée par cellule, rien d'écrit non plus.
    classeur.getWorksheet(FEUILLE.composantes)!.getCell("F3").value = 1;
    const e2 = (await importerBaremeXlsx(technique, versionId, "faux2.xlsx", new Uint8Array(await classeur.xlsx.writeBuffer()), null).catch((x) => x)) as ErreurImportBareme;
    expect(e2.details).toEqual([expect.stringMatching(/^Champs!D2 : valeur « BIZARRE » non admise .*\(règle VALEUR_NON_ADMISE\)$/)]);
    expect((await lignes(versionId))[0].empreinte).toBe(premier.empreinte);
  });

  it("le fichier doit être un .xlsx ; un fichier piégé est refusé sans rien écrire", async () => {
    const versionId = await nouvelleVersion();
    await expect(importerBaremeXlsx(technique, versionId, "barème.csv", new Uint8Array([1, 2, 3]), null)).rejects.toThrow(/\.xlsx/);
    await expect(importerBaremeXlsx(technique, versionId, "faux.xlsx", new TextEncoder().encode("pas un classeur"), null)).rejects.toBeInstanceOf(ErreurMetier);
    expect(await lignes(versionId)).toHaveLength(0);
  });

  it("le droit est celui du paramétrage des produits", async () => {
    const versionId = await nouvelleVersion();
    await expect(importerBaremeXlsx(commercial, versionId, "b.xlsx", await classeurDeTest(), null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(modeleBaremeXlsx(commercial, versionId)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(exporterBaremePublieXlsx(commercial, versionId)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("une version déjà publiée ne reçoit plus d'import", async () => {
    const versionId = await nouvelleVersion();
    await importerBaremeXlsx(technique, versionId, "b.xlsx", await classeurDeTest(), null);
    await publierBareme(technique, versionId, "Publié", null);
    await expect(importerBaremeXlsx(technique, versionId, "b.xlsx", await classeurDeTest(), null)).rejects.toThrow(/déjà un barème publié/);
  });
});

describe("Modèle et export Excel", () => {
  it("le modèle téléchargé est un classeur valide (SECURPRO inventé en exemple) ; une version inconnue est refusée", async () => {
    const versionId = await nouvelleVersion();
    const { nom, contenu } = await modeleBaremeXlsx(technique, versionId);
    expect(nom).toMatch(/^modele_bareme_.*\.xlsx$/);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(Buffer.from(contenu) as unknown as ArrayBuffer);
    expect(classeur.worksheets.map((w) => w.name)).toEqual(["Lisez-moi", "Blocs", "Champs", "Valeurs", "Intermediaires", "Garanties", "Composantes", "Tables", "SousJacents", "Essais"]);
    await expect(modeleBaremeXlsx(technique, -1)).rejects.toThrow(/introuvable/);
  });

  it("l'export exige un barème publié", async () => {
    const versionId = await nouvelleVersion();
    await importerBaremeXlsx(technique, versionId, "b.xlsx", await classeurDeTest(), null);
    await expect(exporterBaremePublieXlsx(technique, versionId)).rejects.toThrow(/aucun barème n'est publié/);
  });

  it("aller-retour : export d'un barème publié, réimport dans une autre version = même empreinte", async () => {
    const source = await nouvelleVersion();
    await enregistrerBrouillonBareme(technique, source, baremeDeTest(), null);
    const { empreinte } = await publierBareme(technique, source, "Source de l'aller-retour", null);

    const { nom, contenu } = await exporterBaremePublieXlsx(technique, source);
    expect(nom).toMatch(/^bareme_.*\.xlsx$/);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(Buffer.from(contenu) as unknown as ArrayBuffer);
    const lisezmoi: string[] = [];
    classeur.getWorksheet("Lisez-moi")!.eachRow((r) => lisezmoi.push(String(r.getCell(2).value)));
    expect(lisezmoi).toContain(empreinte);

    const cible = await nouvelleVersion();
    const reimporte = await importerBaremeXlsx(technique, cible, nom, contenu, null);
    expect(reimporte.empreinte).toBe(empreinte);
    const publie = await publierBareme(technique, cible, "Réimport", null);
    expect(publie.empreinte).toBe(empreinte);
    // Le barème réimporté calcule comme l'original.
    const essai = (await lireBaremePublie(obtenirPrisma(), cible)).bareme.jeuxEssai[0].entrees;
    const { resultat } = await calculerAvecBaremePublie(obtenirPrisma(), cible, { champs: essai.champs, souscrit: essai.souscrit }, {
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
      prorata: { actif: false },
      dateEffet: debutTest(),
      dateEcheance: debutTest(),
      taxes: { [IARD]: { tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES" }, [INCENDIE]: { tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES" } },
    });
    expect(resultat.ok).toBe(true);
  });
});
