// Bout en bout (npm run test:e2e) : actions de barème de la fiche produit (D66, H212). Le mode est figé par produit : une version « Par formule » ou
// « Par garanties » à date future ne propose AUCUNE action de barème ; une version provisoire d'avant D66 qui a déjà un barème reste modifiable,
// publiable et basculable ; une version au barème garde ses actions. Rendu réel du panneau avec l'état lu en base. Produits INVENTÉS.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import { DATE_EFFET_A_LA_PUBLICATION, type VersionSaisie } from "@/domaine/calcul/parametrage";
import { enregistrerBrouillonBareme, etatDuBareme, publierBareme } from "@/serveur/bareme";
import { initialiserProfilsEtDroits } from "@/serveur/droits";
import { creerProduit, creerVersion, listerVersions } from "@/serveur/parametrage";
import { obtenirPrisma } from "@/serveur/prisma";
import { baremeAuxBranches, creerBranchesFiscales, versionAuBareme, type BranchesFiscales } from "@/serveur/produit-bareme-test";
import type { UtilisateurCourant } from "@/serveur/types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "@/serveur/utilisateurs";

import { PresentationPanneauBareme } from "./panneau-bareme";

vi.mock("@/serveur/session", () => ({ exigerUtilisateur: async () => undefined }));
vi.mock("@/serveur/requete", () => ({ adresseIpCourante: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

let technique: UtilisateurCourant;
let branches: BranchesFiscales;
const futur = ajouterJours(aujourdhui(), 30);

const versionDe = (dateEffet: string, extra: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet,
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
  ...extra,
});
const formule = { code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" } as const;

async function nouveauProduit(): Promise<string> {
  const code = CODE("PAN");
  await creerProduit(technique, { code, libelle: "Panneau de barème (inventé)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
  return code;
}

/** Rend le panneau de la version la plus récente du produit, avec l'état de son barème lu en base. */
async function panneau(code: string): Promise<string> {
  const version = (await listerVersions(technique, code))!.versions[0];
  return renderToStaticMarkup(createElement(PresentationPanneauBareme, { codeProduit: code, version, etat: await etatDuBareme(version.id) }));
}

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const idTech = unique("technique");
  await creerUtilisateur(await compte(idAdmin), { identifiant: idTech, nom: "Technique", profil: "TECHNIQUE", motDePasse: MDP }, null);
  technique = await compte(idTech);
  branches = await creerBranchesFiscales(technique, CODE("P").slice(-8));
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("D66, H212 : aucune action de barème sur un produit qui n'est pas au barème", () => {
  it("produit PAR FORMULES, version à date future : rien n'est proposé", async () => {
    const code = await nouveauProduit();
    await creerVersion(technique, code, versionDe("2020-01-01", { formules: [{ ...formule }] }), null);
    await creerVersion(technique, code, versionDe(futur, { formules: [{ ...formule }] }), null);
    expect(await panneau(code)).toBe("");
  });

  it("produit PAR GARANTIES, version à date future : rien n'est proposé", async () => {
    const code = await nouveauProduit();
    await creerVersion(technique, code, versionDe("2020-01-01", { modeTarification: "GARANTIES", garanties: [], garantiesSaisieLibre: true }), null);
    await creerVersion(technique, code, versionDe(futur, { modeTarification: "GARANTIES", garanties: [], garantiesSaisieLibre: true }), null);
    expect(await panneau(code)).toBe("");
  });

  it("produit AU BARÈME, version en préparation : barème vide, import et modèle restent proposés (inchangé)", async () => {
    const code = await nouveauProduit();
    await creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
    const html = await panneau(code);
    for (const attendu of ["Créer un barème vide", "Importer", 'type="file"', "Télécharger le modèle"]) expect(html, attendu).toContain(attendu);
    expect(html).not.toContain("Basculer");
  });

  it("version provisoire d'avant D66 qui a déjà un barème : modifiable, publiable, puis basculable ; ni barème vide ni import", async () => {
    const code = await nouveauProduit();
    await creerVersion(technique, code, versionDe(futur, { modeTarification: "GARANTIES", garanties: [], garantiesSaisieLibre: true }), null);
    const v = (await listerVersions(technique, code))!.versions[0];
    await enregistrerBrouillonBareme(technique, v.id, baremeAuxBranches(branches), null); // le barème existe déjà (donnée d'avant D66)
    let html = await panneau(code);
    expect(html).toContain("Modifier à l&#x27;écran");
    expect(html).toContain("Publier");
    expect(html).not.toContain("Créer un barème vide");
    expect(html).not.toContain('type="file"');
    await publierBareme(technique, v.id, "Barème de la version provisoire (test H212)", null);
    html = await panneau(code);
    expect(html).toContain("Basculer la version au barème");
    expect(html).toContain("Créer une nouvelle version à partir de ce barème");
    for (const interdit of ["Créer un barème vide", 'type="file"']) expect(html, interdit).not.toContain(interdit);
  });
});
