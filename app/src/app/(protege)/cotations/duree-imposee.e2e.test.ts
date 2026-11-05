// Bout en bout (npm run test:e2e) : durée imposée (D64). Le champ d'échéance rendu par l'écran, le formulaire lu comme l'action
// `enregistrerCotation`, puis brouillon -> émission. Vraie base de test. Données inventées.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EcheanceImposee } from "@/composants/EcheanceImposee";
import { echeanceUnAn } from "@/domaine/calcul/dates";
import { assurerBranche } from "@/serveur/branches-test";
import { creerBrouillon, lireCotation as lireEnBase, soumettre } from "@/serveur/cotations";
import { debutTest } from "@/serveur/dates-test";
import { initialiserProfilsEtDroits } from "@/serveur/droits";
import { creerProduit, creerTaxe, creerVersion } from "@/serveur/parametrage";
import { fixerSeuilGlobalDeTest, retablirSeuilGlobalDeTest } from "@/serveur/parametres-test";
import { obtenirPrisma } from "@/serveur/prisma";
import type { UtilisateurCourant } from "@/serveur/types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "@/serveur/utilisateurs";

import { lireCotation } from "./lire-cotation";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
let commercial: UtilisateurCourant;
let produit: string;

const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

beforeAll(async () => {
  await fixerSeuilGlobalDeTest("20000000");
  await initialiserProfilsEtDroits();
  const admin = unique("admin");
  await creerAdministrateurInitial({ identifiant: admin, nom: "Admin", motDePasse: MDP });
  const a = await compte(admin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(a, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  const technique = await nouveau("TECHNIQUE");
  commercial = await nouveau("COMMERCIAL");
  produit = unique("IMP").toUpperCase().replace(/-/g, "_");
  const branche = `SANTE_${produit}`;
  await assurerBranche(branche);
  await creerTaxe(technique, { branche, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code: produit, libelle: "Durée imposée (bout en bout)", gamme: "RELAX", branchePrincipale: "MALADIE", branche }, null);
  await creerVersion(
    technique,
    produit,
    {
      dateEffet: "2020-01-01",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
      prorata: { actif: false, primeMinimale: null },
      dureeImposeeUnAn: true,
      fractionnement: { tranchesMax: 1, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      seuilValidationTtc: "20000000",
      formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" }],
    },
    null,
  );
});

afterAll(async () => {
  try {
    await retablirSeuilGlobalDeTest();
  } finally {
    await obtenirPrisma().$disconnect();
  }
});

describe("D64 : durée imposée, de l'écran à l'émission", () => {
  it("le champ rendu est en lecture seule et porte l'échéance calculée dans un champ caché `dateEcheance`", () => {
    const html = renderToStaticMarkup(createElement(EcheanceImposee, { dateEffetInitiale: debutTest() }));
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="dateEcheance"/);
    expect(html).toMatch(/readOnly|readonly/i);
    expect(html).toContain("imposée");
  });

  it("une échéance falsifiée dans le formulaire est écrasée : brouillon puis émission portent effet + 1 an - 1 jour", async () => {
    const d = new FormData();
    d.set("codeProduit", produit);
    d.set("typeContrat", "GROUPE");
    d.set("regimeTaxe", "GROUPE");
    d.set("dateEffet", debutTest());
    d.set("dateEcheance", "2026-12-01"); // falsifiée
    d.set("nombreTranches", "1");
    d.set("eff_SOLO", "10");
    d.set("souscripteur_type", "PHYSIQUE");
    d.set("souscripteur_nom", "KOUADIO");
    d.set("souscripteur_prenoms", "Test");
    d.set("souscripteur_telephone", "0700000000");
    const id = await creerBrouillon(commercial, lireCotation(d), null);
    expect((await lireEnBase(commercial, id))!.dateEcheance).toBe(echeanceUnAn(debutTest()));
    const r = await soumettre(commercial, id, null);
    expect(r.statut).toBe("EMISE");
    const emise = (await lireEnBase(commercial, id))!;
    expect([emise.dateEffet, emise.dateEcheance]).toEqual([debutTest(), echeanceUnAn(debutTest())]);
  });
});
