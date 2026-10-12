// Session 6.2b, tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
// Composition manuelle de la prime d'un produit en mode GARANTIES : la Technique saisit les lignes de prime, le module résout le taux de chaque
// branche, calcule la taxe, arrondit, totalise et fige. Tous les chiffres sont INVENTÉS (instructions de la phase 6.2), posés à la main
// avec leur calcul en commentaire.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { estComposition } from "@/domaine/calcul/composition";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { accepter, composerLaPrime, creerBrouillon, lireCotation, modifierBrouillon, renvoyerEnBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let technique2: UtilisateurCourant;
let commercial: UtilisateurCourant;
let comptable: UtilisateurCourant;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

const prospect: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Test", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" };
const taxe = (branche: string, tauxPourcent: string, typeContrat: "INDIVIDUEL" | "GROUPE" | null = null) =>
  creerTaxe(technique, { branche, typeContrat, tauxMixte: false, commentaire: null, tauxPourcent, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);

/** Version par garanties : aucune formule (H85 relâchée), règle d'arrondi au franc, le plus proche. */
const versionGaranties = (surcharge: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet: "2020-01-01",
  modeTarification: "GARANTIES",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
  garanties: [{ libelle: "Incendie", branche: null }, { libelle: "Vol", branche: null }],
  ...surcharge,
});

const saisie = (codeProduit: string, surcharge: Partial<SaisieCotation> = {}): SaisieCotation => ({
  codeProduit,
  clientId: null,
  typeContrat: "INDIVIDUEL",
  souscripteur: prospect,
  dateEffet: "2026-01-01",
  dateEcheance: "2026-12-31",
  nombreTranches: 1,
  lignes: [],
  motifForcage: null,
  assures: [],
  beneficiaires: null,
  contactsUrgence: null,
  risque: {},
  ...surcharge,
});

let compteurPolice = 0;
const numeroPolice = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(++compteurPolice).padStart(5, "0")}`;

let INCENDIE: string; // 12,5 %
let IARD: string; // 7,25 %
let IA: string; // 7,25 %
let DECES: string; // 0 %
let SANTE: string; // Individuel 4 %, Groupe 1,5 %

/** Les trois lignes IARD de l'énoncé : Incendie 10 000 + 2 500, Vol 9 850 + 2 500, Dégât des eaux 6 000 + 2 500. */
const LIGNES_IARD = () => [
  { libelle: "Incendie", branche: INCENDIE, primeNette: "10000", accessoires: "2500" },
  { libelle: "Vol", branche: IARD, primeNette: "9850", accessoires: "2500" },
  { libelle: "Dégât des eaux", branche: IARD, primeNette: "6000", accessoires: "2500" },
];

async function produitGaranties(surcharge: Partial<VersionSaisie> = {}): Promise<string> {
  const code = CODE("PGAR");
  await creerProduit(technique, { code, libelle: "Produit par garanties (test)", gamme: "SECUR", branche: IARD }, null);
  await creerVersion(technique, code, versionGaranties(surcharge), null);
  return code;
}

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const id = unique("admin");
  await creerAdministrateurInitial({ identifiant: id, nom: "Admin", motDePasse: MDP });
  admin = await compte(id);
  [technique, technique2, commercial, comptable] = [await nouveauCompte("TECHNIQUE"), await nouveauCompte("TECHNIQUE"), await nouveauCompte("COMMERCIAL"), await nouveauCompte("COMPTABILITE")];
  [INCENDIE, IARD, IA, DECES, SANTE] = [`INC_${CODE("B")}`.slice(0, 20), `IARD_${CODE("B")}`.slice(0, 20), `IA_${CODE("B")}`.slice(0, 20), `DEC_${CODE("B")}`.slice(0, 20), `SAN_${CODE("B")}`.slice(0, 20)];
  for (const b of [INCENDIE, IARD, IA, DECES, SANTE]) await assurerBranche(b);
  await taxe(INCENDIE, "12.5");
  await taxe(IARD, "7.25");
  await taxe(IA, "7.25");
  await taxe(DECES, "0");
  await taxe(SANTE, "4", "INDIVIDUEL");
  await taxe(SANTE, "1.5", "GROUPE");
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("composition IARD : du brouillon à la cotation émise", () => {
  it("le Commercial crée la cotation « à composer », la Technique compose : taxes 1 563, 895 et 616, TTC 36 424, motif et journal avant / après", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    expect((await lireCotation(commercial, id))!.composition).toMatchObject({ lignes: [], composePar: null });

    const r = await composerLaPrime(technique, id, LIGNES_IARD(), "Calcul du simulateur de la Technique du 12/10 (inventé)", null);
    // Incendie (10 000 + 2 500) × 12,5 % = 1 562,5 → 1 563 ; Vol (9 850 + 2 500) × 7,25 % = 895,375 → 895 ; Dégât des eaux (6 000 + 2 500) × 7,25 % = 616,25 → 616.
    // Totaux : nette 25 850, accessoires 7 500, taxe 3 074, TTC 36 424 ; invariant nette + accessoires + taxe = TTC par ligne et au total.
    expect(r.ttc).toBe("36424");
    const c = (await lireCotation(commercial, id))!;
    expect(c.resultat.lignes.map((l) => [l.arrondi.nette.toFixed(), l.arrondi.accessoires.toFixed(), l.arrondi.taxe.toFixed(), l.arrondi.ttc.toFixed()])).toEqual([
      ["10000", "2500", "1563", "14063"],
      ["9850", "2500", "895", "13245"],
      ["6000", "2500", "616", "9116"],
    ]);
    expect(Object.fromEntries(Object.entries(c.resultat.totaux.arrondi).map(([k, v]) => [k, v.toFixed()]))).toEqual({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424" });
    for (const l of c.resultat.lignes) expect(l.arrondi.ttc.eq(l.arrondi.nette.plus(l.arrondi.accessoires).plus(l.arrondi.taxe))).toBe(true);
    expect(c.composition!.lignes.map((l) => [l.libelle, l.branche, l.tauxPourcent])).toEqual([["Incendie", INCENDIE, "12.5"], ["Vol", IARD, "7.25"], ["Dégât des eaux", IARD, "7.25"]]);
    expect(c.composition).toMatchObject({ composePar: technique.identifiant, motif: "Calcul du simulateur de la Technique du 12/10 (inventé)" });
    expect(c.lignes).toEqual([]); // pas de formules
    expect((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).ttcTotal?.toFixed()).toBe("36424");

    const journal = (await lireJournal({ action: "COTATION_COMPOSEE" })).lignes.filter((l) => l.objet === `cotation ${id}`);
    expect(journal).toHaveLength(1);
    expect(journal[0].avant).toMatchObject({ lignes: [], ttc: null });
    expect(journal[0].apres).toMatchObject({ ttc: "36424", motif: "Calcul du simulateur de la Technique du 12/10 (inventé)" });
  });

  it("la composition est remplacée en entier par une nouvelle composition (journal : l'ancienne en « avant »)", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Première composition", null);
    await composerLaPrime(technique, id, [LIGNES_IARD()[1]], "Seule la garantie vol est souscrite", null);
    const c = (await lireCotation(commercial, id))!;
    // Vol seule : 895, TTC 13 245.
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("13245");
    const journal = (await lireJournal({ action: "COTATION_COMPOSEE" })).lignes.filter((l) => l.objet === `cotation ${id}`);
    expect(journal).toHaveLength(2);
    const derniere = journal[0];
    expect((derniere.avant as { lignes: unknown[] }).lignes).toHaveLength(3);
    expect(derniere.avant).toMatchObject({ ttc: "36424", motif: "Première composition" });
  });

  it("le Commercial soumet la cotation composée : elle est émise (sous le seuil), figée avec la composition et ses taux ; la police la reprend sans nouveau calcul (T10)", async () => {
    const code = await produitGaranties();
    // Branche incendie PRIVÉE à ce test : on y change le taux plus bas, sans toucher à celle des autres tests.
    const incendiePrive = `INP_${CODE("B")}`.slice(0, 20);
    await assurerBranche(incendiePrive);
    await taxe(incendiePrive, "12.5");
    const id = await creerBrouillon(commercial, saisie(code, { nombreTranches: 4 }), null);
    await composerLaPrime(technique, id, [{ ...LIGNES_IARD()[0], branche: incendiePrive }, LIGNES_IARD()[1], LIGNES_IARD()[2]], "Simulateur (inventé)", null);

    const r = await soumettre(commercial, id, null);
    expect(r.statut).toBe("EMISE");
    const ligne = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } });
    expect(ligne.numero).toMatch(/^COT-/);
    expect(estComposition(ligne.donneesCalcul as unknown)).toBe(true);
    // Échéancier en 4 tranches de 36 424 / 4 = 9 106.
    expect((await lireCotation(commercial, id))!.echeancier?.map((t) => t.montant.toFixed())).toEqual(["9106", "9106", "9106", "9106"]);

    // Les taux sont figés : une nouvelle taxe incendie (15 %) à partir de 2025-06-01 ne change rien à la cotation émise.
    const avant = (await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed();
    await creerTaxe(technique, { branche: incendiePrive, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "15", assiette: "NETTE_ACCESSOIRES", dateEffet: "2025-06-01", dateFin: null }, null);
    expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed()).toBe(avant);

    // Acceptation en entier : aucun choix de formule ; la police reprend la composition telle quelle.
    const { numeroPolice: np } = await accepter(commercial, id, [], numeroPolice(), null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: np } });
    expect(estComposition(police.donneesCalcul as unknown)).toBe(true);
    expect(police.ttcTotal.toFixed()).toBe("36424");
    expect((await lireCotation(commercial, id))!.statut).toBe("ACCEPTEE");
  });
});

describe("composition IA, SANTE et régime de taxe", () => {
  it("IA : Accident 100 000 + 5 000 à 7,25 %, Décès toutes causes 20 000 + 0 à 0 % (taxe nulle sur cette ligne)", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(
      technique,
      id,
      [
        { libelle: "Accident", branche: IA, primeNette: "100000", accessoires: "5000" },
        { libelle: "Décès toutes causes", branche: DECES, primeNette: "20000", accessoires: "0" },
      ],
      "Simulateur (inventé)",
      null,
    );
    const c = (await lireCotation(commercial, id))!;
    // Accident : (100 000 + 5 000) × 7,25 % = 7 612,5 → 7 613, TTC 112 613. Décès : taxe 0, TTC 20 000. Totaux : taxe 7 613, TTC 132 613.
    expect(c.resultat.lignes.map((l) => [l.arrondi.taxe.toFixed(), l.arrondi.ttc.toFixed()])).toEqual([["7613", "112613"], ["0", "20000"]]);
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("132613");
  });

  it("une ligne SANTE : 1,5 % pour le régime Groupe, 4 % pour le régime Individuel (même résolution que le calcul automatique)", async () => {
    const code = await produitGaranties();
    const ligneSante = [{ libelle: "Santé", branche: SANTE, primeNette: "200000", accessoires: "0" }];
    const groupe = await creerBrouillon(commercial, saisie(code, { typeContrat: "GROUPE" }), null);
    const individuel = await creerBrouillon(commercial, saisie(code, { typeContrat: "INDIVIDUEL" }), null);
    await composerLaPrime(technique, groupe, ligneSante, "Santé groupe (inventé)", null);
    await composerLaPrime(technique, individuel, ligneSante, "Santé individuelle (inventé)", null);
    // 200 000 × 1,5 % = 3 000 ; 200 000 × 4 % = 8 000.
    expect((await lireCotation(commercial, groupe))!.resultat.totaux.arrondi.taxe.toFixed()).toBe("3000");
    expect((await lireCotation(commercial, individuel))!.resultat.totaux.arrondi.taxe.toFixed()).toBe("8000");
    // Un régime choisi à la main (famille → régime Groupe) est celui qui est utilisé, et il survit à la soumission.
    const famille = await creerBrouillon(commercial, saisie(code, { typeContrat: "FAMILLE", regimeTaxe: "GROUPE" }), null);
    await composerLaPrime(technique, famille, ligneSante, "Santé famille au régime groupe (inventé)", null);
    expect((await lireCotation(commercial, famille))!.resultat.totaux.arrondi.taxe.toFixed()).toBe("3000");
    await soumettre(commercial, famille, null);
    const emise = (await lireCotation(commercial, famille))!;
    expect(emise.regimeTaxe).toBe("GROUPE");
    expect(emise.resultat.totaux.arrondi.taxe.toFixed()).toBe("3000");
  });

  it("surprime et majoration : des lignes comme les autres, avec leur branche fiscale", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, [LIGNES_IARD()[0], { libelle: "Surprime", branche: INCENDIE, primeNette: "1000", accessoires: "0" }], "Surprime incendie (inventée)", null);
    // Surprime : 1 000 × 12,5 % = 125, TTC 1 125. Total : taxe 1 563 + 125 = 1 688 ; TTC 14 063 + 1 125 = 15 188.
    const c = (await lireCotation(commercial, id))!;
    expect(c.resultat.totaux.arrondi.taxe.toFixed()).toBe("1688");
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("15188");
  });
});

describe("droits et séparation des tâches", () => {
  it("un Commercial ne peut pas composer ; la Comptabilité non plus ; la Technique oui", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await expect(composerLaPrime(commercial, id, LIGNES_IARD(), "Je compose quand même", null)).rejects.toThrow(ErreurAcces);
    await expect(composerLaPrime(comptable, id, LIGNES_IARD(), "Je compose quand même", null)).rejects.toThrow(ErreurAcces);
    expect((await lireCotation(commercial, id))!.composition!.lignes).toEqual([]);
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "Composition de la Technique", null)).resolves.toMatchObject({ ttc: "36424" });
  });

  it("le motif est obligatoire (3 caractères au moins) et borné", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "  ", null)).rejects.toThrow(/motif/);
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "ab", null)).rejects.toThrow(/motif/);
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "x".repeat(501), null)).rejects.toThrow(/trop long/);
    expect(await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } }).then((c) => c.compositionParId)).toBeNull();
  });

  it("celui qui a composé ne peut pas valider ; l'auteur non plus ; un autre valideur de la Technique valide (T13, H9)", async () => {
    const code = await produitGaranties({ seuilValidationTtc: "30000" });
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Simulateur (inventé)", null);
    // TTC 36 424 > seuil 30 000 : la cotation attend un valideur.
    expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");
    expect((await lireCotation(commercial, id))!.raisonsValidation).toEqual(["SEUIL_DEPASSE"]);

    await expect(valider(technique, id, null)).rejects.toThrow(/modifié cette cotation/);
    await expect(valider(commercial, id, null)).rejects.toThrow(ErreurAcces);
    const numero = await valider(technique2, id, null);
    expect(numero).toMatch(/^COT-/);
    expect((await lireCotation(commercial, id))!).toMatchObject({ statut: "EMISE" });
  });

  it("la composition est refusée sur une cotation émise (elle est figée) ; renvoyée en brouillon, elle se recompose", async () => {
    const code = await produitGaranties({ seuilValidationTtc: "30000" });
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Première composition", null);
    await soumettre(commercial, id, null); // A_VALIDER
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "Trop tard", null)).rejects.toThrow(/figée|brouillon/);
    await renvoyerEnBrouillon(technique2, id, "Composition à revoir", null);
    await expect(composerLaPrime(technique, id, [LIGNES_IARD()[1]], "Nouvelle composition", null)).resolves.toMatchObject({ ttc: "13245" });
  });
});

describe("contrôles de la saisie", () => {
  it("jamais de zéro silencieux : aucune ligne, prime nette nulle ou négative, montant illisible, libellé vide, branche absente", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    const essai = (lignes: { libelle: string; branche: string; primeNette: string; accessoires: string }[]) => composerLaPrime(technique, id, lignes, "Essai de composition", null);
    await expect(essai([])).rejects.toThrow(/au moins une ligne/);
    await expect(essai([{ ...LIGNES_IARD()[1], primeNette: "0" }])).rejects.toThrow(/supérieure à zéro/);
    await expect(essai([{ ...LIGNES_IARD()[1], primeNette: "-100" }])).rejects.toThrow(/négatif/);
    await expect(essai([{ ...LIGNES_IARD()[1], accessoires: "1.234,5" }])).rejects.toThrow(/Montant invalide/);
    await expect(essai([{ ...LIGNES_IARD()[1], libelle: " " }])).rejects.toThrow(/libellé/);
    await expect(essai([{ ...LIGNES_IARD()[1], branche: "" }])).rejects.toThrow(/branche/);
    expect((await lireCotation(commercial, id))!.composition!.lignes).toEqual([]);
  });

  it("une branche inconnue, désactivée, ou sans taux en vigueur est refusée avec un message qui la nomme ; une branche à taux mixte aussi", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    const ligne = (branche: string) => [{ libelle: "Garantie", branche, primeNette: "1000", accessoires: "0" }];
    await expect(composerLaPrime(technique, id, ligne("INCONNUE_X"), "Essai de composition", null)).rejects.toThrow(/INCONNUE_X/);

    const sansTaux = `STX_${CODE("B")}`.slice(0, 20);
    await assurerBranche(sansTaux);
    await expect(composerLaPrime(technique, id, ligne(sansTaux), "Essai de composition", null)).rejects.toThrow(/Aucune taxe en vigueur/);

    const mixte = `MIX_${CODE("B")}`.slice(0, 20);
    await assurerBranche(mixte);
    await creerTaxe(technique, { branche: mixte, typeContrat: null, tauxMixte: true, commentaire: "12,5 % / 7,25 %", tauxPourcent: null, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await expect(composerLaPrime(technique, id, ligne(mixte), "Essai de composition", null)).rejects.toThrow(/taux mixte/);

    const desactivee = `OFF_${CODE("B")}`.slice(0, 20);
    await assurerBranche(desactivee);
    await taxe(desactivee, "5");
    await obtenirPrisma().branche.update({ where: { code: desactivee }, data: { actif: false } });
    await expect(composerLaPrime(technique, id, ligne(desactivee), "Essai de composition", null)).rejects.toThrow(/désactivée/);
  });

  it("saisie libre interdite : seuls les libellés de la liste du produit sont acceptés (sans casse)", async () => {
    const code = await produitGaranties({ garantiesSaisieLibre: false });
    const id = await creerBrouillon(commercial, saisie(code), null);
    await expect(composerLaPrime(technique, id, [{ libelle: "Bris de glace", branche: IARD, primeNette: "1000", accessoires: "0" }], "Essai de composition", null)).rejects.toThrow(/n'est pas une garantie de ce produit/);
    await expect(composerLaPrime(technique, id, [{ libelle: "  vol ", branche: IARD, primeNette: "1000", accessoires: "0" }], "Essai de composition", null)).resolves.toBeTruthy();
  });

  it("un produit à la formule ne se compose pas", async () => {
    const code = CODE("FORM");
    await creerProduit(technique, { code, libelle: "À la formule (test)", gamme: "RELAX", branche: SANTE }, null);
    await creerVersion(technique, code, { ...versionGaranties(), modeTarification: "FORMULE", garanties: [], formules: [{ code: "F", libelle: "F", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" }] }, null);
    const id = await creerBrouillon(commercial, saisie(code, { lignes: [{ codeFormule: "F", effectif: 1 }] }), null);
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "Essai de composition", null)).rejects.toThrow(/se tarifie à la formule/);
    await expect(creerBrouillon(commercial, saisie(code, { lignes: [{ codeFormule: "F", effectif: 1 }], composition: LIGNES_IARD() }), null)).rejects.toThrow(/ne se compose pas/);
  });
});

describe("modification d'un brouillon composé et paramétrage de la version", () => {
  it("le Commercial modifie les dates du brouillon composé : la composition est conservée et ses taux sont résolus de nouveau à la nouvelle date d'effet", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, [{ libelle: "Santé", branche: SANTE, primeNette: "200000", accessoires: "0" }], "Simulateur (inventé)", null);
    await modifierBrouillon(commercial, id, saisie(code, { dateEffet: "2026-03-01", souscripteur: { ...prospect, nom: "AUTRE" } }), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.composition!.lignes).toHaveLength(1);
    expect(c.resultat.totaux.arrondi.taxe.toFixed()).toBe("8000"); // régime Individuel : 4 %
    expect(c.souscripteur.nom).toBe("AUTRE");
    expect(c.contributeurs).toEqual(expect.arrayContaining([commercial.id, technique.id]));
  });

  it("une version par garanties n'a pas besoin de formule ; ses frais de fractionnement et une liste de garanties à la formule sont refusés", async () => {
    const code = CODE("VER");
    await creerProduit(technique, { code, libelle: "Version (test)", gamme: "SECUR", branche: IARD }, null);
    await expect(creerVersion(technique, code, versionGaranties({ fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "500" } }), null)).rejects.toThrow(/frais de fractionnement/);
    await expect(creerVersion(technique, code, versionGaranties({ modeTarification: "FORMULE" }), null)).rejects.toThrow(/au moins une formule|liste des garanties/);
    await expect(creerVersion(technique, code, versionGaranties({ garantiesSaisieLibre: false, garanties: [] }), null)).rejects.toThrow(/saisie libre est interdite/);
    await expect(creerVersion(technique, code, versionGaranties({ garanties: [{ libelle: "Vol", branche: null }, { libelle: "vol", branche: "iard" }] }), null)).rejects.toThrow(/en double|branche invalide/);
    await creerVersion(technique, code, versionGaranties(), null);
    const lue = (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } }));
    expect(lue.garanties).toEqual([{ libelle: "Incendie", branche: null }, { libelle: "Vol", branche: null }]);
    expect(lue.garantiesSaisieLibre).toBe(true);
  });

  it("des frais de fractionnement présents sur une version déjà enregistrée (créée avant ce contrôle) sont refusés dès qu'on fractionne, jamais ignorés", async () => {
    const code = CODE("FRA");
    await creerProduit(technique, { code, libelle: "Frais (test)", gamme: "SECUR", branche: IARD }, null);
    const produit = await obtenirPrisma().produit.findUniqueOrThrow({ where: { code } });
    // Une version de la 6.2a pouvait porter des frais : on l'insère sans passer par la validation (les versions en vigueur ne se modifient plus, mais s'insèrent).
    await obtenirPrisma().produitVersion.create({
      data: { produitId: produit.id, dateEffet: new Date("2020-01-01T00:00:00.000Z"), arrondiPrecision: 1, arrondiSens: "PROCHE", arrondiNiveau: "LIGNE", arrondiComposante: "TAXE", prorataActif: false, fraisFractionnement: "500", fractionnementTranchesMax: 4, modeTarification: "GARANTIES", creePar: "test" },
    });
    await expect(creerBrouillon(commercial, saisie(code, { nombreTranches: 2 }), null)).rejects.toThrow(/frais de fractionnement/);
    // En une seule tranche, aucun frais ne s'applique : le brouillon se crée.
    await expect(creerBrouillon(commercial, saisie(code, { nombreTranches: 1 }), null)).resolves.toBeTypeOf("number");
  });
});
