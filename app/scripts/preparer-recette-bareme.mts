// Prépare une base de recette pour scripts/verifier-cotation-bareme.mjs : SECURPRO inventé publié et en vigueur, un compte Commercial
// (sans changement de mot de passe à faire). Données INVENTÉES uniquement ; réservé à une base dont le nom finit par _test.
//   DATABASE_URL=postgresql://…/sim_documents_recette_test npx tsx --conditions=react-server scripts/preparer-recette-bareme.mts
// La base doit exister et porter les migrations (npm run migrate:deploy avec la même DATABASE_URL). Affiche le produit et les comptes.
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const base = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgresql://x/inconnue").pathname.slice(1));
if (!base.endsWith("_test")) {
  console.error(`Refus : la base « ${base} » n'est pas une base de test (nom en _test exigé).`);
  process.exit(1);
}

const { documentSecurpro } = await import("../src/domaine/bareme/securpro-fixture");
const { basculerVersionAuBareme, publierBareme } = await import("../src/serveur/bareme");
const { construireClasseur } = await import("../src/serveur/bareme-classeur-ecriture");
const { importerBaremeXlsx } = await import("../src/serveur/bareme-excel");
const { lireBareme } = await import("../src/domaine/bareme");
const { ajouterJours, aujourdhui } = await import("../src/domaine/calcul/dates");
const { initialiserProfilsEtDroits } = await import("../src/serveur/droits");
const { creerProduit, creerTaxe, creerVersion } = await import("../src/serveur/parametrage");
const { obtenirPrisma } = await import("../src/serveur/prisma");
const { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } = await import("../src/serveur/utilisateurs");

const prisma = obtenirPrisma();
const MDP = "phrase-de-passe-recette-inventee-2026";
const compte = async (identifiant: string) => versUtilisateurCourant(await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

await initialiserProfilsEtDroits();
await creerAdministrateurInitial({ identifiant: "recette-admin", nom: "Admin recette", motDePasse: MDP });
const admin = await compte("recette-admin");
await creerUtilisateur(admin, { identifiant: "recette-technique", nom: "Technique recette", profil: "TECHNIQUE", motDePasse: MDP }, null);
await creerUtilisateur(admin, { identifiant: "recette-commercial", nom: "Commercial recette", profil: "COMMERCIAL", motDePasse: MDP }, null);
// Comptes de recette : le changement de mot de passe obligatoire est vérifié ailleurs (verifier-mot-de-passe.mjs).
await prisma.utilisateur.updateMany({ where: { identifiant: { in: ["recette-admin", "recette-technique", "recette-commercial"] } }, data: { doitChangerMotDePasse: false } });
const technique = await compte("recette-technique");

const IARD = "RECETTE_IARD";
const INCENDIE = "RECETTE_INCENDIE";
for (const [code, taux] of [[IARD, "7.25"], [INCENDIE, "12.5"]] as const) {
  await prisma.branche.create({ data: { code, libelle: `${code} (recette)`, creePar: "recette" } });
  await creerTaxe(technique, { branche: code, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: taux, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
}

const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
const carte: Record<string, string> = { IARD, INCENDIE };
d.produit.taxe = carte[d.produit.taxe];
for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];

const CODE = "RECETTE_SECURPRO";
await creerProduit(technique, { code: CODE, libelle: "Sécur Pro (recette inventée)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
await creerVersion(
  technique,
  CODE,
  {
    dateEffet: ajouterJours(aujourdhui(), 1),
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
  },
  null,
);
const versionId = (await prisma.produitVersion.findFirstOrThrow({ where: { produit: { code: CODE } } })).id;
await importerBaremeXlsx(technique, versionId, "securpro.xlsx", await construireClasseur(lireBareme(d), { titre: "SECURPRO inventé (recette)" }), null);
await publierBareme(technique, versionId, "Barème SECURPRO inventé (recette navigateur)", null);
await basculerVersionAuBareme(technique, versionId, null);
// Mise en vigueur « à la main » (base de recette seulement : on ne peut pas attendre la date d'effet).
await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
  await tx.$executeRawUnsafe(`UPDATE produit_versions SET date_effet = DATE '2020-01-01' WHERE id = ${versionId}`);
});
console.log(JSON.stringify({ produit: CODE, comptes: ["recette-commercial", "recette-technique", "recette-admin"], motDePasse: MDP }));
await prisma.$disconnect();
