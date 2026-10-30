import { beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "./branches-test";
import { creerBrouillon, type SaisieCotation } from "./cotations";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { tableauAdmin } from "./tableau-admin";
import { tableauCommercial } from "./tableau-commercial";
import { tableauComptabilite } from "./tableau-comptabilite";
import { tableauDirectionGenerale } from "./tableau-dg";
import { tableauProduction } from "./tableau-production";
import { tableauTechnique } from "./tableau-technique";
import {
  tableauAdminMemorise,
  tableauCommercialMemorise,
  tableauComptabiliteMemorise,
  tableauDGMemorise,
  tableauProductionMemorise,
  tableauTechniqueMemorise,
  viderMemoireTableaux,
} from "./tableaux-memorises";
import { ErreurAcces, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

// Tableaux de bord par profil : chacun refuse seul, par la matrice des droits (D4), et non par le nom du profil.

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

type Profil = "COMMERCIAL" | "TECHNIQUE" | "COMPTABILITE" | "DIRECTION_GENERALE" | "GESTIONNAIRE_PRODUCTION" | "ADMIN_SYSTEME";

let admin: UtilisateurCourant;
const comptes = {} as Record<Profil, UtilisateurCourant>;
let commercial2: UtilisateurCourant;
let codeProduit: string;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

const version = (): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [{ code: "F1", libelle: "Formule 1", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" }],
});

const souscripteur: Souscripteur = { type: "PHYSIQUE", nom: "TABLEAU", prenoms: "Jean", raison_sociale: "", telephone: "0102030405", email: "t@example.com", adresse: "Abidjan" };

const saisie = (): SaisieCotation => ({
  codeProduit,
  clientId: null,
  typeContrat: "INDIVIDUEL",
  souscripteur,
  dateEffet: "2026-06-01",
  dateEcheance: "2027-05-31",
  nombreTranches: 1,
  lignes: [{ codeFormule: "F1", effectif: 1 }],
  motifForcage: null,
  assures: [],
  beneficiaires: null,
  contactsUrgence: null,
  risque: {},
});

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  admin = await compte(idAdmin);
  for (const p of ["COMMERCIAL", "TECHNIQUE", "COMPTABILITE", "DIRECTION_GENERALE", "GESTIONNAIRE_PRODUCTION", "ADMIN_SYSTEME"] as const) comptes[p] = await nouveauCompte(p);
  commercial2 = await nouveauCompte("COMMERCIAL");

  const branche = await assurerBranche(unique("TAB").toUpperCase().replace(/-/g, "_"));
  await creerTaxe(comptes.TECHNIQUE, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "0", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  codeProduit = unique("TAB").toUpperCase().replace(/-/g, "_");
  await creerProduit(comptes.TECHNIQUE, { code: codeProduit, libelle: "Produit tableaux", gamme: "SANTE", branche, branchePrincipale: "MALADIE" }, null);
  await creerVersion(comptes.TECHNIQUE, codeProduit, version(), null);
});

const TABLEAUX: {
  nom: string;
  direct: (a: UtilisateurCourant) => Promise<unknown>;
  memorise: (a: UtilisateurCourant) => Promise<unknown>;
  autorise: Profil;
  /** Un profil dont la matrice ne donne pas le droit de ce tableau. */
  refuse: Profil;
}[] = [
  { nom: "commercial", direct: (a) => tableauCommercial(a), memorise: (a) => tableauCommercialMemorise(a), autorise: "COMMERCIAL", refuse: "COMPTABILITE" },
  { nom: "technique", direct: (a) => tableauTechnique(a), memorise: (a) => tableauTechniqueMemorise(a), autorise: "TECHNIQUE", refuse: "COMMERCIAL" },
  { nom: "comptabilité", direct: (a) => tableauComptabilite(a), memorise: (a) => tableauComptabiliteMemorise(a), autorise: "COMPTABILITE", refuse: "COMMERCIAL" },
  { nom: "direction générale", direct: (a) => tableauDirectionGenerale(a), memorise: (a) => tableauDGMemorise(a), autorise: "DIRECTION_GENERALE", refuse: "COMMERCIAL" },
  { nom: "production", direct: (a) => tableauProduction(a), memorise: (a) => tableauProductionMemorise(a), autorise: "GESTIONNAIRE_PRODUCTION", refuse: "COMMERCIAL" },
  { nom: "admin système", direct: (a) => tableauAdmin(a), memorise: (a) => tableauAdminMemorise(a), autorise: "ADMIN_SYSTEME", refuse: "COMMERCIAL" },
];

describe("tableaux de bord par profil : le serveur refuse seul (D4)", () => {
  for (const t of TABLEAUX) {
    it(`${t.nom} : le profil autorisé lit, un profil sans le droit est refusé (fonction directe et version mémorisée)`, async () => {
      viderMemoireTableaux();
      await expect(t.direct(comptes[t.autorise])).resolves.toBeDefined();
      await expect(t.memorise(comptes[t.autorise])).resolves.toBeDefined();
      // La mémoire est remplie : elle ne contourne pas le droit.
      await expect(t.direct(comptes[t.refuse])).rejects.toBeInstanceOf(ErreurAcces);
      await expect(t.memorise(comptes[t.refuse])).rejects.toBeInstanceOf(ErreurAcces);
    });
  }

  it("le droit vient de la matrice, pas du nom du profil : le droit retiré à la Technique la fait refuser", async () => {
    const prisma = obtenirPrisma();
    const profil = await prisma.profil.findUniqueOrThrow({ where: { code: "TECHNIQUE" } });
    const cle = { profilId_action: { profilId: profil.id, action: "CONSULTER_TABLEAUX_DE_BORD" } };
    const avant = await prisma.profilDroit.findUnique({ where: cle });
    try {
      await prisma.profilDroit.upsert({ where: cle, update: { niveau: "AUCUN" }, create: { profilId: profil.id, action: "CONSULTER_TABLEAUX_DE_BORD", niveau: "AUCUN" } });
      viderMemoireTableaux();
      await expect(tableauTechnique(comptes.TECHNIQUE)).rejects.toBeInstanceOf(ErreurAcces);
      await expect(tableauTechniqueMemorise(comptes.TECHNIQUE)).rejects.toBeInstanceOf(ErreurAcces);
    } finally {
      await prisma.profilDroit.update({ where: cle, data: { niveau: avant?.niveau ?? "LECTURE" } });
      viderMemoireTableaux();
    }
  });

  it("le tableau du commercial ne montre que ses propres cotations", async () => {
    viderMemoireTableaux();
    await creerBrouillon(comptes.COMMERCIAL, saisie(), null);
    await creerBrouillon(comptes.COMMERCIAL, saisie(), null);
    await creerBrouillon(commercial2, saisie(), null);

    expect((await tableauCommercial(comptes.COMMERCIAL)).cotations.parStatut.BROUILLON).toBe(2);
    expect((await tableauCommercial(commercial2)).cotations.parStatut.BROUILLON).toBe(1);
    // La version mémorisée est propre à chaque commercial.
    expect((await tableauCommercialMemorise(comptes.COMMERCIAL)).cotations.parStatut.BROUILLON).toBe(2);
    expect((await tableauCommercialMemorise(commercial2)).cotations.parStatut.BROUILLON).toBe(1);
  });
});
