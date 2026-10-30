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
import { DROITS_TABLEAUX } from "./tableaux-de-bord";
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
  cle: keyof typeof DROITS_TABLEAUX;
  direct: (a: UtilisateurCourant) => Promise<unknown>;
  memorise: (a: UtilisateurCourant) => Promise<unknown>;
  autorise: Profil;
  /** Un profil dont la matrice ne donne pas le droit de ce tableau. */
  refuse: Profil;
}[] = [
  { nom: "commercial", cle: "commercial", direct: (a) => tableauCommercial(a), memorise: (a) => tableauCommercialMemorise(a), autorise: "COMMERCIAL", refuse: "COMPTABILITE" },
  { nom: "technique", cle: "technique", direct: (a) => tableauTechnique(a), memorise: (a) => tableauTechniqueMemorise(a), autorise: "TECHNIQUE", refuse: "COMMERCIAL" },
  { nom: "comptabilité", cle: "comptabilite", direct: (a) => tableauComptabilite(a), memorise: (a) => tableauComptabiliteMemorise(a), autorise: "COMPTABILITE", refuse: "COMMERCIAL" },
  { nom: "direction générale", cle: "direction", direct: (a) => tableauDirectionGenerale(a), memorise: (a) => tableauDGMemorise(a), autorise: "DIRECTION_GENERALE", refuse: "COMMERCIAL" },
  { nom: "production", cle: "production", direct: (a) => tableauProduction(a), memorise: (a) => tableauProductionMemorise(a), autorise: "GESTIONNAIRE_PRODUCTION", refuse: "COMMERCIAL" },
  { nom: "admin système", cle: "admin", direct: (a) => tableauAdmin(a), memorise: (a) => tableauAdminMemorise(a), autorise: "ADMIN_SYSTEME", refuse: "COMMERCIAL" },
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

  for (const t of TABLEAUX) {
    it(`${t.nom} : retirer un droit associé dans la matrice fait refuser le profil, le remettre le fait voir`, async () => {
      const prisma = obtenirPrisma();
      const acteur = comptes[t.autorise];
      const profil = await prisma.profil.findUniqueOrThrow({ where: { code: acteur.profil } });
      for (const action of DROITS_TABLEAUX[t.cle].actions) {
        const cle = { profilId_action: { profilId: profil.id, action } };
        const avant = await prisma.profilDroit.findUnique({ where: cle });
        try {
          viderMemoireTableaux();
          await expect(t.direct(acteur)).resolves.toBeDefined();
          await prisma.profilDroit.upsert({ where: cle, update: { niveau: "AUCUN" }, create: { profilId: profil.id, action, niveau: "AUCUN" } });
          await expect(t.direct(acteur)).rejects.toBeInstanceOf(ErreurAcces);
          await expect(t.memorise(acteur)).rejects.toBeInstanceOf(ErreurAcces);
        } finally {
          if (avant) await prisma.profilDroit.update({ where: cle, data: { niveau: avant.niveau } });
          else await prisma.profilDroit.delete({ where: cle }).catch(() => undefined);
          viderMemoireTableaux();
        }
        await expect(t.direct(acteur)).resolves.toBeDefined();
        await expect(t.memorise(acteur)).resolves.toBeDefined();
      }
    });
  }

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
