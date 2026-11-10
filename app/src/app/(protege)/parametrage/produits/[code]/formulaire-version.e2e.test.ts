// Bout en bout (npm run test:e2e) : écran « Ajouter une version » (D66). Le mode est figé par produit : lecture seule, seules les sections du mode,
// « dès la publication » proposé pour le barème. Rendu réel du composant avec les versions lues en base. Produits INVENTÉS.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import { initialiserProfilsEtDroits } from "@/serveur/droits";
import { creerProduit, creerVersion, listerVersions } from "@/serveur/parametrage";
import { obtenirPrisma } from "@/serveur/prisma";
import { creerBranchesFiscales, creerProduitAuBareme, type BranchesFiscales } from "@/serveur/produit-bareme-test";
import type { UtilisateurCourant } from "@/serveur/types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "@/serveur/utilisateurs";

import { FormulaireNouvelleVersion } from "./formulaire-version";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

let technique: UtilisateurCourant;
let branches: BranchesFiscales;

const action = async () => ({});
async function ecran(code: string, baremePublie = false): Promise<string> {
  const donnees = await listerVersions(technique, code);
  return renderToStaticMarkup(createElement(FormulaireNouvelleVersion, { codeProduit: code, base: donnees?.versions[0] ?? null, action, baremePublie }));
}

const versionDeBase = (extra: Partial<VersionSaisie>): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
  ...extra,
});

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const idTech = unique("technique");
  await creerUtilisateur(await compte(idAdmin), { identifiant: idTech, nom: "Technique", profil: "TECHNIQUE", motDePasse: MDP }, null);
  technique = await compte(idTech);
  branches = await creerBranchesFiscales(technique, CODE("E").slice(-8));
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("D66 : écran « Ajouter une version », mode figé par produit", () => {
  it("produit au barème : mode « Au barème » en lecture seule, « dès la publication » proposé, motif demandé, ni formules ni garanties", async () => {
    const code = CODE("ECRAN_BAREME");
    await creerProduitAuBareme(technique, code, branches, 10);
    const html = await ecran(code, true);
    expect(html).toContain('data-mode-fige="BAREME"');
    expect(html).toContain("Au barème");
    expect(html).toContain("Lecture seule");
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="modeTarification"[^>]*value="BAREME"/);
    expect(html).not.toMatch(/<select[^>]*name="modeTarification"/);
    expect(html).toContain("Dès la publication du barème");
    expect(html).toMatch(/<select[^>]*name="effet"/);
    expect(html).toContain("Motif de la publication");
    expect(html).not.toContain("Garanties du produit");
    expect(html).not.toMatch(/>Formules</);
    // Les paramètres communs restent : durée imposée, arrondi, fractionnement, validité, références.
    for (const attendu of ["dureeImposeeUnAn", 'name="precision"', 'name="tranchesMax"', 'name="validiteMois"', 'name="csModeleCode"']) expect(html).toContain(attendu);
  });

  it("produit par formules : mode en lecture seule, formules affichées, pas de liste des garanties ni de choix d'entrée en vigueur", async () => {
    const code = CODE("ECRAN_FORMULE");
    await creerProduit(technique, { code, libelle: "Produit inventé (écran D66)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
    await creerVersion(technique, code, versionDeBase({ formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "1000", accessoireMode: "AUCUN", accessoireValeur: "0" }] }), null);
    const html = await ecran(code);
    expect(html).toContain('data-mode-fige="FORMULE"');
    expect(html).toContain("Par formule");
    expect(html).not.toMatch(/<select[^>]*name="modeTarification"/);
    expect(html).toMatch(/>Formules</);
    expect(html).not.toContain("Garanties du produit");
    expect(html).not.toContain('name="garanties"');
    expect(html).not.toMatch(/name="effet"/);
    expect(html).not.toContain("Motif de la publication");
  });

  it("produit par garanties : la liste des garanties, pas de formules", async () => {
    const code = CODE("ECRAN_GARANTIES");
    await creerProduit(technique, { code, libelle: "Produit inventé (écran D66)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
    await creerVersion(technique, code, versionDeBase({ modeTarification: "GARANTIES", garanties: [], garantiesSaisieLibre: true }), null);
    const html = await ecran(code);
    expect(html).toContain('data-mode-fige="GARANTIES"');
    expect(html).toContain("Garanties du produit");
    expect(html).not.toMatch(/>Formules</);
    expect(html).not.toMatch(/name="effet"/);
  });

  it("première version d'un produit : le mode se choisit parmi les trois, avec leurs sections", async () => {
    const code = CODE("ECRAN_PREMIERE");
    await creerProduit(technique, { code, libelle: "Produit inventé (écran D66)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
    const html = await ecran(code);
    expect(html).toMatch(/<select[^>]*name="modeTarification"/);
    for (const mode of ["FORMULE", "GARANTIES", "BAREME"]) expect(html).toContain(`value="${mode}"`);
    expect(html).not.toContain("data-mode-fige");
    expect(html).toContain("Garanties du produit");
    expect(html).toContain("Dès la publication du barème");
  });
});
