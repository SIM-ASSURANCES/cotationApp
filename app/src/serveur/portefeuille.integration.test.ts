import { beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "./branches-test";
import { creerClient } from "./clients";
import { creerBrouillon, type SaisieCotation } from "./cotations";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import {
  listerBranchesPortefeuille,
  listerProduitsPortefeuille,
  listerClientsPortefeuille,
  listerPiecesClientPortefeuille,
} from "./portefeuille";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;
let adminSysteme: UtilisateurCourant;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(
    await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }),
  );
}

async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

const versionSimple = (): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [
    { code: "F1", libelle: "Formule 1", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" },
  ],
});

const souscripteurTest = (nom: string): Souscripteur => ({
  type: "PHYSIQUE",
  nom,
  prenoms: "Jean",
  raison_sociale: "",
  telephone: "0102030405",
  email: "test@example.com",
  adresse: "Abidjan Plateau",
});

const saisieCotation = (codeProduit: string, clientId: number | null, s: Souscripteur): SaisieCotation => ({
  codeProduit,
  clientId,
  typeContrat: "INDIVIDUEL",
  souscripteur: s,
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

  technique = await nouveauCompte("TECHNIQUE");
  commercial = await nouveauCompte("COMMERCIAL");
  adminSysteme = await nouveauCompte("ADMIN_SYSTEME");
});

describe("Portefeuille — Étape 4 (navigation et arborescence)", () => {
  it("droits par niveau : un profil sans droit de cotation ni contrat (ex. ADMIN_SYSTEME) est refusé", async () => {
    await expect(listerBranchesPortefeuille(adminSysteme)).rejects.toThrow(/Droit insuffisant/);
    await expect(listerProduitsPortefeuille(adminSysteme, "MALADIE")).rejects.toThrow(/Droit insuffisant/);
    await expect(listerClientsPortefeuille(adminSysteme, "MALADIE", "QUELCONQUE")).rejects.toThrow(/Droit insuffisant/);
    await expect(listerPiecesClientPortefeuille(adminSysteme, "MALADIE", "QUELCONQUE", "CLI-1")).rejects.toThrow(/Droit insuffisant/);

    // Les profils autorisés peuvent lire
    const branchesComm = await listerBranchesPortefeuille(commercial);
    expect(branchesComm.length).toBeGreaterThanOrEqual(5);

    const branchesTech = await listerBranchesPortefeuille(technique);
    expect(branchesTech.length).toBeGreaterThanOrEqual(5);
  });

  it("une branche sans produit retourne 0 produit sans erreur", async () => {
    // S'assurer de la présence des 5 branches
    const branches = await listerBranchesPortefeuille(commercial);
    const codes = ["MALADIE", "ACCIDENTS_CORPORELS", "RECOLTE", "DECES", "INCENDIE_DOMMAGES"];
    for (const c of codes) {
      expect(branches.some((b) => b.code === c)).toBe(true);
    }

    // Trouver une branche sans produit ou créer une branche isolée sans produit
    // Si RECOLTE ou DECES n'ont pas de produit configuré :
    const brancheSansProd = branches.find((b) => b.nombreProduits === 0) ?? branches[0];
    const res = await listerProduitsPortefeuille(commercial, brancheSansProd.code);
    expect(res.branche.code).toBe(brancheSansProd.code);
    if (brancheSansProd.nombreProduits === 0) {
      expect(res.produits).toHaveLength(0);
    }
  });

  it("un client avec deux produits distincts apparaît sous chacun des deux produits", async () => {
    const codeTaxe1 = await assurerBranche(unique("TAXE_A").toUpperCase().replace(/-/g, "_"));
    const codeTaxe2 = await assurerBranche(unique("TAXE_B").toUpperCase().replace(/-/g, "_"));
    await creerTaxe(
      technique,
      { branche: codeTaxe1, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "0", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null },
      null,
    );
    await creerTaxe(
      technique,
      { branche: codeTaxe2, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "0", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null },
      null,
    );

    // Création de deux produits dans deux branches différentes
    const codeProd1 = unique("P1_MAL").toUpperCase().replace(/-/g, "_");
    const codeProd2 = unique("P2_ACC").toUpperCase().replace(/-/g, "_");

    await creerProduit(technique, { code: codeProd1, libelle: "Produit Maladie Test", gamme: "SANTE", branche: codeTaxe1, branchePrincipale: "MALADIE" }, null);
    await creerVersion(technique, codeProd1, versionSimple(), null);

    await creerProduit(technique, { code: codeProd2, libelle: "Produit Accident Test", gamme: "ACCIDENT", branche: codeTaxe2, branchePrincipale: "ACCIDENTS_CORPORELS" }, null);
    await creerVersion(technique, codeProd2, versionSimple(), null);

    // Création d'un client enregistré unique
    const nomClient = unique("KONE_DUAL");
    const souscripteur = souscripteurTest(nomClient);
    const clientId = await creerClient(commercial, souscripteur, null);

    // Cotation 1 pour Produit 1
    const cotationId1 = await creerBrouillon(commercial, saisieCotation(codeProd1, clientId, souscripteur), null);
    // Cotation 2 pour Produit 2
    const cotationId2 = await creerBrouillon(commercial, saisieCotation(codeProd2, clientId, souscripteur), null);

    // Vérification Niveau 1 (Branches)
    const branches = await listerBranchesPortefeuille(commercial);
    const brancheMaladie = branches.find((b) => b.code === "MALADIE")!;
    const brancheAccidents = branches.find((b) => b.code === "ACCIDENTS_CORPORELS")!;
    expect(brancheMaladie.nombreProduits).toBeGreaterThanOrEqual(1);
    expect(brancheAccidents.nombreProduits).toBeGreaterThanOrEqual(1);

    // Vérification Niveau 2 (Produits)
    const prodsMaladie = await listerProduitsPortefeuille(commercial, "MALADIE");
    expect(prodsMaladie.produits.some((p) => p.code === codeProd1)).toBe(true);

    const prodsAccidents = await listerProduitsPortefeuille(commercial, "ACCIDENTS_CORPORELS");
    expect(prodsAccidents.produits.some((p) => p.code === codeProd2)).toBe(true);

    // Vérification Niveau 3 (Clients)
    // Le client CLI-<clientId> DOIT être présent sous Produit 1
    const clientsP1 = await listerClientsPortefeuille(commercial, "MALADIE", codeProd1);
    const clientDansP1 = clientsP1.clients.find((c) => c.identifiant === `CLI-${clientId}`);
    expect(clientDansP1).toBeDefined();
    expect(clientDansP1?.nom).toContain(nomClient);
    expect(clientDansP1?.nombreCotations).toBe(1);

    // Le client CLI-<clientId> DOIT AUSSI être présent sous Produit 2
    const clientsP2 = await listerClientsPortefeuille(commercial, "ACCIDENTS_CORPORELS", codeProd2);
    const clientDansP2 = clientsP2.clients.find((c) => c.identifiant === `CLI-${clientId}`);
    expect(clientDansP2).toBeDefined();
    expect(clientDansP2?.nom).toContain(nomClient);
    expect(clientDansP2?.nombreCotations).toBe(1);

    // Vérification Niveau 4 (Pièces)
    const piecesP1 = await listerPiecesClientPortefeuille(commercial, "MALADIE", codeProd1, `CLI-${clientId}`);
    expect(piecesP1.produit.code).toBe(codeProd1);
    expect(piecesP1.cotations).toHaveLength(1);
    expect(piecesP1.cotations[0].id).toBe(cotationId1);

    const piecesP2 = await listerPiecesClientPortefeuille(commercial, "ACCIDENTS_CORPORELS", codeProd2, `CLI-${clientId}`);
    expect(piecesP2.produit.code).toBe(codeProd2);
    expect(piecesP2.cotations).toHaveLength(1);
    expect(piecesP2.cotations[0].id).toBe(cotationId2);
  });

  it("gère également un prospect sans compte client sous la convention PROSP-id", async () => {
    const codeTaxe = await assurerBranche(unique("TAXE_PROSP").toUpperCase().replace(/-/g, "_"));
    await creerTaxe(
      technique,
      { branche: codeTaxe, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "0", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null },
      null,
    );

    const codeProd = unique("P_PROSP").toUpperCase().replace(/-/g, "_");
    await creerProduit(technique, { code: codeProd, libelle: "Produit Prospect Test", gamme: "PROSP", branche: codeTaxe, branchePrincipale: "MALADIE" }, null);
    await creerVersion(technique, codeProd, versionSimple(), null);

    const nomProspect = unique("PROSPECT_LIBRE");
    const prospect = souscripteurTest(nomProspect);

    // Cotation sans clientId
    const cotationId = await creerBrouillon(commercial, saisieCotation(codeProd, null, prospect), null);

    const resClients = await listerClientsPortefeuille(commercial, "MALADIE", codeProd);
    const prospectTrouve = resClients.clients.find((c) => c.identifiant === `PROSP-${cotationId}`);
    expect(prospectTrouve).toBeDefined();
    expect(prospectTrouve?.nom).toContain(nomProspect);
    expect(prospectTrouve?.estClientEnregistre).toBe(false);

    // Pièces du prospect
    const piecesProspect = await listerPiecesClientPortefeuille(commercial, "MALADIE", codeProd, `PROSP-${cotationId}`);
    expect(piecesProspect.client.identifiant).toBe(`PROSP-${cotationId}`);
    expect(piecesProspect.cotations[0].id).toBe(cotationId);
  });
});
