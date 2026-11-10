// D66 (09/11/2026) : mode de tarification figé par produit ; version au barème « en préparation » qui entre en vigueur à la publication de son barème.
// Vraie base de test. Produits et données INVENTÉS (SECURPRO inventé, 139 420 F).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lireBareme } from "@/domaine/bareme";
import { ajouterJours, aujourdhui, echeanceUnAn } from "@/domaine/calcul/dates";
import { baseDeNouvelleVersion, DATE_EFFET_A_LA_PUBLICATION, enVigueur, versionPourCotation, type VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { basculerVersionAuBareme, controlerAvantPublication, depuisDate, enregistrerBrouillonBareme, ErreurPublicationBareme, lireBaremePublie, publierBareme, publierBaremeDetaille, rejouerLesEssaisBareme } from "./bareme";
import { creerBaremeVide, creerVersionDepuisBareme } from "./bareme-edition";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { importerBaremeXlsx } from "./bareme-excel";
import { calculerCotationBareme, creerBrouillon, lireCotation, soumettre, type SaisieCotation } from "./cotations";
import { debutTest, finTest } from "./dates-test";
import { initialiserProfilsEtDroits } from "./droits";
import { ajouterVersionHeritee } from "./produit-bareme-test";
import { calculerPourProduit, creerProduit, creerTaxe, creerVersion, dateDeVersionPourCotation, exigerModeCoherentEnVigueur, listerProduits, listerVersions, resoudreVersion, taxeEnVigueur } from "./parametrage";
import { assurerBranche } from "./branches-test";
import { fixerSeuilGlobalDeTest, retablirSeuilGlobalDeTest } from "./parametres-test";
import { baremeAuxBranches, creerBranchesFiscales, creerProduitAuBareme, dateDeVersion, versionAuBareme, type BranchesFiscales } from "./produit-bareme-test";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;
let branches: BranchesFiscales;

const souscripteur: Souscripteur = { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ATELIERS DU LAGON SARL (inventée)", telephone: "0700000000", email: "contact@ateliers-lagon.exemple.ci", adresse: "Zone industrielle, Abidjan" };

type Entrees = { champs: Record<string, string | boolean | string[]>; souscrit: string[]; effectif?: number };
const brutDe = (e: Entrees) => ({
  champs: Object.fromEntries(Object.entries(e.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
  souscrit: e.souscrit,
  ...(e.effectif !== undefined ? { effectif: String(e.effectif) } : {}),
});

/** Les entrées de l'essai annuel du barème de démonstration (139 420 F). */
async function essaiDe(versionId: number): Promise<Entrees> {
  return (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0].entrees as Entrees;
}
const effet = debutTest();
const echeance = finTest(effet);

const saisie = (code: string, e: Entrees): SaisieCotation => ({
  codeProduit: code,
  clientId: null,
  typeContrat: "INDIVIDUEL",
  souscripteur,
  dateEffet: effet,
  dateEcheance: echeance,
  nombreTranches: 1,
  lignes: [],
  motifForcage: null,
  assures: [],
  beneficiaires: [],
  contactsUrgence: [],
  risque: {},
  baremeBrut: brutDe(e),
});
const demande = (code: string, e: Entrees) => ({ codeProduit: code, typeContrat: "INDIVIDUEL", regimeTaxe: "INDIVIDUEL", dateEffet: effet, dateEcheance: echeance, nombreTranches: 1, baremeBrut: brutDe(e) });

const versionsDe = (code: string) => obtenirPrisma().produitVersion.findMany({ where: { produit: { code } }, orderBy: { dateEffet: "asc" } });
const baremesDe = (code: string) => obtenirPrisma().baremeDocument.findMany({ where: { version: { produit: { code } } }, orderBy: { id: "asc" } });
const dateDe = async (versionId: number) => depuisDate((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: versionId } })).dateEffet);

const versionFormule = (dateEffet: string, prime = "1000", extra: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet,
  modeTarification: "FORMULE",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: prime, accessoireMode: "AUCUN", accessoireValeur: "0" }],
  ...extra,
});
const versionGaranties = (dateEffet: string): VersionSaisie => ({ ...versionFormule(dateEffet), modeTarification: "GARANTIES", formules: [], garanties: [], garantiesSaisieLibre: true });

async function produitSimple(code: string) {
  await creerProduit(technique, { code, libelle: "Produit inventé (test D66)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
}

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
  branches = await creerBranchesFiscales(technique, CODE("V").slice(-8));
});

afterAll(async () => {
  try {
    await retablirSeuilGlobalDeTest();
  } finally {
    await obtenirPrisma().$disconnect();
  }
});

describe("D66 test 1 — correction d'un barème « dès la publication »", () => {
  it("pendant le brouillon la version précédente sert sans refus ; après la publication la nouvelle sert le jour même ; une cotation d'avant garde sa version", async () => {
    const code = CODE("SECURPRO_V1");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const date1 = ajouterJours(aujourdhui(), -10);
    const essai = await essaiDe(v1);

    // Une cotation créée AVANT la correction, soumise et émise avec la v1.
    const idAvant = await creerBrouillon(commercial, saisie(code, essai), null);
    expect((await soumettre(commercial, idAvant, null)).statut).toBe("EMISE");
    expect((await lireCotation(commercial, idAvant))!.versionDateEffet).toBe(date1);

    // Correction « dès la publication » : version au barème en préparation, barème copié en brouillon.
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, "", null);
    const prep = await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v2 } });
    expect(prep.modeTarification).toBe("BAREME");
    expect(depuisDate(prep.dateEffet)).toBe(DATE_EFFET_A_LA_PUBLICATION);
    expect((await baremesDe(code)).filter((b) => b.versionId === v2).map((b) => b.statut)).toEqual(["BROUILLON"]);

    // Pendant le brouillon : la v1 sert à tous les sites, sans refus.
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1);
    expect(await dateDeVersionPourCotation(obtenirPrisma(), code)).toBe(aujourdhui());
    await exigerModeCoherentEnVigueur(obtenirPrisma(), (await obtenirPrisma().produit.findUniqueOrThrow({ where: { code } })).id, aujourdhui(), { type: "COMPOSITION", version: 1, lignes: [{}], origine: "BAREME", bareme: { versionId: 1, empreinte: "x", saisie: { champs: {}, souscrit: [] } } } as never);
    const pendant = await calculerCotationBareme(commercial, demande(code, essai));
    expect(pendant.totaux.ttc).toBe("139420");
    const idPendant = await creerBrouillon(commercial, saisie(code, essai), null);
    expect((await lireCotation(commercial, idPendant))!.versionDateEffet).toBe(date1);

    // Publication : la v2 entre en vigueur aujourd'hui, dans la même transaction.
    const publication = await publierBaremeDetaille(technique, v2, "Correction de barème (test D66)", null);
    expect(publication.entreEnVigueurLe).toBe(aujourdhui());
    expect(await dateDe(v2)).toBe(aujourdhui());
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v2);
    const idApres = await creerBrouillon(commercial, saisie(code, essai), null);
    expect((await lireCotation(commercial, idApres))!.versionDateEffet).toBe(aujourdhui());

    // La cotation émise avant garde la v1 (T10).
    expect((await lireCotation(commercial, idAvant))!.versionDateEffet).toBe(date1);
    const publiees = (await baremesDe(code)).filter((b) => b.statut === "PUBLIE");
    expect(publiees).toHaveLength(2);
    expect(publiees[0].empreinte).toBe(publiees[1].empreinte); // copie non modifiée : même empreinte
  });
});

describe("D66 test 2 — une seule version par jour", () => {
  it("la publication « dès la publication » d'une seconde version le même jour est refusée, rien n'est écrit", async () => {
    const code = CODE("SECURPRO_V2");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 0); // v1 entre en vigueur AUJOURD'HUI
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, "", null);
    await expect(publierBareme(technique, v2, "Deuxième version du jour (test D66)", null)).rejects.toThrow(/Une seule version par jour.*demain ou plus tard/);
    expect(await dateDe(v2)).toBe(DATE_EFFET_A_LA_PUBLICATION);
    expect((await baremesDe(code)).filter((b) => b.versionId === v2).map((b) => b.statut)).toEqual(["BROUILLON"]);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1);
  });

  it("« Ajouter une version » dès la publication le même jour : refus, aucune version ni barème créés", async () => {
    const code = CODE("SECURPRO_V2B");
    await creerProduitAuBareme(technique, code, branches, 0);
    const [versionsAvant, baremesAvant] = [(await versionsDe(code)).length, (await baremesDe(code)).length];
    await expect(creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION, { dureeImposeeUnAn: true }), null, { motifPublication: "Durée imposée (test D66)" })).rejects.toThrow(/Une seule version par jour/);
    expect([(await versionsDe(code)).length, (await baremesDe(code)).length]).toEqual([versionsAvant, baremesAvant]);
  });
});

describe("D66 test 3 — ajouter une version en cochant la durée imposée", () => {
  it("version au barème, barème identique, échéance imposée (effet + 1 an − 1 jour), prorata 1, publiée aussitôt", async () => {
    const code = CODE("SECURPRO_V3");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const essai = await essaiDe(v1);
    // Motif obligatoire quand la version reprend un barème publié.
    await expect(creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION, { dureeImposeeUnAn: true }), null)).rejects.toThrow(/motif/i);
    expect(await versionsDe(code)).toHaveLength(1);

    const creee = await creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION, { dureeImposeeUnAn: true }), null, { motifPublication: "Durée imposée à un an (test D66)" });
    expect(creee).toMatchObject({ modeTarification: "BAREME", dateEffet: aujourdhui(), baremePublie: true });
    const v2 = await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: creee.versionId } });
    expect([v2.modeTarification, v2.dureeImposeeUnAn, v2.prorataActif]).toEqual(["BAREME", true, false]);
    const [b1, b2] = await Promise.all([lireBaremePublie(obtenirPrisma(), v1), lireBaremePublie(obtenirPrisma(), creee.versionId)]);
    expect(b2.empreinte).toBe(b1.empreinte);
    expect(lireBareme(b2.bareme)).toEqual(lireBareme(b1.bareme));

    // L'échéance reçue (fausse) est écrasée ; coefficient de prorata 1 ; même montant que l'essai annuel.
    const r = await calculerCotationBareme(commercial, { ...demande(code, essai), dateEcheance: ajouterJours(effet, 30) });
    expect(r.prorata).toEqual({ actif: false, jours: 365, coefficient: "1" });
    expect(r.totaux.ttc).toBe("139420");
    const id = await creerBrouillon(commercial, saisie(code, essai), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.dateEcheance).toBe(echeanceUnAn(effet));
    expect(c.versionDateEffet).toBe(aujourdhui());
  });
});

describe("D66 test 4 — essais rejoués avec les paramètres du formulaire", () => {
  it("un arrondi qui fait échouer un essai : refus avec l'écart, aucune version créée", async () => {
    const code = CODE("SECURPRO_V4");
    await creerProduitAuBareme(technique, code, branches, 10);
    const [versionsAvant, baremesAvant] = [(await versionsDe(code)).length, (await baremesDe(code)).length];
    const mauvais = versionAuBareme(DATE_EFFET_A_LA_PUBLICATION, { arrondi: { precision: 1000, sens: "SUPERIEUR", niveau: "LIGNE", composanteAbsorbante: "NETTE" } });
    const erreur = await creerVersion(technique, code, mauvais, null, { motifPublication: "Arrondi au millier (test D66)" }).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurPublicationBareme);
    expect((erreur as ErreurPublicationBareme).ecarts.length).toBeGreaterThan(0);
    expect([(await versionsDe(code)).length, (await baremesDe(code)).length]).toEqual([versionsAvant, baremesAvant]);
  });
});

describe("D66 test 5 — produit créé directement au barème", () => {
  it("première version « dès la publication » : non cotable avant la publication, cotée le jour même après, sans bascule", async () => {
    const code = CODE("SECURPRO_V5");
    await produitSimple(code);
    await creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
    const v = (await versionsDe(code))[0];
    expect(v.modeTarification).toBe("BAREME");
    // Pas de barème publié : aucune version ne sert.
    await expect(resoudreVersion(obtenirPrisma(), code, aujourdhui())).rejects.toThrow(/Aucun paramétrage/);
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(branches), null);
    await expect(resoudreVersion(obtenirPrisma(), code, aujourdhui())).rejects.toThrow(/Aucun paramétrage/);
    await publierBareme(technique, v.id, "Première version (test D66)", null);
    expect(await dateDe(v.id)).toBe(aujourdhui());
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v.id } })).modeTarification).toBe("BAREME"); // aucune bascule
    const essai = await essaiDe(v.id);
    expect((await calculerCotationBareme(commercial, demande(code, essai))).totaux.ttc).toBe("139420");
    const id = await creerBrouillon(commercial, saisie(code, essai), null);
    expect((await lireCotation(commercial, id))!.versionDateEffet).toBe(aujourdhui());
  });
});

describe("D66 test 6 — date future (comportement actuel conservé)", () => {
  const futur = ajouterJours(aujourdhui(), 20);

  it("la version préparée à une date future garde sa date à la publication et ne sert qu'à partir de cette date", async () => {
    const code = CODE("SECURPRO_V6");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, futur, null);
    expect(await dateDe(v2)).toBe(futur);
    const publication = await publierBaremeDetaille(technique, v2, "Version future (test D66)", null);
    expect(publication.entreEnVigueurLe).toBeNull();
    expect(await dateDe(v2)).toBe(futur);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1);
    expect((await resoudreVersion(obtenirPrisma(), code, futur)).version.id).toBe(v2);
  });

  it("« Ajouter une version » à une date future reprend le barème et se publie aussitôt ; une date passée ou du jour est refusée pour une version au barème", async () => {
    const code = CODE("SECURPRO_V6B");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const creee = await creerVersion(technique, code, versionAuBareme(futur), null, { motifPublication: "Version future (test D66)" });
    expect(creee).toMatchObject({ dateEffet: futur, baremePublie: true });
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1);
    await expect(creerVersion(technique, code, versionAuBareme(ajouterJours(aujourdhui(), -3)), null, { motifPublication: "Passé" })).rejects.toThrow(/dès la publication|postérieure/);
  });

  it("une version future jamais publiée n'est retenue par aucun site, même quand sa date arrive ; sa publication tardive est refusée", async () => {
    const code = CODE("SECURPRO_V6C");
    await produitSimple(code);
    await creerVersion(technique, code, versionAuBareme(futur), null);
    const v = (await versionsDe(code))[0];
    await dateDeVersion(v.id, ajouterJours(aujourdhui(), -1)); // sa date prévue est passée, son barème n'est pas publié
    await expect(resoudreVersion(obtenirPrisma(), code, aujourdhui())).rejects.toThrow(/Aucun paramétrage/);
    expect(await dateDeVersionPourCotation(obtenirPrisma(), code)).toBe(aujourdhui());
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(branches), null);
    await expect(publierBareme(technique, v.id, "Trop tard (test D66)", null)).rejects.toThrow(/est passée/);
  });
});

describe("D66 test 7 — le mode est figé par produit", () => {
  const refus = /figé par produit/;

  it("un produit par formules refuse GARANTIES et BAREME, même envoyés à la main", async () => {
    const code = CODE("FORM");
    await produitSimple(code);
    await creerVersion(technique, code, versionFormule("2020-01-01"), null);
    await expect(creerVersion(technique, code, versionGaranties(debutTest()), null)).rejects.toThrow(refus);
    await expect(creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null)).rejects.toThrow(refus);
    await expect(creerVersion(technique, code, versionAuBareme(debutTest()), null)).rejects.toThrow(refus);
    expect(await versionsDe(code)).toHaveLength(1);
    // Le mode absent de la demande prend celui de la précédente ; FORMULE explicite passe.
    await creerVersion(technique, code, { ...versionFormule(ajouterJours(aujourdhui(), 5), "1100"), modeTarification: undefined }, null);
    await creerVersion(technique, code, { ...versionFormule(ajouterJours(aujourdhui(), 9), "1200"), modeTarification: "FORMULE" }, null);
    expect((await versionsDe(code)).map((v) => v.modeTarification)).toEqual(["FORMULE", "FORMULE", "FORMULE"]);
  });

  it("un produit par garanties refuse FORMULE et BAREME ; l'omission du mode garde GARANTIES (sans formule)", async () => {
    const code = CODE("GARA");
    await produitSimple(code);
    await creerVersion(technique, code, versionGaranties("2020-01-01"), null);
    await expect(creerVersion(technique, code, versionFormule(debutTest()), null)).rejects.toThrow(refus);
    await expect(creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null)).rejects.toThrow(refus);
    await creerVersion(technique, code, { ...versionGaranties(debutTest()), modeTarification: undefined }, null);
    expect((await versionsDe(code)).map((v) => v.modeTarification)).toEqual(["GARANTIES", "GARANTIES"]);
  });

  it("un produit au barème refuse FORMULE et GARANTIES", async () => {
    const code = CODE("BARE");
    await creerProduitAuBareme(technique, code, branches, 10);
    await expect(creerVersion(technique, code, versionFormule(debutTest()), null)).rejects.toThrow(refus);
    await expect(creerVersion(technique, code, versionGaranties(debutTest()), null)).rejects.toThrow(refus);
    expect(await versionsDe(code)).toHaveLength(1);
  });

  it("la première version choisit le mode : les trois sont possibles", async () => {
    for (const [mode, version] of [
      ["FORMULE", versionFormule("2020-01-01")],
      ["GARANTIES", versionGaranties("2020-01-01")],
      ["BAREME", versionAuBareme(DATE_EFFET_A_LA_PUBLICATION)],
    ] as const) {
      const code = CODE(`PREM_${mode}`);
      await produitSimple(code);
      await creerVersion(technique, code, version, null);
      expect((await versionsDe(code))[0].modeTarification).toBe(mode);
    }
  });
});

describe("D66 test 8 — version par formules datée d'aujourd'hui", () => {
  it("elle est acceptée et sert le jour même", async () => {
    const code = CODE("FORM_JOUR");
    await produitSimple(code);
    await creerVersion(technique, code, versionFormule("2020-01-01", "1000"), null);
    await creerVersion(technique, code, versionFormule(aujourdhui(), "2000"), null);
    const r = await calculerPourProduit(technique, { codeProduit: code, dateEffet: effet, dateEcheance: echeance, regimeTaxe: "INDIVIDUEL", lignes: [{ codeFormule: "SOLO", effectif: 1 }] });
    expect(r.versionDu).toBe(aujourdhui());
    expect(r.resultat.totaux.arrondi.nette.toFixed()).toBe("2000");
  });

  it("une version par garanties datée d'aujourd'hui est acceptée et sert le jour même", async () => {
    const code = CODE("GARA_JOUR");
    await produitSimple(code);
    await creerVersion(technique, code, versionGaranties(aujourdhui()), null);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.modeTarification).toBe("GARANTIES");
  });
});

describe("D66 test 9 — non-régression : version provisoire d'avant D66", () => {
  it("une version « Par garanties » à date future reçoit un barème et se bascule toujours au barème", async () => {
    const code = CODE("H140");
    await produitSimple(code);
    const futur = ajouterJours(aujourdhui(), 30);
    await creerVersion(technique, code, versionGaranties(futur), null);
    const v = (await versionsDe(code))[0];
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(branches), null);
    await expect(basculerVersionAuBareme(technique, v.id, null)).rejects.toThrow(/Aucun barème publié/);
    const publication = await publierBaremeDetaille(technique, v.id, "Barème de la version provisoire (test D66)", null);
    expect(publication.entreEnVigueurLe).toBeNull(); // le mode n'est pas BAREME : la date ne bouge pas
    expect(await dateDe(v.id)).toBe(futur);
    await basculerVersionAuBareme(technique, v.id, null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v.id } })).modeTarification).toBe("BAREME");
  });

  it("historique mêlé : « Ajouter une version » garde le mode précédent ; seule exception, creerVersionDepuisBareme (copie d'un barème PUBLIÉ du même produit) ramène au barème pour réparer une version « Par garanties » créée par erreur, sans toucher aux versions existantes", async () => {
    const code = CODE("MIXTE");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    // Historique d'avant D66 : une version provisoire « Par garanties » créée en SQL (la base l'admet encore), en vigueur aujourd'hui.
    const idProduit = (await obtenirPrisma().produit.findUniqueOrThrow({ where: { code } })).id;
    await obtenirPrisma().$executeRawUnsafe(
      `INSERT INTO produit_versions (produit_id, date_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, mode_tarification, cree_par) VALUES (${idProduit}, DATE '${aujourdhui()}', 1, 'PROCHE', 'LIGNE', 'NETTE', false, 'GARANTIES', 'test')`,
    );
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.modeTarification).toBe("GARANTIES");
    // Réparation : correction du barème publié de la v1, entrée en vigueur demain (aujourd'hui est pris par la version provisoire).
    const demain = ajouterJours(aujourdhui(), 1);
    const { versionId: v3 } = await creerVersionDepuisBareme(technique, v1, demain, null);
    await publierBareme(technique, v3, "Retour au barème (test D66)", null);
    expect((await resoudreVersion(obtenirPrisma(), code, demain)).version.id).toBe(v3);
    expect((await versionsDe(code)).map((v) => v.modeTarification)).toEqual(["BAREME", "GARANTIES", "BAREME"]);
  });
});

describe("D66 — la version en préparation est écartée par le domaine", () => {
  it("enVigueur ignore une version en préparation, même antérieure à la date demandée", () => {
    const v = [
      { dateEffet: "2026-01-01", enPreparation: false, id: 1 },
      { dateEffet: "2026-06-01", enPreparation: true, id: 2 },
    ];
    expect(enVigueur(v, "2026-07-01")?.id).toBe(1);
    expect(enVigueur([{ dateEffet: "2026-06-01", enPreparation: true }], "2026-07-01")).toBeNull();
  });
});

describe("D66 relecture — la date provisoire 9999-12-31 ne sort nulle part", () => {
  const vide = { champs: {}, souscrit: [] } as Entrees;

  it("2a. produit NEUF au barème, version « dès la publication » en préparation : aucune date en 9999 proposée, aucun calcul ; après publication, cotation le jour même", async () => {
    const code = CODE("NEUF");
    await produitSimple(code);
    await creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
    // Les écrans de cotation : produit non proposé, date et version calculées comme le font « Nouvelle cotation » et « Modifier ».
    expect((await listerProduits(technique)).find((p) => p.code === code)!.versions).toEqual([]);
    const avant = (await listerVersions(technique, code))!;
    expect(avant.versions).toHaveLength(1);
    expect(avant.versions[0].enPreparation).toBe(true);
    expect(avant.produit.versions).toEqual([]);
    const { dateVersion, version } = versionPourCotation(avant.versions, aujourdhui());
    expect(dateVersion).toBe(aujourdhui());
    expect(dateVersion.startsWith("9999")).toBe(false);
    expect(version).toBeNull();
    await expect(calculerCotationBareme(commercial, demande(code, vide))).rejects.toThrow(/Aucun paramétrage/);
    // L'écran « Ajouter une version » : le mode est celui de la version en préparation.
    expect(baseDeNouvelleVersion(avant.versions).mode).toBe("BAREME");

    const v = avant.versions[0];
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(branches), null);
    await publierBareme(technique, v.id, "Produit neuf (test D66)", null);
    const apres = (await listerVersions(technique, code))!;
    const choisie = versionPourCotation(apres.versions, aujourdhui());
    expect([choisie.dateVersion, choisie.version?.id, choisie.version?.dateEffet]).toEqual([aujourdhui(), v.id, aujourdhui()]);
    const essai = await essaiDe(v.id);
    expect((await calculerCotationBareme(commercial, demande(code, essai))).totaux.ttc).toBe("139420");
    expect((await lireCotation(commercial, await creerBrouillon(commercial, saisie(code, essai), null)))!.versionDateEffet).toBe(aujourdhui());
  });

  it("2b. « Ajouter une version » pendant qu'une version est en préparation : mode de la plus récente, valeurs de la dernière retenue ; la préparation n'est pas touchée", async () => {
    const code = CODE("PENDANT");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, "", null); // en préparation, avec son brouillon
    const { versions } = (await listerVersions(technique, code))!;
    expect(versions.map((v) => v.id)).toEqual([v2, v1]); // la préparation est la plus récente par date
    const { base, mode } = baseDeNouvelleVersion(versions);
    expect([base!.id, mode]).toEqual([v1, "BAREME"]);

    // Le service suit la même règle : le mode est celui de la plus récente (BAREME), un autre est refusé.
    await expect(creerVersion(technique, code, versionFormule(debutTest()), null)).rejects.toThrow(/figé par produit/);
    // « Dès la publication » est déjà pris par la préparation ; une date future passe, reprend le barème de la v1 et se publie.
    await expect(creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null, { motifPublication: "Doublon" })).rejects.toThrow(/déjà en préparation/);
    const futur = ajouterJours(aujourdhui(), 25);
    const creee = await creerVersion(technique, code, versionAuBareme(futur, { dureeImposeeUnAn: true }), null, { motifPublication: "Durée imposée (test D66)" });
    expect(creee).toMatchObject({ dateEffet: futur, baremePublie: true });
    expect(await dateDe(v2)).toBe(DATE_EFFET_A_LA_PUBLICATION); // la préparation n'a pas bougé
    expect((await baremesDe(code)).filter((b) => b.versionId === v2).map((b) => b.statut)).toEqual(["BROUILLON"]);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1);
  });

  it("2b bis. la correction d'un barème prend les paramètres de la dernière version RETENUE, pas ceux d'une version en préparation", async () => {
    const code = CODE("PARAMS");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, "", null);
    // La préparation porte un réglage de travail (durée imposée) ; on retire son brouillon pour pouvoir créer une autre correction.
    await obtenirPrisma().$executeRawUnsafe(`UPDATE produit_versions SET duree_imposee_un_an = true WHERE id = ${v2}`);
    await obtenirPrisma().$executeRawUnsafe(`DELETE FROM bareme_documents WHERE version_id = ${v2}`);
    const { versionId: v3 } = await creerVersionDepuisBareme(technique, v1, ajouterJours(aujourdhui(), 30), null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v3 } })).dureeImposeeUnAn).toBe(false); // celui de la v1, retenue
  });

  it("2c. les essais rejoués (brouillon, contrôle, publication) lisent la taxe en vigueur AUJOURD'HUI, pas au 31/12/9999", async () => {
    // Branches dont le taux change en 2100 : un essai lu à une date lointaine ne retomberait plus sur 139 420 F.
    const suffixe = CODE("TX").slice(-8);
    const incendie = `INC_${suffixe}`;
    const iard = `IARD_${suffixe}`;
    for (const [branche, juste, piege] of [[incendie, "12.5", "40"], [iard, "7.25", "50"]] as const) {
      await assurerBranche(branche);
      await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: juste, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: "2099-12-31" }, null);
      await creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: piege, assiette: "NETTE_ACCESSOIRES", dateEffet: "2100-01-01", dateFin: null }, null);
    }
    expect((await taxeEnVigueur(obtenirPrisma(), iard, "INDIVIDUEL", DATE_EFFET_A_LA_PUBLICATION)).tauxPourcent).toBe("50"); // le piège existe bien
    const brs = { incendie, iard };
    const code = CODE("SECURPRO_TX");
    await creerProduit(technique, { code, libelle: "Sécur Pro (inventé, taxes D66)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: iard }, null);
    await creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
    const v = (await versionsDe(code))[0];
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(brs), null);
    expect(await rejouerLesEssaisBareme(technique, v.id)).toEqual([]);
    const controles = await controlerAvantPublication(technique, v.id);
    expect(controles.ecarts).toEqual([]);
    await publierBareme(technique, v.id, "Taxes lues à la date du jour (test D66)", null);
    expect(await dateDe(v.id)).toBe(aujourdhui());
  });

  it("3. version en préparation dont la date future est passée, sans barème publié : la cotation se calcule avec la version précédente, sans refus", async () => {
    const code = CODE("DEPASSEE");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code, branches, 10);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, ajouterJours(aujourdhui(), 20), null);
    await dateDeVersion(v2, ajouterJours(aujourdhui(), -2)); // la date prévue est atteinte, le barème n'est pas publié
    const essai = await essaiDe(v1);
    expect((await resoudreVersion(obtenirPrisma(), code, aujourdhui())).version.id).toBe(v1);
    expect(await dateDeVersionPourCotation(obtenirPrisma(), code)).toBe(aujourdhui());
    const { versions } = (await listerVersions(technique, code))!;
    expect(versionPourCotation(versions, aujourdhui()).version?.id).toBe(v1);
    expect((await calculerCotationBareme(commercial, demande(code, essai))).totaux.ttc).toBe("139420");
    const id = await creerBrouillon(commercial, saisie(code, essai), null);
    expect((await lireCotation(commercial, id))!.versionDateEffet).toBe(ajouterJours(aujourdhui(), -10));
    expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
  });
});

describe("D66, H212 — un barème ne se crée que sur une version déjà au barème", () => {
  const refus = /n'est pas tarifée au barème.*nouveau produit/;

  it("produits PAR FORMULES et PAR GARANTIES, version à date future : barème vide et import refusés avec un message clair, rien n'est écrit", async () => {
    const classeur = await construireClasseur(baremeAuxBranches(branches), { titre: "Import refusé (test H212)" });
    for (const [mode, version] of [
      ["FORMULE", versionFormule(ajouterJours(aujourdhui(), 30))],
      ["GARANTIES", { ...versionGaranties(ajouterJours(aujourdhui(), 30)) }],
    ] as const) {
      const code = CODE(`H212_${mode}`);
      await produitSimple(code);
      await creerVersion(technique, code, mode === "FORMULE" ? versionFormule("2020-01-01") : versionGaranties("2020-01-01"), null);
      await creerVersion(technique, code, version, null);
      const futur = (await versionsDe(code)).find((v) => depuisDate(v.dateEffet) > aujourdhui())!;
      await expect(creerBaremeVide(technique, futur.id, null), mode).rejects.toThrow(refus);
      await expect(importerBaremeXlsx(technique, futur.id, "securpro.xlsx", classeur, null), mode).rejects.toThrow(refus);
      expect(await baremesDe(code), mode).toHaveLength(0);
    }
  });

  it("produit AU BARÈME : barème vide et import restent possibles (inchangé)", async () => {
    const classeur = await construireClasseur(baremeAuxBranches(branches), { titre: "Import (test H212)" });
    const a = CODE("H212_BAREME_A");
    await produitSimple(a);
    await creerVersion(technique, a, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
    const va = (await versionsDe(a))[0];
    await expect(creerBaremeVide(technique, va.id, null)).resolves.toMatchObject({ id: expect.any(Number) });
    const b = CODE("H212_BAREME_B");
    await produitSimple(b);
    await creerVersion(technique, b, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
    const vb = (await versionsDe(b))[0];
    await expect(importerBaremeXlsx(technique, vb.id, "securpro.xlsx", classeur, null)).resolves.toMatchObject({ id: expect.any(Number) });
  });

  it("version provisoire d'avant D66 avec brouillon : toujours modifiable, publiable et basculable ; la réparation à partir d'un barème PUBLIÉ reste permise", async () => {
    const code = CODE("H212_H140");
    await produitSimple(code);
    await creerVersion(technique, code, versionGaranties(ajouterJours(aujourdhui(), 30)), null);
    const v = (await versionsDe(code))[0];
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(branches), null); // le brouillon existe (donnée d'avant D66)
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(branches), null); // modifiable
    await publierBareme(technique, v.id, "Barème de la version provisoire (test H212)", null);
    await basculerVersionAuBareme(technique, v.id, null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: v.id } })).modeTarification).toBe("BAREME");
    // Réparation : une version « Par garanties » créée par erreur sur un produit qui a un barème publié (donnée posée comme avant D66).
    const code2 = CODE("H212_REPARE");
    const { versionId: v1 } = await creerProduitAuBareme(technique, code2, branches, 10);
    await ajouterVersionHeritee(technique, code2, versionGaranties(aujourdhui()));
    const repare = await creerVersionDepuisBareme(technique, v1, ajouterJours(aujourdhui(), 1), null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: repare.versionId } })).modeTarification).toBe("BAREME");
  });
});
