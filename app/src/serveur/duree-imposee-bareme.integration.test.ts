// D64 : durée imposée sur un produit AU BARÈME (SECURPRO inventé). Effet quelconque -> échéance imposée, coefficient de prorata 1,
// montant = celui de l'essai annuel (139 420 F), y compris sur une période qui contient un 29 février. Données inventées.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lireBareme, type Bareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import { ecartEnJours, fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "./branches-test";
import { basculerVersionAuBareme, lireBaremePublie, publierBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { importerBaremeXlsx } from "./bareme-excel";
import { calculerCotationBareme, creerBrouillon, lireCotation, modifierBrouillon, type SaisieCotation } from "./cotations";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = unique("SECURPRO_DI").toUpperCase().replace(/-/g, "_");

let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;
let INCENDIE: string;
let IARD: string;
let versionId: number;

const souscripteur: Souscripteur = { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ATELIERS DU LAGON SARL (inventée)", telephone: "0700000000", email: "contact@ateliers-lagon.exemple.ci", adresse: "Zone industrielle, Abidjan" };
const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

function baremeAuxBranches(): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return lireBareme(d);
}

type Entrees = { champs: Record<string, string | boolean | string[]>; souscrit: string[]; effectif?: number };
const brutDe = (e: Entrees) => ({
  champs: Object.fromEntries(Object.entries(e.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
  souscrit: e.souscrit,
  ...(e.effectif !== undefined ? { effectif: String(e.effectif) } : {}),
});
let essai: Entrees;

const saisie = (dateEffet: string, dateEcheance: string): SaisieCotation => ({
  codeProduit: CODE,
  clientId: null,
  typeContrat: "INDIVIDUEL",
  souscripteur,
  dateEffet,
  dateEcheance,
  nombreTranches: 1,
  lignes: [],
  motifForcage: null,
  assures: [],
  beneficiaires: [],
  contactsUrgence: [],
  risque: {},
  baremeBrut: brutDe(essai),
});
const demande = (dateEffet: string, dateEcheance: string) => ({ codeProduit: CODE, typeContrat: "INDIVIDUEL", regimeTaxe: "INDIVIDUEL", dateEffet, dateEcheance, nombreTranches: 1, baremeBrut: brutDe(essai) });

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
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
  INCENDIE = `INC_${CODE.slice(-8)}`;
  IARD = `IARD_${CODE.slice(-8)}`;
  await assurerBranche(INCENDIE);
  await assurerBranche(IARD);
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code: CODE, libelle: "Sécur Pro, durée imposée (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  // Une version ne naît pas au barème (D50) : version « Par garanties » à durée imposée, barème importé, publié, bascule, mise en vigueur pour le test.
  await creerVersion(
    technique,
    CODE,
    {
      dateEffet: "2099-01-01",
      modeTarification: "GARANTIES",
      dureeImposeeUnAn: true,
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
      prorata: { actif: false, primeMinimale: null },
      fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: null,
      formules: [],
      garantiesSaisieLibre: true,
      garanties: [],
      references: { csModeleCode: null, csVisa: null },
    } satisfies VersionSaisie,
    null,
  );
  versionId = (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code: CODE } } })).id;
  await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await construireClasseur(baremeAuxBranches(), { titre: "SECURPRO inventé (test D64)" }), null);
  await publierBareme(technique, versionId, "Barème SECURPRO inventé (test D64)", null);
  await basculerVersionAuBareme(technique, versionId, null);
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe(`UPDATE produit_versions SET date_effet = DATE '2020-01-01' WHERE id = ${versionId}`);
  });
  const jeu = (await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai[0];
  expect(jeu.attendu.ttc).toBe("139420");
  essai = jeu.entrees as Entrees;
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  await obtenirPrisma().$disconnect();
});

// [effet, échéance attendue, jours inclus] : effet quelconque, année bissextile traversée, effet au 29 février.
const CAS: [string, string, number][] = [
  ["2026-11-05", "2027-11-04", 365],
  ["2027-03-01", "2028-02-29", 366],
  ["2027-09-01", "2028-08-31", 366], // la période contient le 29/02/2028
  ["2028-02-29", "2029-02-28", 366], // effet au 29 février : le même jour de l'année suivante est le 01/03
];

describe("D64 : durée imposée au barème (SECURPRO inventé)", () => {
  for (const [effet, echeance, jours] of CAS) {
    it(`effet ${effet} : échéance ${echeance}, coefficient de prorata 1, 139 420 F comme l'essai annuel`, async () => {
      expect(ecartEnJours(effet, echeance) + 1).toBe(jours);
      // Calcul automatique, avec une échéance reçue volontairement fausse.
      const r = await calculerCotationBareme(commercial, demande(effet, "2026-12-01"));
      expect(r.prorata).toEqual({ actif: false, jours, coefficient: "1" });
      expect(r.totaux).toEqual({ nette: "113851", accessoires: "15000", taxe: "10569", ttc: "139420" });
      // Enregistrement : même échéance, mêmes montants, écrits avec la cotation.
      const id = await creerBrouillon(commercial, saisie(effet, "2026-12-01"), null);
      const c = (await lireCotation(commercial, id))!;
      expect([c.dateEffet, c.dateEcheance]).toEqual([effet, echeance]);
      expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("139420");
      // Modification : l'échéance ne se change pas à la main.
      await modifierBrouillon(commercial, id, saisie(effet, "2030-01-01"), null);
      expect((await lireCotation(commercial, id))!.dateEcheance).toBe(echeance);
    });
  }
});
