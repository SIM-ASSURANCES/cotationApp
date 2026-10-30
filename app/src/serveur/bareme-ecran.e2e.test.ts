// Bout en bout (npm run test:e2e), session B4 (D58) : le parcours de la Technique à l'écran, sans Excel pour les modifications.
// Importer SECURPRO (inventé) une fois pour avoir ses jeux d'essai, puis, comme le fait l'éditeur : créer un champ liste, une garantie à
// deux composantes, modifier un taux, enregistrer, rejouer les essais (l'écart s'affiche, ligne à ligne), corriger, publier.
// Les clics du navigateur sont vérifiés à la main (compte rendu) ; ici, les mêmes fonctions de domaine et les mêmes services.
import { beforeAll, describe, expect, it } from "vitest";

import { champNeuf, garantieNeuve, lireBareme, schemaBareme, verifierBareme, type Bareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { assurerBranche } from "./branches-test";
import { decrireEcart, enregistrerBrouillonBareme, lireBaremePublie, publierBareme, rejouerLesEssaisBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { lireBaremePourEdition } from "./bareme-edition";
import { importerBaremeXlsx } from "./bareme-excel";
import { debutTest } from "./dates-test";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let technique: UtilisateurCourant;
let IARD: string;
let INCENDIE: string;

const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

function secuproDeTest(): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return lireBareme(d);
}

const version: VersionSaisie = {
  dateEffet: debutTest(),
  modeTarification: "GARANTIES",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
  garantiesSaisieLibre: true,
  garanties: [],
  references: { csModeleCode: null, csVisa: null },
};

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const admin = await compte(idAdmin);
  const identifiant = unique("technique");
  await creerUtilisateur(admin, { identifiant, nom: "Technique Test", profil: "TECHNIQUE", motDePasse: MDP }, null);
  technique = await compte(identifiant);
  INCENDIE = `INC_${CODE("T")}`.slice(0, 20);
  IARD = `IARD_${CODE("T")}`.slice(0, 20);
  await assurerBranche(INCENDIE);
  await assurerBranche(IARD);
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
});

describe("Parcours de la Technique à l'écran : champ liste, garantie à deux composantes, taux modifié, essais rejoués", () => {
  it("de l'édition à la publication", async () => {
    const code = CODE("ECRAN");
    await creerProduit(technique, { code, libelle: "Produit édité à l'écran (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
    await creerVersion(technique, code, version, null);
    const { id: versionId } = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } });
    // Le barème de départ vient du classeur (il porte les jeux d'essai, qui s'éditent en B5) ; tout le reste se modifie ensuite à l'écran.
    await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await construireClasseur(secuproDeTest(), { titre: "SECURPRO inventé (test B4)" }), null);

    // 1. L'écran s'ouvre sur le brouillon enregistré, sans aucun problème (le rendu de l'éditeur est vérifié par EditeurBareme.test.tsx).
    const ouvert = (await lireBaremePourEdition(technique, versionId))!;
    const doc = schemaBareme.parse(ouvert.brouillon!.contenu);
    expect(verifierBareme(doc, { publication: true })).toEqual([]);

    // 2. Un champ liste (« Zone »), une garantie à deux composantes (« Assistance »), un taux modifié (dégâts des eaux : 6 ‰ → 7 ‰).
    let b: Bareme = doc;
    b = { ...b, champs: [...b.champs, { ...champNeuf("zone", "Zone", "LISTE"), bloc: "local", valeurs: [{ v: "URBAINE", l: "Urbaine" }, { v: "RURALE", l: "Rurale" }] }] };
    b = {
      ...b,
      garanties: [
        ...b.garanties,
        {
          ...garantieNeuve("assistance", "Assistance"),
          souscription: "OPTIONNELLE",
          composantes: [
            { code: "depannage", assiette: "stocks", taux: { unite: "PERMILLE", fixe: "0.4" } },
            { code: "rapatriement", souscription: "OPTIONNELLE", assiette: ["PCT_PLAFOND", "stocks", "10", "500000"], taux: { unite: "POURCENT", fixe: "1" } },
          ],
        },
      ],
    };
    const tauxInitial = "6";
    b = { ...b, garanties: b.garanties.map((g) => (g.code === "dde" ? { ...g, composantes: g.composantes.map((c) => ({ ...c, taux: { unite: "PERMILLE" as const, fixe: "7" } })) } : g)) };
    expect(verifierBareme(b, { publication: true })).toEqual([]);

    // 3. Enregistrer (comme le bouton), puis rejouer les essais : l'écart s'affiche, ligne à ligne.
    const enregistre = await enregistrerBrouillonBareme(technique, versionId, b, null, { toleranceIntegrite: true });
    expect(enregistre.problemes).toEqual([]);
    // Un champ OBLIGATOIRE ajouté fait échouer les essais existants (ils ne le renseignent pas) : l'écart le dit, et les essais se corrigent par
    // le classeur jusqu'à B5. Ici le champ devient facultatif, et seul l'écart voulu demeure.
    const obligatoire = (await rejouerLesEssaisBareme(technique, versionId)).map(decrireEcart);
    expect(obligatoire.length).toBe(3);
    expect(obligatoire.every((t) => t.includes("Le champ « Zone » est obligatoire"))).toBe(true);
    b = { ...b, champs: b.champs.map((c) => (c.code === "zone" ? { ...c, obligatoire: false } : c)) };
    await enregistrerBrouillonBareme(technique, versionId, b, null, { toleranceIntegrite: true });
    const ecarts = await rejouerLesEssaisBareme(technique, versionId);
    expect(ecarts.length).toBeGreaterThan(0);
    const textes = ecarts.map(decrireEcart);
    expect(textes.join("\n")).toContain("Essai « Électronique, locataire, boutique », ligne « dde »");
    expect(textes.some((t) => /ligne « dde », .*attendu 12000, obtenu 14000/.test(t))).toBe(true);
    // La publication, elle, est refusée tant que l'écart demeure.
    await expect(publierBareme(technique, versionId, "Avec écart", null)).rejects.toThrow(/Publication refusée/);

    // 4. Corriger le taux, enregistrer, rejouer : tous verts, publication, relecture du publié avec le champ et la garantie ajoutés.
    b = { ...b, garanties: b.garanties.map((g) => (g.code === "dde" ? { ...g, composantes: g.composantes.map((c) => ({ ...c, taux: { unite: "PERMILLE" as const, fixe: tauxInitial } })) } : g)) };
    await enregistrerBrouillonBareme(technique, versionId, b, null, { toleranceIntegrite: true });
    expect(await rejouerLesEssaisBareme(technique, versionId)).toEqual([]);
    const { empreinte } = await publierBareme(technique, versionId, "Barème édité à l'écran (test B4)", null);
    const publie = await lireBaremePublie(obtenirPrisma(), versionId);
    expect(publie.empreinte).toBe(empreinte);
    expect(publie.bareme.champs.some((c) => c.code === "zone" && c.type === "LISTE")).toBe(true);
    expect(publie.bareme.garanties.find((g) => g.code === "assistance")?.composantes.map((c) => c.code)).toEqual(["depannage", "rapatriement"]);

    // 5. Publié : l'écran ne propose plus que la consultation.
    const apres = (await lireBaremePourEdition(technique, versionId))!;
    expect(apres.brouillon).toBeNull();
    expect(apres.publie?.empreinte).toBe(empreinte);
    expect(apres.codesFiges).toEqual(expect.arrayContaining(["zone"]));
  });
});
