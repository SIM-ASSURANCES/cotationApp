import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import type { Souscripteur } from "@/domaine/cotation/saisie";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import { SEUIL_VALIDATION_GLOBAL_DEFAUT } from "@/domaine/cotation/seuil-validation";

import { assurerBranche } from "./branches-test";
import { initialiserProfilsEtDroits } from "./droits";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";
import { creerProduit, creerTaxe, creerVersion, calculerPourProduit } from "./parametrage";
import { creerBrouillon, lireCotation, modifierBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { lireSeuilValidationGlobal } from "./societe";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;
let dg: UtilisateurCourant;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

const CODE = unique("PROD").toUpperCase().replace(/-/g, "_");
const BRANCHE = `SANTE_${CODE}`;
const prospect: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Invente", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" };

/**
 * Modèle de produit : formule Solo avec taxe à 0% pour contrôler exactement le TTC au franc près.
 */
const versionTest = (): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null, // Retiré de la saisie (étape 3)
  formules: [
    { code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "1", accessoireMode: "AUCUN", accessoireValeur: "0" },
  ],
});

const saisie = (): SaisieCotation => ({
  codeProduit: CODE,
  clientId: null,
  typeContrat: "INDIVIDUEL",
  souscripteur: prospect,
  dateEffet: "2026-01-01",
  dateEcheance: "2026-12-31",
  nombreTranches: 1,
  lignes: [{ codeFormule: "SOLO", effectif: 1, accessoireValeur: "0" }],
  motifForcage: null,
  assures: [],
  beneficiaires: null,
  contactsUrgence: null,
  risque: {},
});

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
  await initialiserProfilsEtDroits();
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2026-01-01T00:00:00.000Z") } },
    update: { valeur: "10000000" },
    create: { cle: "seuil_validation_global", valeur: "10000000", dateEffet: new Date("2026-01-01T00:00:00.000Z"), creePar: "test" },
  });
  await obtenirPrisma().parametre.deleteMany({
    where: { cle: "seuil_validation_global", dateEffet: { not: new Date("2026-01-01T00:00:00.000Z") } },
  });
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  admin = await compte(idAdmin);
  technique = await nouveauCompte("TECHNIQUE");
  commercial = await nouveauCompte("COMMERCIAL");
  dg = await nouveauCompte("DIRECTION_GENERALE");

  await assurerBranche(BRANCHE);
  await creerTaxe(
    technique,
    { branche: BRANCHE, typeContrat: "INDIVIDUEL", tauxMixte: false, commentaire: null, tauxPourcent: "0", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null },
    null,
  );
  await creerProduit(technique, { code: CODE, libelle: "Produit Seuil Test", gamme: "RELAX", branche: BRANCHE, branchePrincipale: "MALADIE" }, null);
  await creerVersion(technique, CODE, versionTest(), null);
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  await obtenirPrisma().$disconnect();
});

describe("Étape 3 : Seuil unique de validation (10 000 000 FCFA TTC)", () => {
  it("seuil global par défaut est bien de 10 000 000 FCFA TTC", async () => {
    expect(SEUIL_VALIDATION_GLOBAL_DEFAUT).toBe("10000000");
    const seuil = await lireSeuilValidationGlobal();
    expect(seuil).toBe("10000000");
  });

  it("9 999 999 passe directement (émise sans validation)", async () => {
    // Cotation avec effectif = 9 999 999 et prime unitaire = 1 (taxe 0%) => TTC = 9 999 999 F
    const s = saisie();
    s.lignes = [{ codeFormule: "SOLO", effectif: 9999999, accessoireValeur: "0" }];
    const id = await creerBrouillon(commercial, s, null);
    const r = await soumettre(commercial, id, null);

    expect(r.statut).toBe("EMISE");
    expect(r.numero).toMatch(/^COT-/);
    const c = (await lireCotation(commercial, id))!;
    expect(c.statut).toBe("EMISE");
    expect(c.raisonsValidation).toEqual([]);
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("9999999");
  });

  it("10 000 000 passe aussi (comparaison stricte inchangée, D18)", async () => {
    const s = saisie();
    s.lignes = [{ codeFormule: "SOLO", effectif: 10000000, accessoireValeur: "0" }];
    const id = await creerBrouillon(commercial, s, null);
    const r = await soumettre(commercial, id, null);

    expect(r.statut).toBe("EMISE");
    expect(r.numero).toMatch(/^COT-/);
    const c = (await lireCotation(commercial, id))!;
    expect(c.statut).toBe("EMISE");
    expect(c.raisonsValidation).toEqual([]);
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("10000000");
  });

  it("10 000 001 va en validation (statut A_VALIDER, raison SEUIL_DEPASSE)", async () => {
    const s = saisie();
    s.lignes = [{ codeFormule: "SOLO", effectif: 10000001, accessoireValeur: "0" }];
    const id = await creerBrouillon(commercial, s, null);
    const r = await soumettre(commercial, id, null);

    expect(r.statut).toBe("A_VALIDER");
    expect(r.numero).toBeNull();
    const c = (await lireCotation(commercial, id))!;
    expect(c.statut).toBe("A_VALIDER");
    expect(c.raisonsValidation).toEqual(["SEUIL_DEPASSE"]);
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("10000001");
  });

  it("DG valide la cotation au-dessus du seuil", async () => {
    const s = saisie();
    s.lignes = [{ codeFormule: "SOLO", effectif: 10000001, accessoireValeur: "0" }];
    const id = await creerBrouillon(commercial, s, null);
    await soumettre(commercial, id, null);

    // Direction Générale valide la cotation
    const numero = await valider(dg, id, null);
    expect(numero).toMatch(/^COT-/);
    const c = (await lireCotation(commercial, id))!;
    expect(c.statut).toBe("EMISE");
    expect(c.numero).toBe(numero);
  });

  it("l'auteur ne valide pas (séparation des tâches stricte)", async () => {
    // Si la Technique crée elle-même une cotation dépassant le seuil :
    const s = saisie();
    s.lignes = [{ codeFormule: "SOLO", effectif: 10000001, accessoireValeur: "0" }];
    const id = await creerBrouillon(technique, s, null);
    await soumettre(technique, id, null);

    // La Technique (auteur) ne peut pas la valider elle-même
    await expect(valider(technique, id, null)).rejects.toThrow(/Vous ne pouvez pas valider votre propre cotation/);

    // Mais la DG (autre valideur) peut la valider
    await expect(valider(dg, id, null)).resolves.toMatch(/^COT-/);
  });

  it("qui a modifié le brouillon ne valide pas (séparation des tâches contributeur)", async () => {
    const s = saisie();
    s.lignes = [{ codeFormule: "SOLO", effectif: 10000001, accessoireValeur: "0" }];
    const id = await creerBrouillon(commercial, s, null);
    // La Technique modifie le brouillon
    await modifierBrouillon(technique, id, s, null);
    await soumettre(commercial, id, null);

    // La Technique a modifié la cotation : elle ne peut pas la valider
    await expect(valider(technique, id, null)).rejects.toThrow(/Vous avez modifié cette cotation/);

    // La DG (autre valideur non contributeur) peut valider
    await expect(valider(dg, id, null)).resolves.toMatch(/^COT-/);
  });

  it("une cotation émise avant le changement n'est pas touchée (intangibilité T10)", async () => {
    // 1. Émettre une cotation à 10 000 000 F sous le seuil de 10M
    const s = saisie();
    s.lignes = [{ codeFormule: "SOLO", effectif: 10000000, accessoireValeur: "0" }];
    const id = await creerBrouillon(commercial, s, null);
    const { numero } = await soumettre(commercial, id, null);
    expect(numero).toBeTruthy();

    const avant = (await lireCotation(commercial, id))!;
    expect(avant.statut).toBe("EMISE");
    expect(avant.resultat.totaux.arrondi.ttc.toFixed()).toBe("10000000");

    // 2. Vérifier qu'une cotation déjà émise reste figée, jamais recalculée ni repassée en validation
    const apres = (await lireCotation(commercial, id))!;
    expect(apres.statut).toBe("EMISE");
    expect(apres.numero).toBe(numero);
    expect(apres.resultat.totaux.arrondi.ttc.toFixed()).toBe("10000000");
    expect(apres.raisonsValidation).toEqual([]);
  });

  it("simulation de calcul utilise le seuil global (10M)", async () => {
    const simu9M = await calculerPourProduit(technique, {
      codeProduit: CODE,
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      regimeTaxe: "INDIVIDUEL",
      lignes: [{ codeFormule: "SOLO", effectif: 9999999 }],
      nombreTranches: 1,
    });
    expect(simu9M.doubleValidationRequise).toBe(false);

    const simu10M = await calculerPourProduit(technique, {
      codeProduit: CODE,
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      regimeTaxe: "INDIVIDUEL",
      lignes: [{ codeFormule: "SOLO", effectif: 10000000 }],
      nombreTranches: 1,
    });
    expect(simu10M.doubleValidationRequise).toBe(false);

    const simu10M1 = await calculerPourProduit(technique, {
      codeProduit: CODE,
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      regimeTaxe: "INDIVIDUEL",
      lignes: [{ codeFormule: "SOLO", effectif: 10000001 }],
      nombreTranches: 1,
    });
    expect(simu10M1.doubleValidationRequise).toBe(true);
  });
});
