// Complète la base de recette pour scripts/verifier-retouches.mjs (D63) : un produit à la formule inspiré de l'offre BENI (T1 : 3 Solo + 60 Famille
// = 15 888 000 F en contrat de groupe), un produit sans aucun modèle dans une autre branche, et une version de CP SOUMISE qui attend sa publication
// (vue « À valider / À publier »). Données INVENTÉES uniquement ; réservé à une base dont le nom finit par _test. À lancer APRÈS
// preparer-recette-bareme.mts puis preparer-recette-saisie.mts (comptes recette-technique, recette-commercial, recette-dg) :
//   DATABASE_URL=postgresql://…/sim_documents_recette_test npx tsx --conditions=react-server scripts/preparer-recette-retouches.mts
import { createHash } from "node:crypto";

import nextEnv from "@next/env";

process.env.URL_PUBLIQUE ??= "https://documents.exemple.ci";

nextEnv.loadEnvConfig(process.cwd());

const base = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgresql://x/inconnue").pathname.slice(1));
if (!base.endsWith("_test")) {
  console.error(`Refus : la base « ${base} » n'est pas une base de test (nom en _test exigé).`);
  process.exit(1);
}

const { aujourdhui } = await import("../src/domaine/calcul/dates");
const { assurerBranche } = await import("../src/serveur/branches-test");
const { remplacerGenerateur } = await import("../src/serveur/generateur");
const { creerModele, deposerVersion, soumettreVersion } = await import("../src/serveur/modeles");
const { creerProduit, creerTaxe, creerVersion } = await import("../src/serveur/parametrage");
const { obtenirPrisma } = await import("../src/serveur/prisma");
const { remplacerStockage } = await import("../src/serveur/stockage");
const { versUtilisateurCourant } = await import("../src/serveur/utilisateurs");

const prisma = obtenirPrisma();
const compte = async (identifiant: string) => versUtilisateurCourant(await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
const texte = (t: string) => new TextEncoder().encode(t);
const technique = await compte("recette-technique");

// Seuil de double validation : 20 000 000 F (T1 = 15 888 000 F reste sous le seuil).
const DATE_SEUIL = new Date("2026-01-01T00:00:00.000Z");
await prisma.parametre.upsert({
  where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: DATE_SEUIL } },
  update: { valeur: "20000000" },
  create: { cle: "seuil_validation_global", valeur: "20000000", dateEffet: DATE_SEUIL, creePar: "recette" },
});

const BENI = "RECETTE_BENI";
const brancheBeni = await assurerBranche("RECETTE_BENI_BR");
await creerTaxe(technique, { branche: brancheBeni, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
await creerProduit(technique, { code: BENI, libelle: "Santé BENI (recette inventée)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: brancheBeni }, null);
await creerVersion(
  technique,
  BENI,
  {
    dateEffet: "2020-01-01",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: true, primeMinimale: null },
    fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    seuilValidationTtc: null,
    formules: [
      { code: "SOLO", libelle: "Solo", tauxCouverture: null, primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" },
      { code: "FAMILLE", libelle: "Famille", tauxCouverture: null, primeUnitaire: "252657.63", accessoireMode: "FIXE", accessoireValeur: "210000" },
    ],
    references: { csModeleCode: null, csVisa: null },
  } as never,
  null,
);

// Un produit sans aucun modèle, dans une autre branche : sur l'écran Modèles, ses trois modèles « manquent ».
await creerProduit(technique, { code: "RECETTE_DECES", libelle: "Décès emprunteur (recette inventée)", gamme: "SECUR", branchePrincipale: "DECES", branche: brancheBeni }, null);

// Une version de CP soumise : elle attend la Direction Générale.
const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const CP = ["police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "police.duree_libelle", "prime.nette", "prime.accessoires", "prime.taxe", "produit.cg_libelle", "produit.cg_visa", "societe.email_reclamation", "doc.lieu_emission", "doc.date_emission", "signature_sim"];
const analyseCp = {
  docx_valide: true,
  erreur: null,
  nombre_balises: CP.length,
  references: CP.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
  problemes: [],
  champs_word: [],
  blocs: [],
  filtres: [],
  polices: [],
  polices_absentes: [],
  textes: [],
};
remplacerGenerateur({ analyser: async () => analyseCp as never, genererPdf: async () => texte("%PDF-1.7 simulé") });
remplacerStockage({
  async ecrire(_chemin: string, contenu: Uint8Array) {
    return { empreinte: createHash("sha256").update(contenu).digest("hex") };
  },
  async lire() {
    return texte("x");
  },
  async zip() {
    return texte("PK");
  },
} as never);
const idCp = await creerModele(technique, { type: "CP", code: "RECETTE_CP_BENI", libelle: "CP BENI (recette)", produitCode: BENI, niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null }, null);
await deposerVersion(technique, idCp, { fichier: texte("docx CP BENI"), nomFichier: "m.docx", commentaire: "recette", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null);
const v = await prisma.modeleVersion.findFirstOrThrow({ where: { modeleId: idCp }, orderBy: { numero: "desc" } });
await soumettreVersion(technique, v.id, null);

console.log(JSON.stringify({ produitT1: BENI, produitSansModele: "RECETTE_DECES", cpSoumis: idCp }));
await prisma.$disconnect();
