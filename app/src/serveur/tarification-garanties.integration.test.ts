// Session 6.2a, tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
// Un produit en mode GARANTIES ne peut ni calculer, ni émettre de cotation, ni de facture ; un produit en mode FORMULE
// (T1, T2, T3) ne change pas d'un franc. Tous les chiffres sont ceux du CDC (T1) ou inventés.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EntreeCalcul } from "@/domaine/calcul/calcul";
import { MESSAGE_BROUILLON_A_FORMULES, MESSAGE_TARIFICATION_PAR_GARANTIES, type VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { accepter, creerBrouillon, lireCotation, modifierBrouillon, renvoyerEnBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { contexteProduit, montantsDu } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { aujourdhui, calculerPourProduit, construireEntree, creerProduit, creerTaxe, creerVersion, listerVersions, resoudreContexte } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let technique2: UtilisateurCourant;
let commercial: UtilisateurCourant;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

/** SQL direct sur la base de test : renvoie le message de refus de la base, ou « accepté ». */
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

const prospect: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Test", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" };
const ANNEE = { dateEffet: "2026-01-01", dateEcheance: "2026-12-31" };
const UNITE_F = { code: "UNITE", libelle: "Unité (sans tarif)", tauxCouverture: null, primeUnitaire: "0", accessoireMode: "AUCUN", accessoireValeur: "0" } as const;

/** Tarif BENI de T1 (CDC) : 3 Solo + 60 Famille = 15 888 000 F au taux de 1,5 %. */
const versionBeni = (surcharge: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: true, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: "20000000",
  formules: [
    { code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" },
    { code: "FAMILLE", libelle: "Famille", tauxCouverture: null, primeUnitaire: "252657.63", accessoireMode: "FIXE", accessoireValeur: "210000" },
  ],
  ...surcharge,
});

/** Version GARANTIES : la prime est composée par la Technique, aucune prime n'est paramétrée (formule de forme, prime 0). */
const versionGaranties = (dateEffet: string): VersionSaisie => ({
  ...versionBeni({ dateEffet, modeTarification: "GARANTIES", seuilValidationTtc: null, formules: [{ ...UNITE_F }] }),
});

const saisie = (codeProduit: string, surcharge: Partial<SaisieCotation> = {}): SaisieCotation => ({
  codeProduit,
  clientId: null,
  typeContrat: "GROUPE",
  souscripteur: prospect,
  ...ANNEE,
  nombreTranches: 4,
  lignes: [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }],
  motifForcage: null,
  assures: [],
  beneficiaires: null,
  contactsUrgence: null,
  risque: {},
  ...surcharge,
});
/** Cotation d'un produit par garanties (session 6.2b) : aucune formule, la prime sera composée par la Technique. */
const saisieGaranties = (codeProduit: string) => saisie(codeProduit, { lignes: [], nombreTranches: 1 });

let compteurPolice = 0;
const numeroPolice = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-G${String(++compteurPolice).padStart(5, "0")}`;

const nombreDeCotations = (code: string) => obtenirPrisma().cotation.count({ where: { produit: { code } } });
const parametresBranche = async (code: string, taxe: { mixte: boolean }) => {
  await assurerBranche(code);
  await creerTaxe(
    technique,
    taxe.mixte
      ? { branche: code, typeContrat: null, tauxMixte: true, commentaire: "12,5 % pour une garantie, 7,25 % pour les autres (inventé)", tauxPourcent: null, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }
      : { branche: code, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null },
    null,
  );
  return code;
};

let brancheSante: string;
let brancheMixte: string;

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const id = unique("admin");
  await creerAdministrateurInitial({ identifiant: id, nom: "Admin", motDePasse: MDP });
  admin = await compte(id);
  [technique, technique2, commercial] = [await nouveauCompte("TECHNIQUE"), await nouveauCompte("TECHNIQUE"), await nouveauCompte("COMMERCIAL")];
  brancheSante = await parametresBranche(`SANTE_${CODE("G")}`, { mixte: false });
  brancheMixte = await parametresBranche(`IARD_${CODE("G")}`, { mixte: true });
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("FORMULE : T1 ne change pas d'un franc", () => {
  it("une version créée sans mode, ou avec le mode FORMULE, donne exactement les montants de T1 (15 888 000)", async () => {
    const [sansMode, avecMode] = [CODE("FSM"), CODE("FAM")];
    for (const [code, v] of [[sansMode, versionBeni()], [avecMode, versionBeni({ modeTarification: "FORMULE" })]] as const) {
      await creerProduit(technique, { code, libelle: "Santé BENI (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
      await creerVersion(technique, code, v, null);
    }
    const lignes = [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }];
    for (const code of [sansMode, avecMode]) {
      const r = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes, nombreTranches: 4 });
      expect(r.resultat.lignes.map((l) => l.arrondi.ttc.toString())).toEqual(["288000", "15600000"]);
      expect(r.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
      expect(r.echeancier?.map((t) => t.montant.toString())).toEqual(["3972000", "3972000", "3972000", "3972000"]);
    }
    // Le mode lu en base : FORMULE dans les deux cas (défaut de la colonne).
    for (const code of [sansMode, avecMode]) {
      expect((await listerVersions(technique, code))!.versions.map((v) => v.modeTarification)).toEqual(["FORMULE"]);
    }
  });

  it("une cotation FORMULE s'émet toujours et porte les montants de T1", async () => {
    const code = CODE("FEM");
    await creerProduit(technique, { code, libelle: "Santé BENI (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    const id = await creerBrouillon(commercial, saisie(code), null);
    const r = await soumettre(commercial, id, null);
    expect(r.statut).toBe("EMISE");
    expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
  });

  it("un produit à la formule rattaché à une branche à taux mixte reste refusé avec son propre message (le filet existe toujours)", async () => {
    const code = CODE("FMX");
    await creerProduit(technique, { code, libelle: "Formule sur taux mixte (test)", gamme: "RELAX", branchePrincipale: "INCENDIE_DOMMAGES", branche: brancheMixte }, null);
    await creerVersion(technique, code, versionBeni(), null);
    await expect(calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }] })).rejects.toThrow("taux mixte non pris en charge");
  });
});

describe("GARANTIES : aucun montant automatique", () => {
  it("le calcul est refusé avec le message de la Technique, que la taxe de la branche soit simple ou mixte (le message ne dépend plus du taux)", async () => {
    for (const branche of [brancheSante, brancheMixte]) {
      const code = CODE("GAR");
      await creerProduit(technique, { code, libelle: "Garanties (test)", gamme: "RELAX", branchePrincipale: "INCENDIE_DOMMAGES", branche }, null);
      await creerVersion(technique, code, versionGaranties("2020-01-01"), null);
      const demande = { codeProduit: code, regimeTaxe: "GROUPE" as const, ...ANNEE, lignes: [{ codeFormule: "UNITE", effectif: 1 }] };

      await expect(calculerPourProduit(technique, demande)).rejects.toThrow(MESSAGE_TARIFICATION_PAR_GARANTIES);
      await expect(calculerPourProduit(technique, demande)).rejects.toBeInstanceOf(ErreurMetier);
      await expect(calculerPourProduit(technique, demande)).rejects.not.toThrow(/taux mixte/);
    }
  });

  it("la construction de l'entrée du moteur refuse elle aussi un contexte GARANTIES ou d'un mode inconnu, même fabriqué hors de la résolution des paramètres (ceinture)", async () => {
    const code = CODE("CTX");
    await creerProduit(technique, { code, libelle: "Contexte (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    const contexte = await resoudreContexte(obtenirPrisma(), code, aujourdhui(), ANNEE.dateEffet, "GROUPE");
    const demande = { ...ANNEE, lignes: [{ codeFormule: "SOLO", effectif: 1 }], nombreTranches: 1 };

    expect(construireEntree(contexte, demande).entree.lignes).toHaveLength(1);
    for (const mode of ["GARANTIES", "AUTRE"]) {
      expect(() => construireEntree({ ...contexte, version: { ...contexte.version, modeTarification: mode as never } }, demande)).toThrow(MESSAGE_TARIFICATION_PAR_GARANTIES);
    }
  });

  it("le brouillon d'un produit par garanties naît « à composer » (sans TTC) et ne se soumet pas tant que la prime n'est pas composée ; avec des formules, il est refusé", async () => {
    const code = CODE("GAC");
    await creerProduit(technique, { code, libelle: "Garanties (test)", gamme: "RELAX", branchePrincipale: "INCENDIE_DOMMAGES", branche: brancheSante }, null);
    await creerVersion(technique, code, versionGaranties("2020-01-01"), null);

    await expect(creerBrouillon(commercial, saisie(code), null)).rejects.toThrow(MESSAGE_BROUILLON_A_FORMULES);
    expect(await nombreDeCotations(code)).toBe(0);

    const id = await creerBrouillon(commercial, saisieGaranties(code), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.composition).toMatchObject({ lignes: [] });
    expect(c.lignes).toEqual([]);
    expect((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).ttcTotal).toBeNull();
    await expect(soumettre(commercial, id, null)).rejects.toThrow(/pas encore composée/);
    expect((await lireCotation(commercial, id))!.statut).toBe("BROUILLON");
  });

  it("un produit basculé en GARANTIES : le brouillon d'avant ne peut plus être soumis ni modifié, une cotation déjà émise reste acceptable (T10)", async () => {
    const code = CODE("BAS");
    await creerProduit(technique, { code, libelle: "Bascule (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    const emise = await creerBrouillon(commercial, saisie(code), null);
    expect((await soumettre(commercial, emise, null)).statut).toBe("EMISE");
    const brouillon = await creerBrouillon(commercial, saisie(code), null);

    // La version GARANTIES s'applique aux documents datés d'aujourd'hui.
    await creerVersion(technique, code, versionGaranties(aujourdhui()), null);

    await expect(soumettre(commercial, brouillon, null)).rejects.toThrow(MESSAGE_BROUILLON_A_FORMULES);
    await expect(modifierBrouillon(commercial, brouillon, saisie(code), null)).rejects.toThrow(MESSAGE_BROUILLON_A_FORMULES);
    // L'écran de modification d'un produit passé « par garanties » n'envoie plus de formule ni de forçage (H89) : le refus ne dépend pas du
    // contenu de la saisie, mais de la nature de ce qui est enregistré. Le brouillon n'est jamais converti en silence en brouillon « à composer ».
    await expect(modifierBrouillon(commercial, brouillon, saisieGaranties(code), null)).rejects.toThrow(MESSAGE_BROUILLON_A_FORMULES);
    await expect(creerBrouillon(commercial, saisie(code), null)).rejects.toThrow(MESSAGE_BROUILLON_A_FORMULES);
    const apres = (await lireCotation(commercial, brouillon))!;
    expect(apres.statut).toBe("BROUILLON");
    expect(apres.numero).toBeNull();
    expect(apres.composition).toBeNull();
    expect(apres.lignes.length).toBeGreaterThan(0); // les formules préparées sont intactes
    expect(apres.brouillonAFormulesSousGaranties).toBe(true); // la fiche l'explique et ne propose plus de le modifier ni de le soumettre

    // T10 : la cotation émise sous l'ancienne version garde ses montants et son acceptation reste possible.
    const figee = (await lireCotation(commercial, emise))!;
    expect(figee.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    await accepter(commercial, emise, ["SOLO", "FAMILLE"], numeroPolice(), null);
    expect((await lireCotation(commercial, emise))!.statut).toBe("ACCEPTEE");
  });

  it("une cotation « À valider » d'avant la bascule ne s'émet plus après : la validation refuse, la cotation reste en attente", async () => {
    const code = CODE("VAL");
    await creerProduit(technique, { code, libelle: "Validation (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    // Au-dessus du seuil de 20 000 000 F (100 familles : environ 25,9 millions) : la cotation attend un valideur.
    const id = await creerBrouillon(commercial, saisie(code, { lignes: [{ codeFormule: "FAMILLE", effectif: 100 }] }), null);
    expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");

    // Pendant l'attente, la Technique passe le produit en GARANTIES (version du jour). Chemin réel de l'application, sans SQL.
    await creerVersion(technique, code, versionGaranties(aujourdhui()), null);

    await expect(valider(technique2, id, null)).rejects.toThrow(MESSAGE_TARIFICATION_PAR_GARANTIES);
    const apres = (await lireCotation(technique2, id))!;
    expect(apres.statut).toBe("A_VALIDER");
    expect(apres.numero).toBeNull();
    // Renvoyée en brouillon, elle ne se soumet pas davantage : il faudra la recomposer (6.2b).
    await renvoyerEnBrouillon(technique2, id, "Produit passé en garanties", null);
    await expect(soumettre(commercial, id, null)).rejects.toThrow(MESSAGE_BROUILLON_A_FORMULES);
  });

  it("ceinture : l'émission refuse aussi une cotation rattachée à la version GARANTIES (état fabriqué en SQL : aucun chemin de l'application n'y mène)", async () => {
    const code = CODE("CEI");
    await creerProduit(technique, { code, libelle: "Ceinture (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    const id = await creerBrouillon(commercial, saisie(code, { lignes: [{ codeFormule: "FAMILLE", effectif: 100 }] }), null);
    expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");
    // La version GARANTIES est datée dans l'avenir (donc sans effet sur la version « en vigueur » d'aujourd'hui) : seul le rattachement fabriqué compte.
    await creerVersion(technique, code, versionGaranties("2099-01-01"), null);
    expect(await sql(`UPDATE cotations SET version_date_effet = DATE '2099-01-01' WHERE id = ${id}`)).toBe("accepté");

    await expect(valider(technique2, id, null)).rejects.toThrow(MESSAGE_TARIFICATION_PAR_GARANTIES);
    expect((await lireCotation(technique2, id))!.statut).toBe("A_VALIDER");
  });

  it("une version GARANTIES datée dans l'avenir ne bloque rien avant sa date (H86) ; elle bloque dès qu'elle est en vigueur", async () => {
    const code = CODE("FUT");
    await creerProduit(technique, { code, libelle: "Version future (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    await creerVersion(technique, code, versionGaranties("2099-01-01"), null);
    const lignes = [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }];

    const r = await calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, lignes });
    expect(r.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    expect((await soumettre(commercial, await creerBrouillon(commercial, saisie(code), null), null)).statut).toBe("EMISE");
    await expect(calculerPourProduit(technique, { codeProduit: code, regimeTaxe: "GROUPE", ...ANNEE, dateDocument: "2099-01-01", lignes: [{ codeFormule: "UNITE", effectif: 1 }] })).rejects.toThrow(
      MESSAGE_TARIFICATION_PAR_GARANTIES,
    );
  });

  it("montantsDu (création des factures d'affaire nouvelle, de renouvellement et d'avenant ; CP ; PDF de cotation) refuse une version GARANTIES", async () => {
    const code = CODE("DOC");
    await creerProduit(technique, { code, libelle: "Documents (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    await creerVersion(technique, code, versionGaranties("2026-06-01"), null);
    const produit = await obtenirPrisma().produit.findUniqueOrThrow({ where: { code } });
    const entree = (await creerEntreeDeReference()) as EntreeCalcul;

    const formule = await contexteProduit(produit.id, new Date("2020-01-01T00:00:00.000Z"));
    const garanties = await contexteProduit(produit.id, new Date("2026-06-01T00:00:00.000Z"));
    expect(formule.modeTarification).toBe("FORMULE");
    expect(garanties.modeTarification).toBe("GARANTIES");

    expect(montantsDu(entree, formule).totaux.ttc).toBe("15888000");
    expect(() => montantsDu(entree, garanties)).toThrow(MESSAGE_TARIFICATION_PAR_GARANTIES);
  });
});

describe("Version : lecture, journal et immutabilité du mode", () => {
  it("le mode est lu tel qu'enregistré et figure au journal de la création de la version", async () => {
    const code = CODE("JNL");
    await creerProduit(technique, { code, libelle: "Journal (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionGaranties("2020-01-01"), null);
    await creerVersion(technique, code, versionBeni({ dateEffet: "2026-03-01" }), null);

    const { versions } = (await listerVersions(technique, code))!;
    expect(versions.map((v) => [v.dateEffet, v.modeTarification])).toEqual([["2026-03-01", "FORMULE"], ["2020-01-01", "GARANTIES"]]);

    const journal = await lireJournal({ action: "PARAMETRE_MODIFIE" });
    const lignes = journal.lignes.filter((l) => (l.apres as { produit?: string } | null)?.produit === code);
    expect(lignes.map((l) => (l.apres as { modeTarification?: string }).modeTarification).sort()).toEqual(["FORMULE", "GARANTIES"]);
  });

  it("un mode inconnu est refusé avant d'atteindre la base", async () => {
    const code = CODE("INV");
    await creerProduit(technique, { code, libelle: "Invalide (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await expect(creerVersion(technique, code, versionBeni({ modeTarification: "AUTRE" as never }), null)).rejects.toThrow(/mode de tarification/);
  });

  it("la base refuse elle aussi un mode inconnu, et le mode d'une version existante ne se modifie pas (versions historisées)", async () => {
    const code = CODE("SQL");
    await creerProduit(technique, { code, libelle: "SQL (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    await creerVersion(technique, code, versionBeni(), null);
    const produit = await obtenirPrisma().produit.findUniqueOrThrow({ where: { code } });

    expect(await sql(`INSERT INTO produit_versions (produit_id, date_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, mode_tarification, cree_par)
      VALUES (${produit.id}, DATE '2027-01-01', 1, 'PROCHE', 'LIGNE', 'TAXE', true, 'AUTRE', 'test')`)).toMatch(/produit_versions_mode_tarification_valide/);
    expect(await sql(`UPDATE produit_versions SET mode_tarification = 'GARANTIES' WHERE produit_id = ${produit.id} AND date_effet = DATE '2020-01-01'`)).toMatch(/paramétrage historisé/);
    expect((await listerVersions(technique, code))!.versions[0].modeTarification).toBe("FORMULE");
  });

  it("la colonne vaut FORMULE par défaut (une version insérée sans mode, comme avant la 6.2a, se calcule)", async () => {
    const code = CODE("DEF");
    await creerProduit(technique, { code, libelle: "Défaut (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
    const produit = await obtenirPrisma().produit.findUniqueOrThrow({ where: { code } });
    expect(await sql(`INSERT INTO produit_versions (produit_id, date_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, cree_par)
      VALUES (${produit.id}, DATE '2020-01-01', 1, 'PROCHE', 'LIGNE', 'TAXE', true, 'test')`)).toBe("accepté");
    const ligne = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produitId: produit.id } });
    expect(ligne.modeTarification).toBe("FORMULE");
  });
});

/** Entrée du moteur de T1 (3 Solo + 60 Famille), prise d'une cotation FORMULE émise pour l'occasion. */
async function creerEntreeDeReference(): Promise<unknown> {
  const code = CODE("REF");
  await creerProduit(technique, { code, libelle: "Référence (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheSante }, null);
  await creerVersion(technique, code, versionBeni(), null);
  const id = await creerBrouillon(commercial, saisie(code), null);
  await soumettre(commercial, id, null);
  return (await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).donneesCalcul;
}
