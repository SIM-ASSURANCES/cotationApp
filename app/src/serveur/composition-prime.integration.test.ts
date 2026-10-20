// Session 6.2b, tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
// Composition manuelle de la prime d'un produit en mode GARANTIES : la Technique saisit les lignes de prime, le module résout le taux de chaque
// branche, calcule la taxe, arrondit, totalise et fige. Tous les chiffres sont INVENTÉS (instructions de la phase 6.2), posés à la main
// avec leur calcul en commentaire.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { estComposition, type EntreeComposition } from "@/domaine/calcul/composition";
import { MESSAGE_COMPOSITION_IMPOSSIBLE, type VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import { accepter, composerLaPrime, creerBrouillon, lireCotation, listerCotations, modifierBrouillon, renvoyerEnBrouillon, soumettre, valider, type SaisieCotation } from "./cotations";
import { contexteProduit, montantsDu } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { controlerImport, lireLot, modeleImport } from "./imports";
import { aujourdhui, creerProduit, creerTaxe, creerVersion, MESSAGE_NON_COMPOSEE } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let technique2: UtilisateurCourant;
let technique3: UtilisateurCourant;
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
let SANTE_DATEE: string; // tous régimes : 4 % jusqu'au 28/02/2026, 1,5 % à partir du 01/03/2026
let NETTE: string; // 10 %, assiette « nette seule »

/** Les trois lignes IARD de l'énoncé : Incendie 10 000 + 2 500, Vol 9 850 + 2 500, Dégât des eaux 6 000 + 2 500. */
const LIGNES_IARD = () => [
  { libelle: "Incendie", branche: INCENDIE, primeNette: "10000", accessoires: "2500" },
  { libelle: "Vol", branche: IARD, primeNette: "9850", accessoires: "2500" },
  { libelle: "Dégât des eaux", branche: IARD, primeNette: "6000", accessoires: "2500" },
];

async function produitGaranties(surcharge: Partial<VersionSaisie> = {}): Promise<string> {
  const code = CODE("PGAR");
  await creerProduit(technique, { code, libelle: "Produit par garanties (test)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(technique, code, versionGaranties(surcharge), null);
  return code;
}

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const id = unique("admin");
  await creerAdministrateurInitial({ identifiant: id, nom: "Admin", motDePasse: MDP });
  admin = await compte(id);
  [technique, technique2, technique3, commercial, comptable] = [
    await nouveauCompte("TECHNIQUE"),
    await nouveauCompte("TECHNIQUE"),
    await nouveauCompte("TECHNIQUE"),
    await nouveauCompte("COMMERCIAL"),
    await nouveauCompte("COMPTABILITE"),
  ];
  [INCENDIE, IARD, IA, DECES, SANTE] = [`INC_${CODE("B")}`.slice(0, 20), `IARD_${CODE("B")}`.slice(0, 20), `IA_${CODE("B")}`.slice(0, 20), `DEC_${CODE("B")}`.slice(0, 20), `SAN_${CODE("B")}`.slice(0, 20)];
  [SANTE_DATEE, NETTE] = [`SDA_${CODE("B")}`.slice(0, 20), `NET_${CODE("B")}`.slice(0, 20)];
  for (const b of [INCENDIE, IARD, IA, DECES, SANTE, SANTE_DATEE, NETTE]) await assurerBranche(b);
  await taxe(INCENDIE, "12.5");
  await taxe(IARD, "7.25");
  await taxe(IA, "7.25");
  await taxe(DECES, "0");
  await taxe(SANTE, "4", "INDIVIDUEL");
  await taxe(SANTE, "1.5", "GROUPE");
  const periode = (branche: string, tauxPourcent: string, dateEffet: string, dateFin: string | null, assiette: "NETTE_ACCESSOIRES" | "NETTE" = "NETTE_ACCESSOIRES") =>
    creerTaxe(technique, { branche, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent, assiette, dateEffet, dateFin }, null);
  await periode(SANTE_DATEE, "4", "2020-01-01", "2026-02-28");
  await periode(SANTE_DATEE, "1.5", "2026-03-01", null);
  await periode(NETTE, "10", "2020-01-01", null, "NETTE");
});

/** SQL direct (états qu'aucun chemin de l'application ne produit : ceintures de sécurité). */
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

const LIGNE_FORMULE = { code: "F", libelle: "F", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" } as const;
/** Le produit repasse « à la formule » pour tout document daté d'aujourd'hui (chemin réel de l'application). */
const repasserALaFormule = (code: string) =>
  creerVersion(technique, code, { ...versionGaranties(), dateEffet: aujourdhui(), modeTarification: "FORMULE", garanties: [], formules: [{ ...LIGNE_FORMULE }] }, null);

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("composition IARD : du brouillon à la cotation émise", () => {
  it("le Commercial crée la cotation « à composer », la Technique compose : taxes 1 563, 895 et 616, TTC 36 424, motif et journal avant / après", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    expect((await lireCotation(commercial, id))!.composition).toMatchObject({ lignes: [], composePar: null });
    // « À composer » : la liste des cotations le dit (pas de TTC affiché comme un 0) et le journal n'écrit pas de TTC nul.
    expect((await listerCotations(technique)).find((c) => c.id === id)).toMatchObject({ aComposer: true, ttc: null });
    const creee = (await lireJournal({ action: "COTATION_CREEE" })).lignes.find((l) => l.objet === `cotation ${id}`)!;
    expect(creee.apres).toMatchObject({ ttc: null });
    await modifierBrouillon(commercial, id, saisie(code, { souscripteur: { ...prospect, nom: "RETOUCHE" } }), null);
    const modifiee = (await lireJournal({ action: "COTATION_MODIFIEE" })).lignes.find((l) => l.objet === `cotation ${id}`)!;
    expect(modifiee.avant).toMatchObject({ ttc: null });
    expect(modifiee.apres).toMatchObject({ ttc: null });

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
    expect((await listerCotations(technique)).find((c) => c.id === id)).toMatchObject({ aComposer: false, ttc: "36424" });
  });

  it("les écritures d'une même cotation passent l'une après l'autre : une soumission lit la composition APRÈS une écriture concurrente, jamais avant (verrou de ligne)", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Première composition (inventée)", null);
    const autre = new Client({ connectionString: process.env.DATABASE_URL });
    await autre.connect();
    try {
      // Une transaction concurrente verrouille la cotation et la réécrit (ici : la seule garantie « vol », taxe 895, TTC 13 245), sans valider encore.
      await autre.query("BEGIN");
      await autre.query(`SELECT id FROM cotations WHERE id = ${id} FOR UPDATE`);
      await autre.query(`UPDATE cotations SET donnees_calcul = jsonb_set(donnees_calcul, '{lignes}', jsonb_build_array(donnees_calcul->'lignes'->1)) WHERE id = ${id}`);
      let terminee = false;
      const soumission = soumettre(commercial, id, null).then((r) => {
        terminee = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(terminee).toBe(false); // la soumission attend le verrou
      await autre.query("COMMIT");
      expect((await soumission).statut).toBe("EMISE");
      // Sans verrou, la soumission aurait lu les trois lignes avant la validation de l'autre transaction, puis réécrit 36 424 par-dessus.
      expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed()).toBe("13245");
    } finally {
      await autre.end();
    }
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

  it("le Commercial soumet la cotation composée (sous le seuil) : elle reçoit son numéro et ses taux figés ; la police la reprend sans nouveau calcul, même après un changement de taux (T10)", async () => {
    const code = await produitGaranties();
    // Branche incendie PRIVÉE à ce test : on y change le taux plus bas, sans toucher à celle des autres tests.
    const incendiePrive = `INP_${CODE("B")}`.slice(0, 20);
    await assurerBranche(incendiePrive);
    await taxe(incendiePrive, "12.5");
    const id = await creerBrouillon(commercial, saisie(code, { nombreTranches: 4 }), null);
    await composerLaPrime(technique, id, [{ ...LIGNES_IARD()[0], branche: incendiePrive }, LIGNES_IARD()[1], LIGNES_IARD()[2]], "Simulateur (inventé)", null);

    const r = await soumettre(commercial, id, null);
    expect(r.statut).toBe("EMISE");
    expect(r.numero).toMatch(/^COT-/);
    const ligne = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } });
    expect(ligne.statut).toBe("EMISE");
    expect(ligne.numero).toBe(r.numero);
    expect(estComposition(ligne.donneesCalcul as unknown)).toBe(true);
    // Les taux sont écrits dans la donnée figée (12,5 / 7,25 / 7,25), avec l'assiette de chaque taxe.
    const figee = ligne.donneesCalcul as unknown as EntreeComposition;
    expect(figee.lignes.map((l) => [l.tauxPourcent, l.assiette])).toEqual([["12.5", "NETTE_ACCESSOIRES"], ["7.25", "NETTE_ACCESSOIRES"], ["7.25", "NETTE_ACCESSOIRES"]]);
    // Échéancier en 4 tranches de 36 424 / 4 = 9 106.
    expect((await lireCotation(commercial, id))!.echeancier?.map((t) => t.montant.toFixed())).toEqual(["9106", "9106", "9106", "9106"]);

    // Les taux sont figés : une nouvelle taxe incendie (15 %) à partir de 2025-06-01 ne change rien à la cotation émise.
    const avant = (await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed();
    await creerTaxe(technique, { branche: incendiePrive, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "15", assiette: "NETTE_ACCESSOIRES", dateEffet: "2025-06-01", dateFin: null }, null);
    expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toFixed()).toBe(avant);

    // Acceptation en entier : un code de formule transmis n'a pas de sens ici et est ignoré ; la police reprend la composition telle quelle.
    const { numeroPolice: np } = await accepter(commercial, id, ["FORMULE_INEXISTANTE"], numeroPolice(), null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: np } });
    expect(police.formulesRetenues).toEqual([]);
    expect(estComposition(police.donneesCalcul as unknown)).toBe(true);
    expect((police.donneesCalcul as unknown as EntreeComposition).lignes).toEqual(figee.lignes); // taux, assiettes et montants identiques, au caractère près
    expect(police.ttcTotal.toFixed()).toBe("36424");
    expect((police.echeancier as { montant: string }[]).map((t) => t.montant)).toEqual(["9106", "9106", "9106", "9106"]);
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
    // Bornes exactes : 3 caractères (après suppression des espaces autour) et 500 caractères sont acceptés.
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), " abc ", null)).resolves.toMatchObject({ ttc: "36424" });
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "x".repeat(500), null)).resolves.toMatchObject({ ttc: "36424" });
    expect((await lireCotation(commercial, id))!.composition!.motif).toBe("x".repeat(500));
  });

  it("celui qui a composé ne peut pas valider (T13, H9) ; un Commercial ne le peut pas faute de droit ; un autre valideur de la Technique valide", async () => {
    const code = await produitGaranties({ seuilValidationTtc: "30000" });
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Simulateur (inventé)", null);
    // TTC 36 424 > seuil 30 000 : la cotation attend un valideur.
    expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");
    expect((await lireCotation(commercial, id))!.raisonsValidation).toEqual(["SEUIL_DEPASSE"]);

    await expect(valider(technique, id, null)).rejects.toThrow(/modifié cette cotation/);
    await expect(valider(commercial, id, null)).rejects.toThrow(ErreurAcces); // refusé faute de droit « Valider », pas par séparation des tâches
    const numero = await valider(technique2, id, null);
    expect(numero).toMatch(/^COT-/);
    expect((await lireCotation(commercial, id))!).toMatchObject({ statut: "EMISE" });
  });

  it("l'auteur du brouillon ne valide pas non plus, alors qu'il a le droit de valider (séparation des tâches) ; un troisième valideur de la Technique le peut", async () => {
    const code = await produitGaranties({ seuilValidationTtc: "30000" });
    const id = await creerBrouillon(technique2, saisie(code), null); // la Technique 2 est l'AUTEUR
    await composerLaPrime(technique, id, LIGNES_IARD(), "Simulateur (inventé)", null); // la Technique 1 compose
    expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");
    await expect(valider(technique2, id, null)).rejects.toThrow(/propre cotation/);
    await expect(valider(technique, id, null)).rejects.toThrow(/modifié cette cotation/);
    expect((await lireCotation(commercial, id))!.statut).toBe("A_VALIDER");
    expect(await valider(technique3, id, null)).toMatch(/^COT-/);
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
    await expect(composerLaPrime(technique, id, ligne(sansTaux), "Essai de composition", null)).rejects.toThrow(new RegExp(`Aucune taxe en vigueur pour la branche « ${sansTaux} »`));

    const mixte = `MIX_${CODE("B")}`.slice(0, 20);
    await assurerBranche(mixte);
    await creerTaxe(technique, { branche: mixte, typeContrat: null, tauxMixte: true, commentaire: "12,5 % / 7,25 %", tauxPourcent: null, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
    await expect(composerLaPrime(technique, id, ligne(mixte), "Essai de composition", null)).rejects.toThrow(new RegExp(`Branche « ${mixte} » : taux mixte`));

    const desactivee = `OFF_${CODE("B")}`.slice(0, 20);
    await assurerBranche(desactivee);
    await taxe(desactivee, "5");
    await obtenirPrisma().branche.update({ where: { code: desactivee }, data: { actif: false } });
    await expect(composerLaPrime(technique, id, ligne(desactivee), "Essai de composition", null)).rejects.toThrow(new RegExp(`La branche « ${desactivee} » est désactivée`));
  });

  it("saisie libre interdite : seuls les libellés de la liste du produit sont acceptés (sans casse)", async () => {
    const code = await produitGaranties({ garantiesSaisieLibre: false });
    const id = await creerBrouillon(commercial, saisie(code), null);
    await expect(composerLaPrime(technique, id, [{ libelle: "Bris de glace", branche: IARD, primeNette: "1000", accessoires: "0" }], "Essai de composition", null)).rejects.toThrow(/n'est pas une garantie de ce produit/);
    // Vol, 1 000 + 0 à 7,25 % : taxe 72,5 → 73 (le plus proche, la moitié en haut), TTC 1 073 ; le libellé est enregistré sans espaces de bord.
    await expect(composerLaPrime(technique, id, [{ libelle: "  vol ", branche: IARD, primeNette: "1000", accessoires: "0" }], "Essai de composition", null)).resolves.toMatchObject({ ttc: "1073" });
    expect((await lireCotation(commercial, id))!.composition!.lignes[0].libelle).toBe("vol");
  });

  it("un produit à la formule ne se compose pas", async () => {
    const code = CODE("FORM");
    await creerProduit(technique, { code, libelle: "À la formule (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: SANTE }, null);
    await creerVersion(technique, code, { ...versionGaranties(), modeTarification: "FORMULE", garanties: [], formules: [{ code: "F", libelle: "F", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" }] }, null);
    const id = await creerBrouillon(commercial, saisie(code, { lignes: [{ codeFormule: "F", effectif: 1 }] }), null);
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "Essai de composition", null)).rejects.toThrow(/se tarifie à la formule/);
    await expect(creerBrouillon(commercial, saisie(code, { lignes: [{ codeFormule: "F", effectif: 1 }], composition: LIGNES_IARD() }), null)).rejects.toThrow(/ne se compose pas/);
  });
});

describe("modification d'un brouillon composé et paramétrage de la version", () => {
  it("le Commercial modifie le souscripteur du brouillon composé : la composition est conservée telle quelle et les contributeurs sont tenus à jour", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, [{ libelle: "Santé", branche: SANTE, primeNette: "200000", accessoires: "0" }], "Simulateur (inventé)", null);
    await modifierBrouillon(commercial, id, saisie(code, { souscripteur: { ...prospect, nom: "AUTRE" } }), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.composition!.lignes).toHaveLength(1);
    expect(c.composition).toMatchObject({ composePar: technique.identifiant, motif: "Simulateur (inventé)" });
    expect(c.resultat.totaux.arrondi.taxe.toFixed()).toBe("8000"); // régime Individuel : 4 %
    expect(c.souscripteur.nom).toBe("AUTRE");
    expect(c.contributeurs).toEqual(expect.arrayContaining([commercial.id, technique.id]));
  });

  it("la date d'effet choisit le taux : 4 % avant le 01/03/2026, 1,5 % à partir de cette date, à la composition (le Commercial qui change les dates vide la composition : H98)", async () => {
    const code = await produitGaranties();
    const ligne = [{ libelle: "Santé", branche: SANTE_DATEE, primeNette: "200000", accessoires: "0" }];
    const taxeDe = async (id: number) => (await lireCotation(commercial, id))!.resultat.totaux.arrondi.taxe.toFixed();

    const tot = await creerBrouillon(commercial, saisie(code, { dateEffet: "2026-02-15", dateEcheance: "2027-02-14" }), null);
    await composerLaPrime(technique, tot, ligne, "Santé, effet en février (inventé)", null);
    expect(await taxeDe(tot)).toBe("8000"); // 200 000 × 4 %
    expect((await lireCotation(commercial, tot))!.composition!.lignes[0].tauxPourcent).toBe("4");

    const tard = await creerBrouillon(commercial, saisie(code, { dateEffet: "2026-03-01", dateEcheance: "2027-02-28" }), null);
    await composerLaPrime(technique, tard, ligne, "Santé, effet en mars (inventé)", null);
    expect(await taxeDe(tard)).toBe("3000"); // 200 000 × 1,5 %

    // Le Commercial avance la date d'effet du premier brouillon au 01/03 : la composition est vidée (H98), puis la Technique recompose au nouveau taux.
    await modifierBrouillon(commercial, tot, saisie(code, { dateEffet: "2026-03-01", dateEcheance: "2027-02-28" }), null);
    await composerLaPrime(technique, tot, ligne, "Santé, effet en mars, recomposée (inventé)", null);
    expect(await taxeDe(tot)).toBe("3000");
    expect((await lireCotation(commercial, tot))!.composition!.lignes[0]).toMatchObject({ primeNette: "200000", tauxPourcent: "1.5" });
    // Le journal de la modification garde les dates avant / après.
    const journal = (await lireJournal({ action: "COTATION_MODIFIEE" })).lignes.filter((l) => l.objet === `cotation ${tot}`);
    expect(journal).toHaveLength(1);
    expect(journal[0].avant).toMatchObject({ dateEffet: "2026-02-15", dateEcheance: "2027-02-14", nombreTranches: 1, ttc: "208000" });
    expect(journal[0].apres).toMatchObject({ dateEffet: "2026-03-01", dateEcheance: "2027-02-28", nombreTranches: 1, ttc: null });
  });

  it("une version par garanties n'a pas besoin de formule ; ses frais de fractionnement et une liste de garanties à la formule sont refusés", async () => {
    const code = CODE("VER");
    await creerProduit(technique, { code, libelle: "Version (test)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
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
    await creerProduit(technique, { code, libelle: "Frais (test)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
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

describe("règle d'arrondi du produit, assiette de la taxe, fractionnement (voie du serveur)", () => {
  it("au supérieur à 100 F : niveau « ligne » = taxe 3 200 et TTC 36 600 ; niveau « total » = taxe 3 100 et TTC 36 500 (les lignes restent arrondies une à une)", async () => {
    for (const [niveau, taxeTotale, ttc] of [["LIGNE", "3200", "36600"], ["TOTAL", "3100", "36500"]] as const) {
      const code = await produitGaranties({ arrondi: { precision: 100, sens: "SUPERIEUR", niveau, composanteAbsorbante: "TAXE" } });
      const id = await creerBrouillon(commercial, saisie(code), null);
      const r = await composerLaPrime(technique, id, LIGNES_IARD(), `Arrondi ${niveau} (inventé)`, null);
      expect(r.ttc, niveau).toBe(ttc);
      const c = (await lireCotation(commercial, id))!;
      expect(c.resultat.totaux.arrondi.taxe.toFixed(), niveau).toBe(taxeTotale);
      // Lignes : Incendie 10 000 + 2 500 + 1 600 ; Vol 9 900 + 2 500 + 900 ; Dégât des eaux 6 000 + 2 500 + 700.
      expect(c.resultat.lignes.map((l) => l.arrondi.ttc.toFixed()), niveau).toEqual(["14100", "13300", "9200"]);
      expect((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).ttcTotal?.toFixed(), niveau).toBe(ttc);
    }
  });

  it("assiette « nette seule » d'une taxe : les accessoires ne sont pas taxés ; la composition figée et les montants des documents le disent", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, [{ libelle: "Garantie hors accessoires", branche: NETTE, primeNette: "10000", accessoires: "2500" }], "Assiette nette (inventée)", null);
    // 10 000 × 10 % = 1 000 (les 2 500 d'accessoires ne sont pas taxés) ; TTC 10 000 + 2 500 + 1 000 = 13 500.
    const c = (await lireCotation(commercial, id))!;
    expect(c.resultat.totaux.arrondi.taxe.toFixed()).toBe("1000");
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("13500");
    expect(c.composition!.lignes[0]).toMatchObject({ tauxPourcent: "10", assiette: "NETTE" });

    const ligne = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id }, include: { produit: true } });
    const m = montantsDu(ligne.donneesCalcul as unknown as EntreeComposition, await contexteProduit(ligne.produitId, ligne.versionDateEffet));
    expect(m.garanties![0]).toMatchObject({ nette: "10000", accessoires: "2500", tauxTaxe: "10", taxe: "1000", ttc: "13500", baseTaxe: "10000" });
    expect(m.totaux).toMatchObject({ taxe: "1000", ttc: "13500", baseTaxe: "10000" });
    expect(m.taxe).toEqual({ tauxPourcent: "10", assiette: "NETTE" }); // un seul taux : le taux global est rempli
  });

  it("fractionnement d'un TTC non divisible : 36 424 F en 3 tranches = 12 141, 12 141 et 12 142 (la dernière absorbe le reliquat) ; la somme fait le TTC", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code, { nombreTranches: 3 }), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Fractionnement (inventé)", null);
    const echeancier = (await lireCotation(commercial, id))!.echeancier!;
    // 36 424 / 3 = 12 141,33 : les deux premières tranches arrondies au franc, la dernière = 36 424 − 24 282.
    expect(echeancier.map((t) => [t.date, t.montant.toFixed()])).toEqual([["2026-01-01", "12141"], ["2026-05-01", "12141"], ["2026-09-01", "12142"]]);
    expect(echeancier.reduce((somme, t) => somme + Number(t.montant.toFixed()), 0)).toBe(36424);
  });

  it("repasser à une tranche efface l'échéancier : une recomposition ne laisse jamais les tranches d'une saisie précédente (elles ne sommeraient plus au TTC)", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code, { nombreTranches: 3 }), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Trois tranches (inventé)", null);
    expect((await lireCotation(commercial, id))!.echeancier).toHaveLength(3);

    await modifierBrouillon(commercial, id, saisie(code, { nombreTranches: 1 }), null);
    expect((await lireCotation(commercial, id))!.echeancier).toBeNull();
    expect((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).echeancier).toBeNull();

    // La Technique recompose à 13 245 F en une tranche : toujours aucun échéancier, jamais celui de 36 424 F.
    await composerLaPrime(technique, id, [LIGNES_IARD()[1]], "Une seule garantie (inventé)", null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("13245");
    expect(c.echeancier).toBeNull();
  });
});

describe("gardes de cohérence entre la composition et le mode du produit", () => {
  it("une cotation composée « À valider » ne s'émet plus si le produit repasse à la formule ; renvoyée en brouillon, elle ne se soumet pas non plus", async () => {
    const code = await produitGaranties({ seuilValidationTtc: "30000" });
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Simulateur (inventé)", null);
    expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");

    await repasserALaFormule(code);
    await expect(valider(technique2, id, null)).rejects.toThrow(MESSAGE_COMPOSITION_IMPOSSIBLE);
    const apres = (await lireCotation(technique2, id))!;
    expect(apres).toMatchObject({ statut: "A_VALIDER", numero: null });

    await renvoyerEnBrouillon(technique2, id, "Produit repassé à la formule", null);
    await expect(soumettre(commercial, id, null)).rejects.toThrow(/se tarifie à la formule/);
    await expect(composerLaPrime(technique, id, LIGNES_IARD(), "Trop tard", null)).rejects.toThrow(/se tarifie à la formule/);
    expect((await lireCotation(commercial, id))!).toMatchObject({ statut: "BROUILLON", numero: null });
  });

  it("ceinture : une composition vide ne s'émet jamais, même fabriquée en SQL dans une cotation « À valider »", async () => {
    const code = await produitGaranties({ seuilValidationTtc: "30000" });
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Simulateur (inventé)", null);
    expect((await soumettre(commercial, id, null)).statut).toBe("A_VALIDER");
    expect(await sql(`UPDATE cotations SET donnees_calcul = jsonb_set(donnees_calcul, '{lignes}', '[]'::jsonb) WHERE id = ${id}`)).toBe("accepté");

    await expect(valider(technique2, id, null)).rejects.toThrow(MESSAGE_NON_COMPOSEE);
    expect((await lireCotation(technique2, id))!).toMatchObject({ statut: "A_VALIDER", numero: null });
  });

  it("montantsDu : refuse une composition rattachée à une version à la formule et une composition vide ; par garanties, rend une ligne par garantie et la somme", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    const vide = (await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).donneesCalcul as unknown as EntreeComposition;
    await composerLaPrime(technique, id, LIGNES_IARD(), "Simulateur (inventé)", null);
    const cotation = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } });
    const composee = cotation.donneesCalcul as unknown as EntreeComposition;
    await repasserALaFormule(code);
    const produit = await obtenirPrisma().produit.findUniqueOrThrow({ where: { code } });
    const garanties = await contexteProduit(produit.id, cotation.versionDateEffet);
    const formule = await contexteProduit(produit.id, new Date(`${aujourdhui()}T00:00:00.000Z`));
    expect([garanties.modeTarification, formule.modeTarification]).toEqual(["GARANTIES", "FORMULE"]);

    expect(() => montantsDu(composee, formule)).toThrow(MESSAGE_COMPOSITION_IMPOSSIBLE);
    expect(() => montantsDu(vide, garanties)).toThrow(MESSAGE_NON_COMPOSEE);
    const m = montantsDu(composee, garanties);
    expect(m.formules).toEqual([]);
    expect(m.garanties!.map((g) => [g.libelle, g.branche, g.tauxTaxe, g.taxe, g.ttc])).toEqual([
      ["Incendie", INCENDIE, "12.5", "1563", "14063"],
      ["Vol", IARD, "7.25", "895", "13245"],
      ["Dégât des eaux", IARD, "7.25", "616", "9116"],
    ]);
    expect(m.totaux).toMatchObject({ nette: "25850", accessoires: "7500", taxe: "3074", ttc: "36424", baseTaxe: "33350" });
    expect(m.taxe.tauxPourcent).toBeNull(); // plusieurs taux : le taux global est vide
  });

  it("T10 : une cotation composée émise reste acceptable quand le produit repasse à la formule ; la police garde la composition et ses montants", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Simulateur (inventé)", null);
    expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");

    await repasserALaFormule(code);
    const { numeroPolice: np } = await accepter(commercial, id, [], numeroPolice(), null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: np } });
    expect(estComposition(police.donneesCalcul as unknown)).toBe(true);
    expect(police.ttcTotal.toFixed()).toBe("36424");
  });
});

describe("import en masse des adhérents d'une police de groupe composée", () => {
  let racine = 0;
  const numeroGroupe = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-G${String(++racine).padStart(5, "0")}`;

  /** Police mère de groupe dont la prime est composée : aucune formule, aucun assuré à formule. */
  async function policeComposeeDeGroupe(): Promise<{ policeId: number }> {
    const code = await produitGaranties();
    const assures = [1, 2].map((ordre) => ({ ordre, nom_prenoms: `Existant ${ordre} Inventé`, date_naissance: `1980-01-0${ordre}`, sexe: "M" as const, lien: "Salarié", formule: "" }));
    const id = await creerBrouillon(commercial, saisie(code, { typeContrat: "GROUPE", assures, beneficiaires: [], contactsUrgence: [] }), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Groupe composé (inventé)", null);
    await soumettre(commercial, id, null);
    const { numeroPolice: np } = await accepter(commercial, id, [], numeroGroupe(), null);
    return { policeId: (await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: np } })).id };
  }
  const csv = (contenu: string) => ({ nom: "adherents.csv", contenu: new TextEncoder().encode(contenu) });

  it("la colonne « formule » peut manquer ou rester vide ; une formule saisie est refusée avec un message qui l'explique", async () => {
    const { policeId } = await policeComposeeDeGroupe();
    const sansColonne = await controlerImport(technique, policeId, "2026-07-01", csv("nom_prenoms;date_naissance\nAwa Inventée;14/03/1988"), null);
    expect(await lireLot(technique, sansColonne)).toMatchObject({ statut: "CONTROLE", total: 1, valides: 1, erreurs: 0 });

    const avecColonne = await controlerImport(technique, policeId, "2026-07-01", csv("nom_prenoms;date_naissance;formule\nAwa Inventée;14/03/1988;\nKofi Inventé;01/01/1990;SOLO"), null);
    const lot = (await lireLot(technique, avecColonne))!;
    expect(lot).toMatchObject({ total: 2, valides: 1, erreurs: 1 });
    expect(lot.lignesEnErreur.map((l) => l.numero)).toEqual([3]);
    expect(JSON.stringify(lot.lignesEnErreur[0])).toMatch(/tarifée par garanties/);
  });

  it("le fichier modèle d'un produit par garanties laisse la colonne « formule » vide et sans liste de choix", async () => {
    const code = await produitGaranties();
    const { contenu } = await modeleImport(technique, code);
    const ExcelJS = (await import("exceljs")).default;
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(Buffer.from(contenu) as unknown as ArrayBuffer);
    const feuille = classeur.getWorksheet("Adhérents")!;
    const colonne = (cle: string) => (feuille.getRow(1).values as unknown[]).slice(1).indexOf(cle) + 1;
    expect(feuille.getRow(2).getCell(colonne("formule")).value ?? "").toBe("");
    expect(feuille.getRow(3).getCell(colonne("formule")).dataValidation).toBeUndefined();
    // La liste des sexes, elle, est bien posée sur la colonne « sexe » (la lettre se déduit de l'ordre des colonnes).
    expect(feuille.getRow(3).getCell(colonne("sexe")).dataValidation?.formulae).toEqual(['"M,F"']);
  });
});

describe("H98 : changer la période, le régime ou le type de contrat vide la composition", () => {
  async function composee(surcharge: Partial<SaisieCotation> = {}) {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code, surcharge), null);
    await composerLaPrime(technique, id, LIGNES_IARD(), "Calcul du simulateur (inventé)", null);
    return { code, id };
  }
  const videe = async (id: number) => {
    const c = (await lireCotation(commercial, id))!;
    const ligne = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } });
    return { c, ligne };
  };

  it.each([
    ["la date d'effet", { dateEffet: "2026-02-01" }, "la période"],
    ["la date d'échéance", { dateEcheance: "2027-06-30" }, "la période"],
    ["le régime de taxe", { regimeTaxe: "GROUPE" as const }, "le régime de taxe"],
    ["le type de contrat", { typeContrat: "GROUPE" as const }, "le type de contrat"],
  ])("changer %s : retour « À composer » (prime et TTC absents, auteur et motif effacés), message, soumission refusée, ancienne composition au journal", async (_quoi, changement, raison) => {
    const { code, id } = await composee();
    const r = await modifierBrouillon(commercial, id, saisie(code, changement), null);
    expect(r).toEqual({ compositionVidee: true });

    const { c, ligne } = await videe(id);
    expect(c.composition).toMatchObject({ lignes: [], composePar: null, composeLe: null, motif: null });
    expect(ligne.ttcTotal).toBeNull();
    expect([ligne.compositionParId, ligne.compositionPar, ligne.compositionLe, ligne.compositionMotif]).toEqual([null, null, null, null]);
    expect((await listerCotations(technique)).find((x) => x.id === id)).toMatchObject({ aComposer: true, ttc: null });
    await expect(soumettre(commercial, id, null)).rejects.toThrow(MESSAGE_NON_COMPOSEE);

    // L'ancienne composition est au journal : lignes, TTC, composeur, motif, et ce qui a déclenché le vidage.
    const j = (await lireJournal({ action: "COTATION_COMPOSITION_VIDEE" })).lignes.filter((l) => l.objet === `cotation ${id}`);
    expect(j).toHaveLength(1);
    expect((j[0].avant as { lignes: unknown[] }).lignes).toHaveLength(3);
    expect(j[0].avant).toMatchObject({ ttc: "36424", composePar: technique.identifiant, motif: "Calcul du simulateur (inventé)" });
    expect(j[0].apres).toMatchObject({ retour: "À composer" });
    expect(String((j[0].apres as { raison: string }).raison)).toContain(raison); // un type de contrat qui change entraîne aussi son régime proposé

    // La Technique peut recomposer ensuite (nouveau composeur, nouveau motif).
    await expect(composerLaPrime(technique2, id, LIGNES_IARD(), "Recomposition après changement (inventée)", null)).resolves.toMatchObject({ ttc: expect.any(String) });
  });

  it("changer le nombre de tranches garde la composition (seul l'échéancier change) ; enregistrer sans rien changer, ou changer le souscripteur, aussi", async () => {
    const { code, id } = await composee({ nombreTranches: 2 });
    expect(await modifierBrouillon(commercial, id, saisie(code, { nombreTranches: 4 }), null)).toEqual({ compositionVidee: false });
    let { c } = await videe(id);
    expect(c.composition).toMatchObject({ composePar: technique.identifiant, motif: "Calcul du simulateur (inventé)" });
    expect(c.composition!.lignes).toHaveLength(3);
    expect(c.resultat.totaux.arrondi.ttc.toFixed()).toBe("36424");
    expect(c.echeancier).toHaveLength(4);

    expect(await modifierBrouillon(commercial, id, saisie(code, { nombreTranches: 4 }), null)).toEqual({ compositionVidee: false });
    expect(await modifierBrouillon(commercial, id, saisie(code, { nombreTranches: 4, souscripteur: { ...prospect, nom: "AUTRE" } }), null)).toEqual({ compositionVidee: false });
    ({ c } = await videe(id));
    expect(c.composition!.lignes).toHaveLength(3);
    expect((await lireJournal({ action: "COTATION_COMPOSITION_VIDEE" })).lignes.filter((l) => l.objet === `cotation ${id}`)).toHaveLength(0);
  });

  it("un brouillon déjà « À composer » qui change de période n'a rien à vider : pas d'entrée de journal de vidage", async () => {
    const code = await produitGaranties();
    const id = await creerBrouillon(commercial, saisie(code), null);
    expect(await modifierBrouillon(commercial, id, saisie(code, { dateEffet: "2026-02-01" }), null)).toEqual({ compositionVidee: false });
    expect((await lireJournal({ action: "COTATION_COMPOSITION_VIDEE" })).lignes.filter((l) => l.objet === `cotation ${id}`)).toHaveLength(0);
  });

  it("la Technique qui modifie la période d'un brouillon qu'elle a composé le vide aussi (la règle ne dépend pas de qui modifie)", async () => {
    const { code, id } = await composee();
    expect(await modifierBrouillon(technique, id, saisie(code, { dateEcheance: "2027-03-31" }), null)).toEqual({ compositionVidee: true });
    expect((await lireCotation(technique, id))!.composition!.lignes).toEqual([]);
  });
});
