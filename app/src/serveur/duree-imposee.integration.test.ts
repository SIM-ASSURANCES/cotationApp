// D64 : durée du contrat imposée par version de produit (1 an, sans prorata). Vraie base PostgreSQL de test. Données inventées.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "./branches-test";
import { calculerCotationFormules, creerBrouillon, lireCotation, modifierBrouillon, type SaisieCotation } from "./cotations";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const SUFFIXE = unique("DI").toUpperCase().replace(/-/g, "_");
const IMPOSE = `IMPOSE_${SUFFIXE}`;
const LIBRE = `LIBRE_${SUFFIXE}`;
const BRANCHE = `SANTE_${SUFFIXE}`;
const prospect: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Test", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" };

let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;

const version = (surcharge: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "100000", accessoireMode: "FIXE", accessoireValeur: "3000" }],
  ...surcharge,
});

const saisie = (codeProduit: string, surcharge: Partial<SaisieCotation> = {}): SaisieCotation => ({
  codeProduit,
  clientId: null,
  typeContrat: "GROUPE",
  souscripteur: prospect,
  dateEffet: "2026-03-01",
  dateEcheance: "2026-06-30", // volontairement fausse pour une durée imposée
  nombreTranches: 1,
  lignes: [{ codeFormule: "SOLO", effectif: 10 }],
  motifForcage: null,
  assures: [],
  beneficiaires: null,
  contactsUrgence: null,
  risque: {},
  ...surcharge,
});

const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

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
  await assurerBranche(BRANCHE);
  await creerTaxe(technique, { branche: BRANCHE, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  for (const code of [IMPOSE, LIBRE]) await creerProduit(technique, { code, libelle: `Produit ${code} (test)`, gamme: "RELAX", branchePrincipale: "MALADIE", branche: BRANCHE }, null);
  await creerVersion(technique, IMPOSE, version({ dureeImposeeUnAn: true }), null);
  await creerVersion(technique, LIBRE, version(), null);
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  await obtenirPrisma().$disconnect();
});

describe("D64 : durée imposée à 1 an, sans prorata", () => {
  it("à l'enregistrement, l'échéance est celle que le serveur calcule (effet + 1 an - 1 jour), quelle que soit la date reçue", async () => {
    const id = await creerBrouillon(commercial, saisie(IMPOSE), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.dateEffet).toBe("2026-03-01");
    expect(c.dateEcheance).toBe("2027-02-28");
  });

  it("à la modification d'un brouillon, l'échéance suit la nouvelle date d'effet, et ne se modifie pas à la main", async () => {
    const id = await creerBrouillon(commercial, saisie(IMPOSE), null);
    await modifierBrouillon(commercial, id, saisie(IMPOSE, { dateEffet: "2026-07-15", dateEcheance: "2026-08-01" }), null);
    const c = (await lireCotation(commercial, id))!;
    expect([c.dateEffet, c.dateEcheance]).toEqual(["2026-07-15", "2027-07-14"]);
  });

  it("le calcul automatique applique la même échéance : 365 jours, coefficient 1, sans prorata ; mêmes montants que l'enregistrement", async () => {
    const demande = { codeProduit: IMPOSE, typeContrat: "GROUPE", regimeTaxe: "GROUPE", dateEffet: "2026-03-01", dateEcheance: "2026-06-30", nombreTranches: 1, lignes: saisie(IMPOSE).lignes };
    const calcul = await calculerCotationFormules(commercial, demande);
    expect(calcul.prorata).toEqual({ actif: false, jours: 365, coefficient: "1" });
    const id = await creerBrouillon(commercial, saisie(IMPOSE), null);
    const c = (await lireCotation(commercial, id))!;
    expect(calcul.totaux.ttc).toBe(c.resultat.totaux.arrondi.ttc.toFixed());
  });

  it("sans le réglage, le comportement est celui d'avant : la date saisie est gardée", async () => {
    const id = await creerBrouillon(commercial, saisie(LIBRE), null);
    expect((await lireCotation(commercial, id))!.dateEcheance).toBe("2026-06-30");
  });

  it("une durée imposée avec prorata est refusée (validation) et par la base (CHECK)", async () => {
    await expect(creerVersion(technique, LIBRE, version({ dateEffet: "2021-01-01", dureeImposeeUnAn: true, prorata: { actif: true, primeMinimale: null } }), null)).rejects.toBeInstanceOf(ErreurMetier);
    await expect(
      obtenirPrisma().$executeRawUnsafe(
        `INSERT INTO produit_versions (produit_id, date_effet, arrondi_precision, arrondi_sens, arrondi_niveau, arrondi_composante, prorata_actif, duree_imposee_un_an, cree_par)
         SELECT id, '2030-01-01', 1, 'PROCHE', 'LIGNE', 'TAXE', true, true, 'test' FROM produits WHERE code = '${LIBRE}'`,
      ),
    ).rejects.toThrow(/duree_imposee_sans_prorata/);
  });
});
