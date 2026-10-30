// Bout en bout (npm run test:e2e) : vraie base de test, VRAI générateur, VRAI stockage.
// Cotation d'un souscripteur PERSONNE MORALE puis PERSONNE PHYSIQUE, saisies par le formulaire de la refonte d'ergonomie (D56) :
// les champs envoyés par ChampsSouscripteurDynamiques sont lus par lireCotation (comme l'action `enregistrerCotation`), puis
// brouillon -> émission -> PDF stocké, jusqu'à la page de vérification.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lireCotation } from "./lire-cotation";
import { ChampsSouscripteurDynamiques } from "@/composants/ChampsSouscripteurDynamiques";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "@/serveur/branches-test";
import { obtenirConfig } from "@/serveur/config";
import { creerBrouillon, lireCotation as lireCotationEnBase, soumettre } from "@/serveur/cotations";
import { debutTest, finTest } from "@/serveur/dates-test";
import { emettreCotation, verifierJeton } from "@/serveur/documents";
import { initialiserProfilsEtDroits } from "@/serveur/droits";
import { remplacerGenerateur } from "@/serveur/generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "@/serveur/modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "@/serveur/parametrage";
import { fixerSeuilGlobalDeTest, retablirSeuilGlobalDeTest } from "@/serveur/parametres-test";
import { obtenirPrisma } from "@/serveur/prisma";
import { remplacerStockage, stockage } from "@/serveur/stockage";
import type { UtilisateurCourant } from "@/serveur/types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "@/serveur/utilisateurs";

const FIXTURES = join(process.cwd(), "..", "generateur", "tests", "fixtures");
const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let produit: string;

async function compte(identifiant: string) {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

/** Ce que le navigateur enverrait : les champs du formulaire de souscripteur rendu, plus ceux du contrat, de la période et de la prime. */
function formulaire(souscripteur: Partial<Souscripteur>): FormData {
  const html = renderToStaticMarkup(createElement(ChampsSouscripteurDynamiques, { valeurs: souscripteur }));
  const d = new FormData();
  const texte = (v: string) => v.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const nom = /\bname="([^"]*)"/.exec(m[1])?.[1];
    const options = [...m[2].matchAll(/<option\b([^>]*)>/g)].map((o) => o[1]);
    const choisie = options.find((o) => /\bselected\b/.test(o)) ?? options[0] ?? "";
    if (nom) d.append(nom, texte(/\bvalue="([^"]*)"/.exec(choisie)?.[1] ?? ""));
  }
  for (const m of html.matchAll(/<(input|textarea)\b([^>]*)>/g)) {
    const nom = /\bname="([^"]*)"/.exec(m[2])?.[1];
    if (nom) d.append(nom, texte(/\bvalue="([^"]*)"/.exec(m[2])?.[1] ?? ""));
  }
  d.set("codeProduit", produit);
  d.set("typeContrat", "GROUPE");
  d.set("regimeTaxe", "GROUPE");
  d.set("dateEffet", debutTest());
  d.set("dateEcheance", finTest(debutTest()));
  d.set("nombreTranches", "1");
  d.set("eff_SOLO", "3");
  d.set("eff_FAMILLE", "60");
  return d;
}

beforeAll(async () => {
  await fixerSeuilGlobalDeTest("20000000");
  remplacerGenerateur(null);
  remplacerStockage(null);
  const sante = await fetch(new URL("/sante", obtenirConfig().GENERATEUR_URL)).catch(() => null);
  if (!sante?.ok) throw new Error(`Générateur injoignable sur ${obtenirConfig().GENERATEUR_URL} : lancez-le avant npm run test:e2e.`);
  await initialiserProfilsEtDroits();
  const admin = unique("admin");
  await creerAdministrateurInitial({ identifiant: admin, nom: "Admin", motDePasse: MDP });
  const a = await compte(admin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(a, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, dg, commercial] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL")];

  produit = CODE("SOUSC");
  const branche = `SANTE_${produit}`;
  await assurerBranche(branche);
  await creerTaxe(technique, { branche, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code: produit, libelle: "Santé souscripteur (bout en bout)", gamme: "RELAX", branchePrincipale: "MALADIE", branche }, null);
  await creerVersion(
    technique,
    produit,
    {
      dateEffet: "2020-01-01",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
      prorata: { actif: true, primeMinimale: null },
      fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: "20000000",
      formules: [
        { code: "SOLO", libelle: "Solo", tauxCouverture: "80", primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" },
        { code: "FAMILLE", libelle: "Famille", tauxCouverture: "80", primeUnitaire: "252657.63", accessoireMode: "FIXE", accessoireValeur: "210000" },
      ],
    },
    null,
  );
  const modele = await creerModele(technique, { type: "COTATION", code: CODE("COT"), libelle: "Cotation santé", produitCode: produit, niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null }, null);
  await deposerVersion(technique, modele, { fichier: new Uint8Array(readFileSync(join(FIXTURES, "cotation_test.docx"))), nomFichier: "cotation_test.docx", commentaire: "Modèle de test", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: modele } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
});

afterAll(async () => {
  try {
    await retablirSeuilGlobalDeTest();
  } finally {
    await obtenirPrisma().$disconnect();
  }
});

async function jusquALEmission(d: FormData) {
  const id = await creerBrouillon(commercial, lireCotation(d), null);
  expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
  const doc = await emettreCotation(commercial, id, null);
  const ligne = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
  const stocke = await stockage().lire(ligne.chemin);
  expect(Buffer.from(stocke).subarray(0, 5).toString()).toBe("%PDF-");
  expect(createHash("sha256").update(stocke).digest("hex")).toBe(ligne.empreinte);
  expect(await verifierJeton(ligne.jeton)).toMatchObject({ numero: doc.numero, statut: { code: "VALIDE" } });
  return { id, doc };
}

describe("cotation saisie par le formulaire de souscripteur, jusqu'à l'émission du PDF", () => {
  it("personne morale : raison sociale enregistrée, identité de personne physique vide, PDF émis", async () => {
    const { id, doc } = await jusquALEmission(
      formulaire({ type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE SARL", telephone: "2721000000", email: "", adresse: "Plateau", activite: "Négoce", num_identification: "CI-ABJ-2026-B-00001" }),
    );
    const c = (await lireCotationEnBase(commercial, id))!;
    expect(c.souscripteur).toMatchObject({ type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE SARL", activite: "Négoce", num_identification: "CI-ABJ-2026-B-00001" });
    expect(doc.souscripteur).toContain("ENTREPRISE INVENTÉE SARL");
  }, 180_000);

  it("personne physique : identité enregistrée, raison sociale vide, PDF émis", async () => {
    const { id, doc } = await jusquALEmission(
      formulaire({ type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa Inventée", raison_sociale: "", telephone: "0700000000", email: "", adresse: "Cocody", profession: "Enseignante", activite: "Éducation", date_naissance: "1990-02-03" }),
    );
    const c = (await lireCotationEnBase(commercial, id))!;
    expect(c.souscripteur).toMatchObject({ type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa Inventée", raison_sociale: "", profession: "Enseignante", activite: "Éducation", date_naissance: "1990-02-03" });
    expect(doc.souscripteur).toContain("KOUADIO");
  }, 180_000);
});
