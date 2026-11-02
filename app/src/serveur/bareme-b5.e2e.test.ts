// Bout en bout (npm run test:e2e), session B5 (D59) : la recette. Le SECURPRO INVENTÉ est saisi ENTIÈREMENT à l'écran (champs, valeurs
// intermédiaires, garanties, tables, sous-jacents, jeu d'essai : opérations de l'éditeur, aucun classeur) et donne 139 420 F TTC ; puis
// enregistrement, contrôle des essais et des modèles (onglet Publier), publication, bascule, et cotation par le Commercial au même
// montant. Les clics du navigateur sont vérifiés à la main (compte rendu) ; ici, les mêmes fonctions de domaine et les mêmes services.
// Jamais le barème réel.
import { beforeAll, describe, expect, it } from "vitest";

import { schemaBareme, verifierBareme } from "@/domaine/bareme";
import { secuproSaisiALEcran } from "@/domaine/bareme/securpro-ecran";
import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Souscripteur } from "@/domaine/cotation/saisie";

import { assurerBranche } from "./branches-test";
import { basculerVersionAuBareme, controlerAvantPublication, empreinteBareme, enregistrerBrouillonBareme, lireBaremePublie, publierBareme } from "./bareme";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { creerBaremeVide, lireBaremePourEdition } from "./bareme-edition";
import { importerBaremeXlsx } from "./bareme-excel";
import { calculerCotationBareme, creerBrouillon, lireCotation, type SaisieCotation } from "./cotations";
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
let commercial: UtilisateurCourant;
let IARD: string;
let INCENDIE: string;

const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

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

const souscripteur: Souscripteur = {
  type: "MORALE",
  nom: "",
  prenoms: "",
  raison_sociale: "ATELIERS DU LAGON SARL (inventée)",
  telephone: "0700000000",
  email: "contact@ateliers-lagon.exemple.ci",
  adresse: "Zone industrielle de Yopougon, rue inventée, Abidjan",
};

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const admin = await compte(idAdmin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: `${profil} Test`, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, commercial] = [await nouveau("TECHNIQUE"), await nouveau("COMMERCIAL")];
  INCENDIE = `INC_${CODE("T")}`.slice(0, 20);
  IARD = `IARD_${CODE("T")}`.slice(0, 20);
  await assurerBranche(INCENDIE);
  await assurerBranche(IARD);
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
});

describe("Recette B5 : SECURPRO inventé saisi entièrement à l'écran, publié, basculé, coté par le Commercial", () => {
  it("139 420 F TTC de l'écran à la cotation", async () => {
    const code = CODE("SECURPRO_ECRAN");
    await creerProduit(technique, { code, libelle: "Sécur Pro saisi à l'écran (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
    await creerVersion(technique, code, version, null);
    const { id: versionId } = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } });

    // 1. « Créer un barème vide », puis tout se saisit à l'écran : aucun classeur.
    await creerBaremeVide(technique, versionId, null);
    const ouvert = (await lireBaremePourEdition(technique, versionId))!;
    expect(schemaBareme.parse(ouvert.brouillon!.contenu).champs).toEqual([]);

    // 2. Champs, intermédiaires, garanties, tables (cases tapées, « Remplir avec 1 », plages collées), sous-jacents guidés, jeux d'essai à l'attendu tapé.
    const saisi = secuproSaisiALEcran({ taxe: IARD, taxeIncendie: INCENDIE });
    expect(verifierBareme(saisi, { publication: true })).toEqual([]); // contrôles en continu : rien de rouge

    const r = await enregistrerBrouillonBareme(technique, versionId, saisi, null, { toleranceIntegrite: true });
    expect(r.problemes).toEqual([]);
    expect(r.empreinte).toBe(empreinteBareme(saisi));

    // 3. Onglet Publier : tous les essais sont verts et aucun modèle publié ne cite une balise absente.
    const controles = await controlerAvantPublication(technique, versionId);
    expect(controles).toEqual({ nombreEssais: 3, ecarts: [], balises: [] });

    // 4. Publication (motif obligatoire), puis bascule au barème.
    await expect(publierBareme(technique, versionId, "  ", null)).rejects.toThrow(/motif/i);
    const publie = await publierBareme(technique, versionId, "SECURPRO inventé saisi à l'écran (recette B5)", null);
    expect(publie.empreinte).toBe(r.empreinte);
    await basculerVersionAuBareme(technique, versionId, null);
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: versionId } })).modeTarification).toBe("BAREME");

    // 5. Le barème publié est exactement le document saisi, et il passe par le classeur sans rien perdre (même document que l'import).
    const lu = await lireBaremePublie(obtenirPrisma(), versionId);
    expect(lu.empreinte).toBe(empreinteBareme(saisi));
    const copie = await creerVersionPourLeClasseur(code);
    await importerBaremeXlsx(technique, copie, "securpro-ecran.xlsx", await construireClasseur(lu.bareme, { titre: "SECURPRO inventé saisi à l'écran (test B5)" }), null);
    const reimporte = await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId: copie, statut: "BROUILLON" } });
    expect(reimporte.empreinte).toBe(lu.empreinte);

    // 6. En vigueur (test seulement : on ne peut pas attendre la date d'effet), le Commercial cote : 139 420 F TTC, comme l'essai que la Technique avait tapé.
    await obtenirPrisma().$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
      await tx.$executeRawUnsafe(`UPDATE produit_versions SET date_effet = DATE '2020-01-01' WHERE id = ${versionId}`);
    });
    const essai = lu.bareme.jeuxEssai[0];
    const brut = {
      champs: Object.fromEntries(Object.entries(essai.entrees.champs).map(([k, v]) => [k, Array.isArray(v) ? v : typeof v === "boolean" ? [v ? "OUI" : "NON"] : [v]])) as Record<string, string[]>,
      souscrit: essai.entrees.souscrit,
    };
    const effet = aujourdhui();
    const calcul = await calculerCotationBareme(commercial, { codeProduit: code, typeContrat: "INDIVIDUEL", regimeTaxe: "INDIVIDUEL", dateEffet: effet, dateEcheance: ajouterJours(effet, 364), nombreTranches: 1, baremeBrut: brut });
    expect(calcul.totaux).toEqual({ nette: "113851", accessoires: "15000", taxe: "10569", ttc: "139420" });
    expect(calcul.lignes.map((l) => l.ttc)).toEqual(["26315", "25161", "15551", "13406", "13406", "45581"]);

    const saisie: SaisieCotation = {
      codeProduit: code,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur,
      dateEffet: effet,
      dateEcheance: ajouterJours(effet, 364),
      nombreTranches: 1,
      lignes: [],
      motifForcage: null,
      assures: [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
      baremeBrut: brut,
    };
    const cotationId = await creerBrouillon(commercial, saisie, null);
    const cotation = (await lireCotation(technique, cotationId))!;
    expect(cotation.modeTarification).toBe("BAREME");
    expect(cotation.resultat.totaux.arrondi.ttc.toFixed()).toBe("139420");
    expect(cotation.composition!.bareme!.empreinte).toBe(publie.empreinte);
  });
});

/** Une seconde version (à venir) du même produit, pour y importer le classeur du barème publié. */
async function creerVersionPourLeClasseur(codeProduit: string): Promise<number> {
  await creerVersion(technique, codeProduit, { ...version, dateEffet: ajouterJours(aujourdhui(), 60) }, null);
  const v = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code: codeProduit }, dateEffet: { gt: new Date(`${ajouterJours(aujourdhui(), 30)}T00:00:00Z`) } } });
  return v.id;
}
