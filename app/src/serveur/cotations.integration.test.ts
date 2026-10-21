// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ajouterJours, ajouterMois, fixerDateMinimumEffetPourTests, MESSAGE_DATE_EFFET_PASSEE } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import { FORMAT_NUMERO_POLICE_DEFAUT } from "@/domaine/cotation/police";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "./branches-test";
import { lireJournal } from "./audit";
import { creerClient, initialiserMotifsRefus } from "./clients";
import {
  accepter,
  creerBrouillon,
  expirerCotations,
  lireCotation,
  listerCotations,
  modifierBrouillon,
  refuser,
  renvoyerEnBrouillon,
  soumettre,
  valider,
  type SaisieCotation,
} from "./cotations";
import { enregistrerDroit, initialiserProfilsEtDroits } from "./droits";
import { allouerNumero } from "./numerotation";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { enregistrerFormatNumeroPolice, lireFormatNumeroPolice } from "./societe";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let technique2: UtilisateurCourant;
let commercial: UtilisateurCourant;
let gestionnaire: UtilisateurCourant;
let dg: UtilisateurCourant;
let comptabilite: UtilisateurCourant;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

const CODE = unique("COT").toUpperCase().replace(/-/g, "_");
const BRANCHE = `SANTE_${CODE}`;
const prospect: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Test", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" };

/** Produit de test inspiré de l'offre BENI (T1) ; seuil de double validation à 20 000 000 F, validité 3 mois. */
const versionBeni = (): VersionSaisie => ({
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
});

/** Cotation T1 par défaut : 3 Solo + 60 Famille = 15 888 000 F (sous le seuil de 20 000 000). Contrat GROUPE (taux 1,5 %). */
const saisie = (surcharge: Partial<SaisieCotation> = {}): SaisieCotation => ({
  codeProduit: CODE,
  clientId: null,
  typeContrat: "GROUPE",
  souscripteur: prospect,
  dateEffet: "2026-01-01",
  dateEcheance: "2026-12-31",
  nombreTranches: 4,
  lignes: [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }],
  motifForcage: null,
  assures: [],
  beneficiaires: null,
  contactsUrgence: null,
  risque: {},
  ...surcharge,
});

/** Numéro de police inventé, conforme au format par défaut (H10, H31), unique d'un test à l'autre. */
let compteurPolice = 0;
const numeroPolice = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-G${String(++compteurPolice).padStart(5, "0")}`;

/** Au-dessus du seuil : 100 familles = 26 000 000 F. */
const grosse = () => saisie({ lignes: [{ codeFormule: "FAMILLE", effectif: 100 }] });

async function emise(auteur = commercial, s = saisie()): Promise<number> {
  const id = await creerBrouillon(auteur, s, null);
  const r = await soumettre(auteur, id, null);
  expect(r.statut).toBe("EMISE");
  return id;
}

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
  await initialiserProfilsEtDroits();
  await initialiserMotifsRefus();
  const id = unique("admin");
  await creerAdministrateurInitial({ identifiant: id, nom: "Admin", motDePasse: MDP });
  admin = await compte(id);
  [technique, technique2, commercial, gestionnaire, dg, comptabilite] = [
    await nouveauCompte("TECHNIQUE"),
    await nouveauCompte("TECHNIQUE"),
    await nouveauCompte("COMMERCIAL"),
    await nouveauCompte("GESTIONNAIRE_PRODUCTION"),
    await nouveauCompte("DIRECTION_GENERALE"),
    await nouveauCompte("COMPTABILITE"),
  ];
  await assurerBranche(BRANCHE);
  await creerTaxe(technique, { branche: BRANCHE, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code: CODE, libelle: "Santé BENI (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: BRANCHE }, null);
  await creerVersion(technique, CODE, versionBeni(), null);
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2026-01-01T00:00:00.000Z") } },
    update: { valeur: "20000000" },
    create: { cle: "seuil_validation_global", valeur: "20000000", dateEffet: new Date("2026-01-01T00:00:00.000Z"), creePar: "test" },
  });
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2026-01-01T00:00:00.000Z") } },
    update: { valeur: "10000000" },
    create: { cle: "seuil_validation_global", valeur: "10000000", dateEffet: new Date("2026-01-01T00:00:00.000Z"), creePar: "test" },
  });
  await obtenirPrisma().parametre.deleteMany({
    where: { cle: "seuil_validation_global", dateEffet: { not: new Date("2026-01-01T00:00:00.000Z") } },
  });
  await obtenirPrisma().$disconnect();
});

describe("T1 : cotation BENI, de la saisie à l'émission", () => {
  it("un brouillon porte les montants du moteur (15 888 000) et n'a pas de numéro", async () => {
    const id = await creerBrouillon(commercial, saisie(), null);
    const c = (await lireCotation(commercial, id))!;

    expect(c.statut).toBe("BROUILLON");
    expect(c.numero).toBeNull();
    expect(c.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    expect(c.resultat.lignes.map((l) => l.arrondi.ttc.toString())).toEqual(["288000", "15600000"]);
    expect(c.echeancier?.map((t) => t.montant.toString())).toEqual(["3972000", "3972000", "3972000", "3972000"]);
  });

  it("l'émission attribue COT-AAAA-MM-NNNN et fixe la validité à « date + 3 mois »", async () => {
    const id = await creerBrouillon(commercial, saisie(), null);
    const r = await soumettre(commercial, id, null);
    const c = (await lireCotation(commercial, id))!;
    const aujourdhuiIso = aujourdhui();

    expect(r.statut).toBe("EMISE");
    expect(c.numero).toMatch(/^COT-\d{4}-\d{2}-\d{4}$/);
    expect(c.numero).toContain(`COT-${aujourdhuiIso.slice(0, 4)}-${aujourdhuiIso.slice(5, 7)}-`);
    expect(c.dateEtablissement).toBe(aujourdhuiIso);
    expect(c.dateValidite).toBe(ajouterMois(aujourdhuiIso, 3));
    expect(c.statutEffectif).toBe("EMISE");
    expect(c.filigrane).toBeNull();
  });

  it("le résultat recalculé depuis les paramètres figés est identique au résultat stocké", async () => {
    const id = await emise();
    const brut = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } });
    const c = (await lireCotation(commercial, id))!;

    expect((brut.resultat as { totaux: { ttc: string } }).totaux.ttc).toBe(c.resultat.totaux.arrondi.ttc.toFixed());
    expect(brut.ttcTotal!.toFixed(0)).toBe("15888000");
  });
});

describe("cotation figée dès l'émission (CDC §4.1)", () => {
  it("refuse toute modification d'une cotation émise : par l'application et en SQL direct", async () => {
    const id = await emise();
    const prisma = obtenirPrisma();

    await expect(modifierBrouillon(commercial, id, saisie({ nombreTranches: 2 }), null)).rejects.toThrow(/figée/);
    await expect(prisma.$executeRawUnsafe(`UPDATE cotations SET lignes = '[]'::jsonb WHERE id = ${id}`)).rejects.toThrow(/cotation figée/);
    await expect(prisma.$executeRawUnsafe(`UPDATE cotations SET ttc_total = 1 WHERE id = ${id}`)).rejects.toThrow(/cotation figée/);
    await expect(prisma.$executeRawUnsafe(`UPDATE cotations SET numero = 'COT-X' WHERE id = ${id}`)).rejects.toThrow(/cotation figée/);
    await expect(prisma.$executeRawUnsafe(`UPDATE cotations SET statut = 'BROUILLON' WHERE id = ${id}`)).rejects.toThrow(/cotation figée/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM cotations WHERE id = ${id}`)).rejects.toThrow(/suppression interdite/);
  });

  it("H9 : tout agent ayant le droit de modifier une cotation modifie le brouillon d'un autre, et c'est tracé", async () => {
    const id = await creerBrouillon(commercial, saisie(), null);

    await expect(modifierBrouillon(gestionnaire, id, saisie({ nombreTranches: 2 }), null)).resolves.toEqual({ compositionVidee: false });
    const c = (await lireCotation(commercial, id))!;
    expect(c.nombreTranches).toBe(2);
    expect(c.contributeurs).toEqual(expect.arrayContaining([commercial.id, gestionnaire.id]));
    const journal = (await lireJournal({ action: "COTATION_MODIFIEE" })).lignes.filter((l) => l.objet === `cotation ${id}`);
    expect(journal.map((l) => l.utilisateur)).toContain(gestionnaire.identifiant);
    await expect(modifierBrouillon(dg, id, saisie(), null)).rejects.toBeInstanceOf(ErreurAcces); // la DG n'a pas ce droit
  });

  it("refuse une cotation sans type de contrat", async () => {
    await expect(creerBrouillon(commercial, saisie({ typeContrat: "" }), null)).rejects.toThrow(/type de contrat/);
    await expect(creerBrouillon(commercial, saisie({ typeContrat: "COLLECTIF" }), null)).rejects.toThrow(/type de contrat/);
  });

  it("régime de taxe (H29 fermée, 09/10/2026) : c'est lui qui choisit le taux, pas le type de contrat ; obligatoire", async () => {
    // Le produit n'a qu'un taux « Groupe » (1,5 %) : un contrat FAMILLE au régime Groupe le prend…
    const id = await creerBrouillon(commercial, saisie({ typeContrat: "FAMILLE", regimeTaxe: "GROUPE" }), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c).toMatchObject({ typeContrat: "FAMILLE", regimeTaxe: "GROUPE" });
    expect(c.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    // … au régime Individuel, aucun taux : refus lisible.
    await expect(creerBrouillon(commercial, saisie({ typeContrat: "GROUPE", regimeTaxe: "INDIVIDUEL" }), null)).rejects.toThrow(/régime individuel/);
    // Régime proposé (appel sans formulaire) : celui du type de contrat. Envoyé vide ou invalide : refusé.
    expect((await lireCotation(commercial, await creerBrouillon(commercial, saisie(), null)))!.regimeTaxe).toBe("GROUPE");
    await expect(creerBrouillon(commercial, saisie({ regimeTaxe: "" }), null)).rejects.toThrow(/régime de taxe/);
    await expect(creerBrouillon(commercial, saisie({ regimeTaxe: "FAMILLE" }), null)).rejects.toThrow(/régime de taxe/);
    // Le changement de régime d'un brouillon est tracé avec la modification.
    await modifierBrouillon(commercial, id, saisie({ typeContrat: "FAMILLE", regimeTaxe: "GROUPE", nombreTranches: 1 }), null);
    expect((await lireCotation(commercial, id))!.regimeTaxe).toBe("GROUPE");
  });

  it("le régime de taxe choisi est gardé à la soumission : une famille passée en régime Groupe reste en Groupe, au même taux (défaut de la 6.0 : la soumission le remplaçait par le régime proposé pour le type de contrat) ; T1 inchangé", async () => {
    // Famille au régime Groupe (le seul taux du produit : 1,5 %), 15 888 000 F au brouillon.
    const id = await creerBrouillon(commercial, saisie({ typeContrat: "FAMILLE", regimeTaxe: "GROUPE" }), null);
    expect((await lireCotation(commercial, id))!.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    // La soumission reconstruit la saisie depuis la base : avant la correction, le régime Groupe redevenait Individuel (régime proposé pour une famille),
    // sans taux en vigueur, et la soumission échouait ; avec un taux Individuel, elle aurait émis un TTC différent.
    expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
    const soumise = (await lireCotation(commercial, id))!;
    expect(soumise).toMatchObject({ typeContrat: "FAMILLE", regimeTaxe: "GROUPE", statut: "EMISE" });
    expect(soumise.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    // T1 (contrat de groupe, régime proposé) : les montants ne bougent pas d'un franc.
    const t1 = (await lireCotation(commercial, await emise(commercial)))!;
    expect(t1.regimeTaxe).toBe("GROUPE");
    expect(t1.resultat.totaux.arrondi.ttc.toString()).toBe("15888000");
    expect(t1.resultat.lignes.map((l) => l.arrondi.ttc.toString())).toEqual(["288000", "15600000"]);
  });
});

describe("numérotation continue et sans trou (CDC §11.4)", () => {
  it("8 émissions simultanées reçoivent 8 numéros consécutifs, sans doublon ni trou", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => creerBrouillon(commercial, saisie(), null)));
    await Promise.all(ids.map((id) => soumettre(commercial, id, null)));

    const numeros = (await Promise.all(ids.map((id) => lireCotation(commercial, id)))).map((c) => Number(c!.numero!.slice(-4))).sort((a, b) => a - b);

    expect(new Set(numeros).size).toBe(8);
    expect(numeros[7] - numeros[0]).toBe(7);
  });

  it("une émission annulée ne laisse aucun trou", async () => {
    const prisma = obtenirPrisma();
    const date = aujourdhui();
    const avant = await prisma.$transaction((tx) => allouerNumero(tx, "FAC", date));
    await expect(
      prisma.$transaction(async (tx) => {
        await allouerNumero(tx, "FAC", date);
        throw new Error("échec après l'attribution du numéro");
      }),
    ).rejects.toThrow(/échec/);
    const apres = await prisma.$transaction((tx) => allouerNumero(tx, "FAC", date));

    expect(Number(apres.slice(-4))).toBe(Number(avant.slice(-4)) + 1);
  });

  it("chaque type de document a son propre compteur, qui avance de 1 en 1", async () => {
    const prisma = obtenirPrisma();
    const date = aujourdhui();
    const alloue = async (p: "AV" | "REC") => Number((await prisma.$transaction((tx) => allouerNumero(tx, p, date))).slice(-4));
    const [av1, rec1] = [await alloue("AV"), await alloue("REC")];
    const [av2, rec2] = [await alloue("AV"), await alloue("REC")];

    expect(av2).toBe(av1 + 1);
    expect(rec2).toBe(rec1 + 1); // les avoirs n'ont pas fait avancer les reçus, ni l'inverse
  });
});

describe("T13 : forçage de prime et double validation", () => {
  const forcee = () => saisie({ lignes: [{ codeFormule: "SOLO", effectif: 3, primeForcee: "80000" }, { codeFormule: "FAMILLE", effectif: 60 }], motifForcage: "Remise accordée par la Direction" });

  it("prime forcée par un commercial : « À valider », sans numéro ; l'auteur ne peut pas valider", async () => {
    const id = await creerBrouillon(commercial, forcee(), null);
    const r = await soumettre(commercial, id, null);
    const c = (await lireCotation(commercial, id))!;

    expect(r).toEqual({ statut: "A_VALIDER", numero: null });
    expect(c.statut).toBe("A_VALIDER");
    expect(c.numero).toBeNull();
    expect(c.raisonsValidation).toEqual(["PRIME_FORCEE"]);
    expect(c.lignes[0]).toMatchObject({ code: "SOLO", primeTarif: "93581.33", primeForcee: "80000" });
    expect(c.resultat.lignes[0].exact.nette.toString()).toBe("240000"); // 3 × 80 000 : la prime forcée est celle du calcul
    await expect(valider(commercial, id, null)).rejects.toBeInstanceOf(ErreurAcces); // le commercial n'a pas le droit « Valide »
  });

  it("un valideur (Technique) autre que l'auteur valide : la cotation est émise avec son numéro", async () => {
    const id = await creerBrouillon(commercial, forcee(), null);
    await soumettre(commercial, id, null);

    const numero = await valider(technique, id, null);
    const c = (await lireCotation(commercial, id))!;

    expect(numero).toMatch(/^COT-/);
    expect(c.statut).toBe("EMISE");
    expect(c.numero).toBe(numero);
    const brut = await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } });
    expect(brut.valideParId).toBe(technique.id);
    await expect(valider(technique2, id, null)).rejects.toThrow(/pas à valider/); // déjà émise
  });

  it("l'auteur ne peut pas valider sa propre cotation, même s'il a le droit « Valide » (Technique)", async () => {
    const id = await creerBrouillon(technique, forcee(), null);
    await soumettre(technique, id, null);

    await expect(valider(technique, id, null)).rejects.toThrow(/propre cotation/);
    await expect(valider(technique2, id, null)).resolves.toMatch(/^COT-/);
  });

  it("le forçage exige un motif, même minime ; une prime identique au tarif n'est pas un forçage", async () => {
    await expect(
      creerBrouillon(commercial, saisie({ lignes: [{ codeFormule: "SOLO", effectif: 1, primeForcee: "93581.34" }] }), null),
    ).rejects.toThrow(/motif/);
    const id = await creerBrouillon(commercial, saisie({ lignes: [{ codeFormule: "SOLO", effectif: 1, primeForcee: "93581.33" }] }), null);
    expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
  });

  it("un TTC au-dessus du seuil passe « À valider » sans forçage ; la Technique et la DG valident (étape 3, fin écart D21)", async () => {
    const id = await creerBrouillon(gestionnaire, grosse(), null);
    const r = await soumettre(gestionnaire, id, null);

    expect(r.statut).toBe("A_VALIDER");
    expect((await lireCotation(gestionnaire, id))!.raisonsValidation).toEqual(["SEUIL_DEPASSE"]);
    // Fin écart D21 : la DG valide
    await expect(valider(dg, id, null)).resolves.toMatch(/^COT-/);
  });

  it("le droit de valider est paramétrable : si retiré à la DG, elle ne peut plus valider", async () => {
    const id = await creerBrouillon(gestionnaire, grosse(), null);
    await soumettre(gestionnaire, id, null);
    try {
      await enregistrerDroit(admin, { profil: "DIRECTION_GENERALE", action: "VALIDER_COTATION", niveau: "AUCUN" }, null);
      await expect(valider(dg, id, null)).rejects.toBeInstanceOf(ErreurAcces);
    } finally {
      await enregistrerDroit(admin, { profil: "DIRECTION_GENERALE", action: "VALIDER_COTATION", niveau: "VALIDE" }, null);
    }
  });

  it("valider une cotation ne dépend que du droit « Valider une cotation », jamais de « Forcer une prime »", async () => {
    // La DG a « Forcer une prime : Valide » mais pas « Valider une cotation » : elle ne peut pas valider (test précédent).
    // Dans l'autre sens, la Technique garde la validation même sans aucun droit sur le forçage.
    const id = await creerBrouillon(gestionnaire, grosse(), null);
    await soumettre(gestionnaire, id, null);
    try {
      await enregistrerDroit(admin, { profil: "TECHNIQUE", action: "FORCER_PRIME", niveau: "AUCUN" }, null);
      await expect(valider(technique, id, null)).resolves.toMatch(/^COT-/);
    } finally {
      await enregistrerDroit(admin, { profil: "TECHNIQUE", action: "FORCER_PRIME", niveau: "VALIDE" }, null);
    }
  });

  it("le renvoi en brouillon par un valideur suit le même droit : « Forcer une prime : Valide » ne suffit pas (fin écart D21 : DG valide)", async () => {
    const id = await creerBrouillon(gestionnaire, grosse(), null);
    await soumettre(gestionnaire, id, null);

    // La Comptabilité (aucun droit de validation) ne peut pas renvoyer
    await expect(renvoyerEnBrouillon(comptabilite, id, "Refus", null)).rejects.toBeInstanceOf(ErreurAcces);
    // La DG et la Technique (valideurs, étape 3) peuvent renvoyer
    await expect(renvoyerEnBrouillon(dg, id, "Refus de la Direction", null)).resolves.toBeUndefined();
  });

  it("H9 (T13 adapté) : B modifie le brouillon de A, B ne peut pas valider ; un troisième valideur le peut", async () => {
    const id = await creerBrouillon(commercial, forcee(), null);
    await modifierBrouillon(technique, id, forcee(), null); // B = technique modifie le brouillon de A = commercial
    await soumettre(commercial, id, null);

    await expect(valider(technique, id, null)).rejects.toThrow(/Vous avez modifié cette cotation/);
    await expect(valider(technique2, id, null)).resolves.toMatch(/^COT-/);
  });

  it("H1 : les accessoires se modifient dans la cotation, sont journalisés avant/après, et le seuil porte sur le TTC qui en résulte", async () => {
    const lignes = [{ codeFormule: "SOLO", effectif: 3, accessoireValeur: "5000" }, { codeFormule: "FAMILLE", effectif: 60 }];
    const id = await creerBrouillon(commercial, saisie({ lignes }), null);
    const c = (await lireCotation(commercial, id))!;

    expect(c.resultat.lignes[0].arrondi.accessoires.toString()).toBe("5000");
    expect(c.resultat.lignes[1].arrondi.accessoires.toString()).toBe("210000"); // valeur par défaut de la formule
    const journal = (await lireJournal({ action: "ACCESSOIRES_MODIFIES" })).lignes.find((l) => l.objet === `cotation ${id}`)!;
    expect(journal.avant).toEqual({ SOLO: "3000" });
    expect(journal.apres).toEqual({ SOLO: "5000" });

    // 5 000 000 F d'accessoires sur la formule Famille : le TTC dépasse le seuil de 20 000 000.
    const gros = await creerBrouillon(commercial, saisie({ lignes: [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60, accessoireValeur: "5000000" }] }), null);
    expect((await soumettre(commercial, gros, null)).statut).toBe("A_VALIDER");
    expect((await lireCotation(commercial, gros))!.raisonsValidation).toEqual(["SEUIL_DEPASSE"]);
    await expect(creerBrouillon(commercial, saisie({ lignes: [{ codeFormule: "SOLO", effectif: 1, accessoireValeur: "-1" }] }), null)).rejects.toBeInstanceOf(ErreurMetier);
  });

  it("le droit de forcer est vérifié : un profil sans droit « Demande » ou « Valide » ne peut pas forcer", async () => {
    try {
      await enregistrerDroit(admin, { profil: "COMMERCIAL", action: "FORCER_PRIME", niveau: "AUCUN" }, null);
      await expect(creerBrouillon(commercial, forcee(), null)).rejects.toBeInstanceOf(ErreurAcces);
    } finally {
      await enregistrerDroit(admin, { profil: "COMMERCIAL", action: "FORCER_PRIME", niveau: "DEMANDE" }, null);
    }
  });

  it("une cotation « À valider » est figée pour l'auteur ; renvoyée en brouillon, elle redevient modifiable", async () => {
    const id = await creerBrouillon(commercial, forcee(), null);
    await soumettre(commercial, id, null);

    await expect(modifierBrouillon(commercial, id, saisie(), null)).rejects.toThrow(/figée/);
    await renvoyerEnBrouillon(commercial, id, "", null);
    await expect(modifierBrouillon(commercial, id, saisie(), null)).resolves.toEqual({ compositionVidee: false });
    expect((await lireCotation(commercial, id))!.statut).toBe("BROUILLON");
  });

  it("un valideur qui renvoie la cotation doit dire pourquoi ; un tiers sans droit ne peut pas la renvoyer", async () => {
    const id = await creerBrouillon(commercial, forcee(), null);
    await soumettre(commercial, id, null);

    await expect(renvoyerEnBrouillon(technique, id, "", null)).rejects.toThrow(/motif du renvoi/);
    await expect(renvoyerEnBrouillon(gestionnaire, id, "je veux la modifier", null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(renvoyerEnBrouillon(technique, id, "Remise trop forte", null)).resolves.toBeUndefined();

    // H12 (D18) : le renvoi ramène en brouillon (pas « Refusée », réservé au refus du client) et le motif est journalisé.
    expect((await lireCotation(commercial, id))!.statut).toBe("BROUILLON");
    const journal = (await lireJournal({ action: "COTATION_RENVOYEE" })).lignes.find((l) => l.objet === `cotation ${id}`)!;
    expect(journal.utilisateur).toBe(technique.identifiant);
    expect(journal.apres).toMatchObject({ commentaire: "Remise trop forte" });
  });
});

describe("T11 : cotation expirée", () => {
  /** Recule la fin de validité d'une cotation émise. Le déclencheur est suspendu le temps de l'opération : le test simule le temps qui passe. */
  async function remonterLeTemps(id: number, dateValidite: string): Promise<void> {
    const prisma = obtenirPrisma();
    await prisma.$executeRawUnsafe(`ALTER TABLE cotations DISABLE TRIGGER cotations_figees`);
    try {
      await prisma.$executeRawUnsafe(`UPDATE cotations SET date_validite = '${dateValidite}' WHERE id = ${id}`);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE cotations ENABLE TRIGGER cotations_figees`);
    }
  }

  it("expirée : statut « Expirée », filigrane « EXPIRÉE », transformation impossible", async () => {
    const id = await emise();
    await remonterLeTemps(id, "2020-06-30");
    const c = (await lireCotation(commercial, id))!;

    expect(c.statutEffectif).toBe("EXPIREE");
    expect(c.filigrane).toBe("EXPIRÉE");
    await expect(accepter(commercial, id, ["SOLO"], numeroPolice(), null)).rejects.toThrow(/expirée/);
    expect(await obtenirPrisma().police.count({ where: { cotationId: id } })).toBe(0);
  });

  it("la mise à jour d'expiration est persistée, journalisée, et définitive : même en SQL, une expirée ne devient pas acceptée", async () => {
    const id = await emise();
    await remonterLeTemps(id, "2020-06-30");

    expect(await expirerCotations()).toBeGreaterThanOrEqual(1);
    expect((await obtenirPrisma().cotation.findUniqueOrThrow({ where: { id } })).statut).toBe("EXPIREE");
    expect((await lireJournal({ action: "COTATION_EXPIREE" })).lignes.some((l) => l.objet === `cotation ${id}`)).toBe(true);
    await expect(obtenirPrisma().$executeRawUnsafe(`UPDATE cotations SET statut = 'ACCEPTEE' WHERE id = ${id}`)).rejects.toThrow(/cotation figée/);
    await expect(refuser(commercial, id, "AUTRE", "", null)).rejects.toThrow(/émise et encore valide/);
  });

  it("le dernier jour de validité, la cotation est encore acceptable", async () => {
    const id = await emise();
    await remonterLeTemps(id, aujourdhui());

    expect((await lireCotation(commercial, id))!.statutEffectif).toBe("EMISE");
    await expect(accepter(commercial, id, ["SOLO"], numeroPolice(), null)).resolves.toBeDefined();
  });
});

describe("acceptation et transformation en police (CDC §9.4)", () => {
  it("le client retient une formule : la police reprend la formule retenue, les assurés et l'échéancier", async () => {
    const assures = [{ ordre: 1, nom_prenoms: "Test Inventé", date_naissance: "1985-03-12", sexe: "F" as const, lien: "Souscripteur", formule: "FAMILLE" }];
    const id = await emise(commercial, saisie({ assures }));

    const saisi = numeroPolice();
    const { numeroPolice: numero } = await accepter(commercial, id, ["FAMILLE"], saisi.toLowerCase(), null);
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
    const c = (await lireCotation(commercial, id))!;

    expect(numero).toBe(saisi); // saisi, jamais généré (H10) ; mis en majuscules
    expect(police.typeContrat).toBe("GROUPE");
    expect(c.statut).toBe("ACCEPTEE");
    expect(c.numeroPolice).toBe(numero);
    expect(c.formulesRetenues).toEqual(["FAMILLE"]);
    expect(police.ttcTotal.toFixed(0)).toBe("15600000"); // seule la formule Famille
    expect((police.assures as { sexe: string }[])[0].sexe).toBe("F");
    expect((police.echeancier as { montant: string }[]).map((t) => t.montant)).toEqual(["3900000", "3900000", "3900000", "3900000"]);
  });

  it("on ne peut accepter qu'une fois, ni une formule absente de la cotation", async () => {
    const id = await emise();

    await expect(accepter(commercial, id, ["INCONNUE"], numeroPolice(), null)).rejects.toThrow(/au moins une formule/);
    await accepter(commercial, id, ["SOLO", "FAMILLE"], numeroPolice(), null);
    await expect(accepter(commercial, id, ["SOLO"], numeroPolice(), null)).rejects.toThrow(/Seule une cotation émise/);
  });

  it("H10, H31 : le numéro de police est saisi, au format paramétré, et unique", async () => {
    const id = await emise();
    const pris = numeroPolice();
    await accepter(commercial, await emise(), ["SOLO"], pris, null);

    await expect(accepter(commercial, id, ["SOLO"], "", null)).rejects.toThrow(/numéro de police/i);
    await expect(accepter(commercial, id, ["SOLO"], "POL-2026-000001", null)).rejects.toThrow(/format/);
    await expect(accepter(commercial, id, ["SOLO"], pris, null)).rejects.toThrow(/déjà utilisé/);
    expect((await lireCotation(commercial, id))!.statut).toBe("EMISE"); // rien n'a été enregistré
  });

  it("le format du numéro de police se paramètre (historisé) et s'applique à la saisie", async () => {
    await expect(enregistrerFormatNumeroPolice(commercial, "^P\\d+$", "2020-01-01", null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(enregistrerFormatNumeroPolice(technique, "P\\d+", "2020-01-01", null)).rejects.toThrow(/\^/);
    await expect(enregistrerFormatNumeroPolice(technique, "^P(\\d+$", "2020-01-01", null)).rejects.toBeInstanceOf(ErreurMetier);

    const futur = "2999-01-01";
    await enregistrerFormatNumeroPolice(technique, "^P\\d{3}$", futur, null);
    expect(await lireFormatNumeroPolice(futur)).toBe("^P\\d{3}$");
    expect(await lireFormatNumeroPolice()).toBe(FORMAT_NUMERO_POLICE_DEFAUT); // pas encore en vigueur
  });

  it("une cotation non émise ne peut pas être acceptée", async () => {
    const id = await creerBrouillon(commercial, saisie(), null);

    await expect(accepter(commercial, id, ["SOLO"], numeroPolice(), null)).rejects.toThrow(/Seule une cotation émise/);
  });
});

describe("refus (CDC §9.3)", () => {
  it("exige un motif de la liste paramétrable ; la cotation refusée ne s'accepte plus", async () => {
    const id = await emise();

    await expect(refuser(commercial, id, "", "", null)).rejects.toThrow(/motif/);
    await expect(refuser(commercial, id, "MOTIF_INVENTE", "", null)).rejects.toThrow(/motif/);
    await refuser(commercial, id, "PRIX_TROP_ELEVE", "Budget dépassé", null);
    const c = (await lireCotation(commercial, id))!;

    expect(c.statut).toBe("REFUSEE");
    expect(c.motifRefusCode).toBe("PRIX_TROP_ELEVE");
    await expect(accepter(commercial, id, ["SOLO"], numeroPolice(), null)).rejects.toThrow(/Seule une cotation émise/);
  });
});

describe("saisie, droits et traçabilité", () => {
  it("réserve la création aux profils « Oui » ; la DG et la Comptabilité ne créent pas, la DG consulte", async () => {
    await expect(creerBrouillon(dg, saisie(), null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerBrouillon(comptabilite, saisie(), null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(creerBrouillon(admin, saisie(), null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(listerCotations(dg)).resolves.toBeDefined();
    await expect(listerCotations(comptabilite)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("refuse un sexe invalide, une formule en double et une formule inconnue ; garde le sexe valide", async () => {
    const assure = { ordre: 1, nom_prenoms: "Test", date_naissance: "1990-01-01", sexe: "M" as const, lien: "Souscripteur", formule: "SOLO" };

    await expect(creerBrouillon(commercial, saisie({ assures: [{ ...assure, sexe: "X" as "M" }] }), null)).rejects.toThrow(/sexe invalide/);
    await expect(creerBrouillon(commercial, saisie({ lignes: [{ codeFormule: "SOLO", effectif: 1 }, { codeFormule: "SOLO", effectif: 2 }] }), null)).rejects.toThrow(/qu'une fois/);
    await expect(creerBrouillon(commercial, saisie({ lignes: [{ codeFormule: "NOPE", effectif: 1 }] }), null)).rejects.toBeInstanceOf(ErreurMetier);
    const id = await creerBrouillon(commercial, saisie({ assures: [assure], risque: { marque: "Yamaha" } }), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.assures[0].sexe).toBe("M");
    expect(c.risque).toEqual({ marque: "Yamaha" });
  });

  it("pièce d'identité d'un assuré (assures[].num_identification, session 6.0) : facultative, enregistrée, 50 caractères au plus", async () => {
    const assure = { ordre: 1, nom_prenoms: "Test", date_naissance: "1990-01-01", sexe: "M" as const, lien: "Enfant", formule: "SOLO" };
    await expect(creerBrouillon(commercial, saisie({ assures: [{ ...assure, num_identification: "X".repeat(51) }] }), null)).rejects.toThrow(/numéro d'identification trop long/);
    const id = await creerBrouillon(commercial, saisie({ assures: [{ ...assure, num_identification: "CNI C0000000001" }, { ...assure, ordre: 2, nom_prenoms: "Sans pièce" }] }), null);
    const c = (await lireCotation(commercial, id))!;
    expect(c.assures.map((a) => a.num_identification ?? "")).toEqual(["CNI C0000000001", ""]);
  });

  it("copie le client choisi dans la cotation : la cotation ne bouge pas si le client change ensuite", async () => {
    const clientId = await creerClient(commercial, { ...prospect, nom: "CLIENT ENREGISTRÉ" }, null);
    const id = await creerBrouillon(commercial, saisie({ clientId, souscripteur: { ...prospect, nom: "ignoré" } }), null);

    expect((await lireCotation(commercial, id))!.souscripteur.nom).toBe("CLIENT ENREGISTRÉ");
    await obtenirPrisma().client.update({ where: { id: clientId }, data: { nom: "RENOMMÉ" } });
    expect((await lireCotation(commercial, id))!.souscripteur.nom).toBe("CLIENT ENREGISTRÉ");
  });

  it("journalise création, forçage, validation, émission, acceptation et refus", async () => {
    const actions = new Set((await lireJournal({})).lignes.map((l) => l.action));
    const plusLoin = new Set<string>();
    for (const a of ["COTATION_CREEE", "COTATION_SOUMISE", "PRIME_FORCEE", "DOCUMENT_VALIDE", "DOCUMENT_EMIS", "COTATION_ACCEPTEE", "COTATION_REFUSEE", "POLICE_CREEE", "COTATION_RENVOYEE"]) {
      if ((await lireJournal({ action: a })).lignes.length > 0) plusLoin.add(a);
    }

    expect(actions.size).toBeGreaterThan(0);
    expect([...plusLoin].sort()).toEqual(["COTATION_ACCEPTEE", "COTATION_CREEE", "COTATION_REFUSEE", "COTATION_RENVOYEE", "COTATION_SOUMISE", "DOCUMENT_EMIS", "DOCUMENT_VALIDE", "POLICE_CREEE", "PRIME_FORCEE"]);
  });

  it("D37 / H107 : refuse une date d'effet antérieure à aujourd'hui à la création et à la modification, mais n'empêche pas d'émettre une cotation déjà saisie", async () => {
    const hier = ajouterJours(aujourdhui(), -1);
    const finAnnee = ajouterJours(aujourdhui(), 364);
    // Cotation existante saisie avant que sa date d'effet ne passe dans le passé (H107).
    fixerDateMinimumEffetPourTests("2026-01-01");
    const existante = await creerBrouillon(commercial, saisie({ dateEffet: hier, dateEcheance: finAnnee }), null);

    // En conditions réelles (aucune surcharge de test) : la saisie d'une date d'effet passée est refusée, mais la cotation existante s'émet.
    fixerDateMinimumEffetPourTests(null);
    try {
      await expect(creerBrouillon(commercial, saisie({ dateEffet: hier, dateEcheance: finAnnee }), null)).rejects.toThrow(MESSAGE_DATE_EFFET_PASSEE);
      const duJour = await creerBrouillon(commercial, saisie({ dateEffet: aujourdhui(), dateEcheance: finAnnee }), null);
      await expect(modifierBrouillon(commercial, duJour, saisie({ dateEffet: hier, dateEcheance: finAnnee }), null)).rejects.toThrow(MESSAGE_DATE_EFFET_PASSEE);

      const soumise = await soumettre(commercial, existante, null);
      expect(soumise.statut).toBe("EMISE");
    } finally {
      fixerDateMinimumEffetPourTests("2026-01-01");
    }
  });
});
