// Bout en bout (npm run test:e2e) : la fiche produit affiche les QUATRE états d'une version, avec l'heure (D68). Rendu réel du titre de chaque version
// lue en base, horloge de l'application fixée. Produits INVENTÉS.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ajouterJours, aujourdhui, fixerHorlogePourTests, formaterDate } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { creerVersionDepuisBareme } from "@/serveur/bareme-edition";
import { initialiserProfilsEtDroits } from "@/serveur/droits";
import { creerProduit, creerVersion, listerVersions } from "@/serveur/parametrage";
import { creerBranchesFiscales, creerProduitAuBareme, type BranchesFiscales } from "@/serveur/produit-bareme-test";
import { obtenirPrisma } from "@/serveur/prisma";
import type { UtilisateurCourant } from "@/serveur/types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "@/serveur/utilisateurs";

import { TitreDeVersion } from "./titre-version";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

let technique: UtilisateurCourant;
let branches: BranchesFiscales;
const JOUR = aujourdhui();
const horloge = (heure: number, minute = 0) => fixerHorlogePourTests(new Date(`${JOUR}T${String(heure).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`));

const versionFormule = (dateEffet: string, prime: string): VersionSaisie => ({
  dateEffet,
  modeTarification: "FORMULE",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: prime, accessoireMode: "AUCUN", accessoireValeur: "0" }],
});

/** Le texte du titre rendu de chaque version du produit, dans l'ordre de la fiche (la plus récente d'abord), pour l'instant `maintenant`. */
async function titres(code: string, maintenant: string): Promise<string[]> {
  const { versions } = (await listerVersions(technique, code))!;
  return versions.map((v) => renderToStaticMarkup(createElement(TitreDeVersion, { v, toutes: versions, maintenant })).replace(/<[^>]+>/g, ""));
}

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const identifiant = unique("technique");
  await creerUtilisateur(await compte(idAdmin), { identifiant, nom: "Technique", profil: "TECHNIQUE", motDePasse: MDP }, null);
  technique = await compte(identifiant);
  branches = await creerBranchesFiscales(technique, CODE("F").slice(-8));
});

afterAll(async () => {
  fixerHorlogePourTests(null);
  await obtenirPrisma().$disconnect();
});

describe("D68 test 10 — la fiche produit affiche les quatre états d'une version, avec l'heure", () => {
  it("« En vigueur depuis … à HH h MM », « Remplacée le … à HH h MM », « À venir : … » (+ l'heure si ce n'est pas minuit) et « En préparation »", async () => {
    const code = CODE("FICHE_H10");
    const demain = ajouterJours(JOUR, 1);
    horloge(9, 0);
    await creerProduit(technique, { code, libelle: "Produit de la fiche (test D68)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: branches.iard }, null);
    await creerVersion(technique, code, versionFormule(ajouterJours(JOUR, -10), "1000"), null); // A : ancienne, remplacée à 10 h 00
    horloge(10, 0);
    await creerVersion(technique, code, versionFormule(JOUR, "2000"), null); // B : date du jour, instant de l'enregistrement
    await creerVersion(technique, code, versionFormule(demain, "3000"), null); // C : date future, minuit
    horloge(11, 5);
    await creerVersion(technique, code, versionFormule(JOUR, "4000"), null); // D : enregistrée à 11 h 05

    // À 10 h 30 : B sert, D n'est pas encore en vigueur (11 h 05), C commence demain à minuit, A a cédé la place à B.
    const a1030 = `${JOUR}T10:30:00.000Z`;
    expect(await titres(code, a1030)).toEqual([
      `À venir : en vigueur à partir du ${formaterDate(demain)}`, // C : minuit, pas d'heure
      `À venir : en vigueur à partir du ${formaterDate(JOUR)} à 11 h 05`, // D : une heure, donc affichée
      `En vigueur depuis le ${formaterDate(JOUR)} à 10 h 00`, // B
      `Remplacée le ${formaterDate(JOUR)} à 10 h 00`, // A, remplacée par B
    ]);
    // À 11 h 30 : D sert, B est à son tour remplacée (à 11 h 05).
    expect(await titres(code, `${JOUR}T11:30:00.000Z`)).toEqual([
      `À venir : en vigueur à partir du ${formaterDate(demain)}`,
      `En vigueur depuis le ${formaterDate(JOUR)} à 11 h 05`,
      `Remplacée le ${formaterDate(JOUR)} à 11 h 05`,
      `Remplacée le ${formaterDate(JOUR)} à 10 h 00`,
    ]);
    // À minuit pile demain : C sert.
    expect((await titres(code, `${demain}T00:00:00.000Z`))[0]).toBe(`En vigueur depuis le ${formaterDate(demain)} à 00 h 00`);

    // « En préparation » : une version au barème sans date ni instant.
    const codeBareme = CODE("FICHE_PREP_H10");
    horloge(9, 0);
    const { versionId } = await creerProduitAuBareme(technique, codeBareme, branches, 10);
    horloge(10, 0);
    await creerVersionDepuisBareme(technique, versionId, "", null);
    const prep = await titres(codeBareme, `${JOUR}T10:30:00.000Z`);
    expect(prep).toEqual(["En préparation : en vigueur dès la publication de son barème", `En vigueur depuis le ${formaterDate(ajouterJours(JOUR, -10))} à 00 h 00`]);
    expect(prep.join(" ")).not.toContain("9999");
  });
});
