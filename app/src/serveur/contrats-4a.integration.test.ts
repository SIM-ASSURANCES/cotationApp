// Session 4a : compléments du souscripteur, bénéficiaires, contacts d'urgence, passage cotation → police.
// Vraie base PostgreSQL de test (npm run test:integration).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Assure, Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "./branches-test";
import { creerClient } from "./clients";
import { accepter, creerBrouillon, lireCotation, soumettre, type SaisieCotation } from "./cotations";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = unique("C4A").toUpperCase().replace(/-/g, "_");
const BRANCHE = `SANTE_${CODE}`;

let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

const prospect: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Test", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" };
const complements = {
  num_identification: "CI0000000",
  date_naissance: "1985-04-12" as const,
  lieu_naissance: "Abidjan",
  profession: "Comptable",
  activite: "Services",
  employeur: "Société inventée",
  bp: "01 BP 1234",
  localite: "Cocody",
  sous_prefecture: "Abidjan",
  whatsapp: "0700000001",
  mobile_money: "0700000002",
  situation_matrimoniale: "Marié(e)",
  nb_enfants: 2,
  groupe_sanguin: "O+",
};
const assure = (ordre: number): Assure => ({ ordre, nom_prenoms: `Adhérent ${ordre}`, date_naissance: "1990-01-01", sexe: "F", lien: "Salarié", formule: "SOLO" });

const version = (): VersionSaisie => ({
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

const saisie = (surcharge: Partial<SaisieCotation> = {}): SaisieCotation => ({
  codeProduit: CODE,
  clientId: null,
  typeContrat: "INDIVIDUEL",
  souscripteur: { ...prospect, ...complements },
  dateEffet: "2026-01-01",
  dateEcheance: "2026-12-31",
  nombreTranches: 1,
  lignes: [{ codeFormule: "SOLO", effectif: 3 }],
  motifForcage: null,
  assures: [],
  beneficiaires: [],
  contactsUrgence: [],
  risque: {},
  ...surcharge,
});

let compteurPolice = 0;
const numeroPolice = () => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I${String(++compteurPolice).padStart(5, "0")}`;

async function emise(s: SaisieCotation): Promise<number> {
  const id = await creerBrouillon(commercial, s, null);
  expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
  return id;
}
const police = (numero: string) => obtenirPrisma().police.findUniqueOrThrow({ where: { numero }, include: { adherents: { orderBy: { numero: "asc" } } } });

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
  await initialiserProfilsEtDroits();
  const admin = unique("admin");
  await creerAdministrateurInitial({ identifiant: admin, nom: "Admin", motDePasse: MDP });
  for (const [profil, nom] of [["TECHNIQUE", "technique"], ["COMMERCIAL", "commercial"]] as const) {
    const identifiant = unique(nom);
    await creerUtilisateur(await compte(admin), { identifiant, nom, profil, motDePasse: MDP }, null);
    if (profil === "TECHNIQUE") technique = await compte(identifiant);
    else commercial = await compte(identifiant);
  }
  await assurerBranche(BRANCHE);
  for (const typeContrat of ["INDIVIDUEL", "GROUPE"] as const) {
    await creerTaxe(technique, { branche: BRANCHE, typeContrat, tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  }
  await creerProduit(technique, { code: CODE, libelle: "Produit 4a (test)", gamme: "RELAX", branchePrincipale: "DECES", branche: BRANCHE }, null);
  await creerVersion(technique, CODE, version(), null);
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  await obtenirPrisma().$disconnect();
});

describe("compléments du souscripteur", () => {
  it("sont enregistrés avec la cotation, puis recopiés dans la police sans ressaisie", async () => {
    const id = await emise(saisie());
    const c = (await lireCotation(commercial, id))!;

    expect(c.souscripteur.profession).toBe("Comptable");
    expect(c.souscripteur.nb_enfants).toBe(2);
    const { numeroPolice: numero } = await accepter(commercial, id, ["SOLO"], numeroPolice(), null);
    const p = await police(numero);
    expect(p.souscripteur).toMatchObject({ nom: "KOUADIO", profession: "Comptable", date_naissance: "1985-04-12", groupe_sanguin: "O+", nb_enfants: 2 });
  });

  it("une date de naissance dans le futur, un nombre d'enfants négatif ou un groupe sanguin inconnu sont refusés, rien n'est enregistré", async () => {
    const avant = await obtenirPrisma().cotation.count();
    await expect(creerBrouillon(commercial, saisie({ souscripteur: { ...prospect, ...complements, date_naissance: "2999-01-01" } }), null)).rejects.toThrow(/date de naissance/);
    await expect(creerBrouillon(commercial, saisie({ souscripteur: { ...prospect, ...complements, nb_enfants: -1 } }), null)).rejects.toThrow(/nombre d'enfants/);
    await expect(creerBrouillon(commercial, saisie({ souscripteur: { ...prospect, ...complements, groupe_sanguin: "Z" } }), null)).rejects.toThrow(/groupe sanguin/);
    expect(await obtenirPrisma().cotation.count()).toBe(avant);
  });

  it("un client enregistré porte ses compléments, repris dans la cotation", async () => {
    const clientId = await creerClient(commercial, { ...prospect, nom: "CLIENT4A", ...complements }, null);
    const id = await creerBrouillon(commercial, saisie({ clientId, souscripteur: prospect }), null);

    expect((await lireCotation(commercial, id))!.souscripteur).toMatchObject({ nom: "CLIENT4A", profession: "Comptable", date_naissance: "1985-04-12", nb_enfants: 2 });
  });
});

describe("bénéficiaires et contacts d'urgence", () => {
  const trois = [
    { ordre: 1, nom_prenoms: "KOUADIO Paul", lien: "Enfant", contact: "0700000011", quote_part: "50" },
    { ordre: 2, nom_prenoms: "KOUADIO Marie", lien: "Enfant", contact: "0700000012", quote_part: "30" },
    { ordre: 3, nom_prenoms: "KOUADIO Jean", lien: "Conjoint", contact: "0700000013", quote_part: "20" },
  ];

  it("sont enregistrés avec la cotation, figés à l'émission et recopiés dans la police", async () => {
    const id = await emise(saisie({ beneficiaires: trois, contactsUrgence: [{ nom_prenoms: "KOUADIO Luc", contact: "0700000099" }] }));
    const c = (await lireCotation(commercial, id))!;

    expect(c.beneficiaires).toEqual(trois);
    expect(c.contactsUrgence).toEqual([{ nom_prenoms: "KOUADIO Luc", contact: "0700000099" }]);
    await expect(obtenirPrisma().$executeRawUnsafe(`UPDATE cotations SET beneficiaires = '[]'::jsonb WHERE id = ${id}`)).rejects.toThrow(/cotation figée/);
    await expect(obtenirPrisma().$executeRawUnsafe(`UPDATE cotations SET contacts_urgence = '[]'::jsonb WHERE id = ${id}`)).rejects.toThrow(/cotation figée/);

    const { numeroPolice: numero } = await accepter(commercial, id, ["SOLO"], numeroPolice(), null);
    const p = await police(numero);
    expect(p.beneficiaires).toEqual(trois);
    expect(p.contactsUrgence).toEqual([{ nom_prenoms: "KOUADIO Luc", contact: "0700000099" }]);
  });

  it("une somme de quotes-parts différente de 100 % est refusée, avec la somme obtenue dans le message", async () => {
    const trop = [{ ...trois[0], quote_part: "60" }, ...trois.slice(1)];

    await expect(creerBrouillon(commercial, saisie({ beneficiaires: trop }), null)).rejects.toThrow(/110 %/);
  });

  it("un contact d'urgence sans contact est refusé", async () => {
    await expect(creerBrouillon(commercial, saisie({ contactsUrgence: [{ nom_prenoms: "KOUADIO Luc", contact: "" }] }), null)).rejects.toThrow(/contact/);
  });

  it("« jamais fournis » (null) reste distinct de « saisis et laissés vides » ([]) jusque dans la police", async () => {
    const jamais = await accepter(commercial, await emise(saisie({ beneficiaires: null, contactsUrgence: null })), ["SOLO"], numeroPolice(), null);
    const vide = await accepter(commercial, await emise(saisie({ beneficiaires: [], contactsUrgence: [] })), ["SOLO"], numeroPolice(), null);

    const pJamais = await police(jamais.numeroPolice);
    const pVide = await police(vide.numeroPolice);
    expect(pJamais.beneficiaires).toBeNull();
    expect(pJamais.contactsUrgence).toBeNull();
    expect(pVide.beneficiaires).toEqual([]);
    expect(pVide.contactsUrgence).toEqual([]);
  });

  it("à l'acceptation, on peut compléter ce qu'on ne connaissait pas : la police les porte, la cotation figée reste inchangée", async () => {
    const id = await emise(saisie({ beneficiaires: null, contactsUrgence: null, souscripteur: { ...prospect } }));
    const { numeroPolice: numero } = await accepter(commercial, id, ["SOLO"], numeroPolice(), null, {
      souscripteur: { profession: "Enseignant", nb_enfants: 1 },
      beneficiaires: trois,
      contactsUrgence: [],
    });

    const p = await police(numero);
    expect(p.souscripteur).toMatchObject({ nom: "KOUADIO", profession: "Enseignant", nb_enfants: 1 });
    expect(p.beneficiaires).toEqual(trois);
    expect(p.contactsUrgence).toEqual([]);
    const c = (await lireCotation(commercial, id))!;
    expect(c.beneficiaires).toBeNull();
    expect(c.souscripteur.profession).toBeUndefined();
  });

  it("les compléments saisis à l'acceptation sont contrôlés comme à la cotation : rien n'est créé en cas d'erreur", async () => {
    const id = await emise(saisie());
    const faux = [{ ...trois[0], quote_part: "10" }];

    await expect(accepter(commercial, id, ["SOLO"], numeroPolice(), null, { souscripteur: {}, beneficiaires: faux, contactsUrgence: [] })).rejects.toThrow(/10 %/);
    expect((await lireCotation(commercial, id))!.statut).toBe("EMISE");
    expect((await lireCotation(commercial, id))!.numeroPolice).toBeNull();
  });
});

describe("contrat de groupe : version initiale de la liste des adhérents", () => {
  it("la police d'un contrat GROUPE reçoit les assurés de la cotation comme version 1 (liste initiale)", async () => {
    const adherents = [assure(1), assure(2), assure(3)];
    const id = await emise(saisie({ typeContrat: "GROUPE", assures: adherents }));
    const { numeroPolice: numero } = await accepter(commercial, id, ["SOLO"], numeroPolice(), null);

    const p = await police(numero);
    expect(p.adherents).toHaveLength(1);
    expect(p.adherents[0]).toMatchObject({ numero: 1, motif: "INITIALE", adherents, concernes: [] });
    expect(p.adherents[0].dateEffet.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("un contrat individuel n'a pas de liste d'adhérents", async () => {
    const id = await emise(saisie({ assures: [assure(1)] }));
    const { numeroPolice: numero } = await accepter(commercial, id, ["SOLO"], numeroPolice(), null);

    expect((await police(numero)).adherents).toHaveLength(0);
  });

  it("une version d'adhérents ne se modifie ni ne se supprime (ajout seul, déclencheur)", async () => {
    const id = await emise(saisie({ typeContrat: "GROUPE", assures: [assure(1)] }));
    const { numeroPolice: numero } = await accepter(commercial, id, ["SOLO"], numeroPolice(), null);
    const v = (await police(numero)).adherents[0];

    await expect(obtenirPrisma().$executeRawUnsafe(`UPDATE adherents_versions SET adherents = '[]'::jsonb WHERE id = ${v.id}`)).rejects.toThrow();
    await expect(obtenirPrisma().$executeRawUnsafe(`DELETE FROM adherents_versions WHERE id = ${v.id}`)).rejects.toThrow();
  });
});
