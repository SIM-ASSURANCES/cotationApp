// Démonstration des sessions B3 et B9 : importe le SECURPRO INVENTÉ par un classeur Excel (généré ici), le publie, bascule la version
// au barème, puis montre le refus d'un barème dont un essai échoue.
// Écrit des données de démonstration (comptes, taxes, produits aux codes aléatoires) : réservé à une base de test ou de développement.
//   npm run demo:bareme          (base dont le nom finit par _test, ou AUTORISER_DEMO_BAREME=oui dans l'environnement)
// Jamais sur le VPS.
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const base = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgresql://x/inconnue").pathname.slice(1));
if (!base.endsWith("_test") && process.env.AUTORISER_DEMO_BAREME !== "oui") {
  console.error(`Refus : la démonstration écrit dans la base « ${base} ». Utilisez une base _test, ou posez AUTORISER_DEMO_BAREME=oui (poste de développement).`);
  process.exit(1);
}

const { documentSecurpro } = await import("../src/domaine/bareme/securpro-fixture");
const { basculerVersionAuBareme, publierBareme, rejouerLesEssaisBareme, ErreurPublicationBareme } = await import("../src/serveur/bareme");
const { construireClasseur } = await import("../src/serveur/bareme-classeur-ecriture");
const { importerBaremeXlsx } = await import("../src/serveur/bareme-excel");
const { lireBareme } = await import("../src/domaine/bareme");
const { ajouterJours, aujourdhui } = await import("../src/domaine/calcul/dates");
const { initialiserProfilsEtDroits } = await import("../src/serveur/droits");
const { creerProduit, creerTaxe, creerVersion } = await import("../src/serveur/parametrage");
const { obtenirPrisma } = await import("../src/serveur/prisma");
const { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } = await import("../src/serveur/utilisateurs");

const prisma = obtenirPrisma();
const suffixe = Math.random().toString(36).slice(2, 8);
const MDP = "phrase-de-passe-inventee-2026";
const compte = async (identifiant: string) => versUtilisateurCourant(await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));

await initialiserProfilsEtDroits();
await creerAdministrateurInitial({ identifiant: `demo-admin-${suffixe}`, nom: "Admin démo", motDePasse: MDP });
await creerUtilisateur(await compte(`demo-admin-${suffixe}`), { identifiant: `demo-technique-${suffixe}`, nom: "Technique démo", profil: "TECHNIQUE", motDePasse: MDP }, null);
const technique = await compte(`demo-technique-${suffixe}`);

const IARD = `DEMO_IARD_${suffixe.toUpperCase()}`;
const INCENDIE = `DEMO_INCENDIE_${suffixe.toUpperCase()}`;
for (const [code, taux] of [[IARD, "7.25"], [INCENDIE, "12.5"]] as const) {
  await prisma.branche.create({ data: { code, libelle: `${code} (démo)`, creePar: "demo" } });
  await creerTaxe(technique, { branche: code, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: taux, assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
}

/** SECURPRO inventé, rattaché aux catégories de taxe de la démonstration. */
const document = () => {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[]; jeuxEssai: { attendu: { ttc: string; lignes: { nette: string }[] } }[] };
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return d;
};

async function versionACreer(code: string): Promise<number> {
  await creerProduit(technique, { code, libelle: "Sécur Pro (barème inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(
    technique,
    code,
    {
      // Une version ne naît pas au barème : autre mode, date future ; le barème est importé et publié, puis la version bascule.
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
  return (await prisma.produitVersion.findFirstOrThrow({ where: { produit: { code } } })).id;
}

console.log("=== 1. Publication du SECURPRO inventé (essais : 139 420 F TTC) ===");
const versionA = await versionACreer(`DEMO_SECURPRO_${suffixe.toUpperCase()}`);
const classeur = (d: ReturnType<typeof document>) => construireClasseur(lireBareme(d), { titre: "Classeur de démonstration (inventé)" });
const brouillon = await importerBaremeXlsx(technique, versionA, "securpro.xlsx", await classeur(document()), null);
console.log(`classeur Excel importé en brouillon (empreinte ${brouillon.empreinte.slice(0, 16)}…)`);
console.log(`écarts des essais : ${(await rejouerLesEssaisBareme(technique, versionA)).length}`);
const publie = await publierBareme(technique, versionA, "Démonstration B3 : publication du SECURPRO inventé", null);
console.log(`PUBLIÉ par ${technique.identifiant} (empreinte ${publie.empreinte.slice(0, 16)}…)`);
await basculerVersionAuBareme(technique, versionA, null);
console.log(`version basculée au mode : ${(await prisma.produitVersion.findUniqueOrThrow({ where: { id: versionA } })).modeTarification}`);

console.log("\n=== 2. Refus d'un barème dont un essai échoue ===");
const versionB = await versionACreer(`DEMO_ECART_${suffixe.toUpperCase()}`);
const faux = document();
faux.jeuxEssai[0].attendu.lignes[1].nette = "20961";
faux.jeuxEssai[0].attendu.ttc = "139421";
await importerBaremeXlsx(technique, versionB, "ecart.xlsx", await classeur(faux), null);
try {
  await publierBareme(technique, versionB, "Démonstration B3 : publication qui doit être refusée", null);
  console.error("ANOMALIE : la publication aurait dû être refusée.");
  process.exitCode = 1;
} catch (erreur) {
  if (!(erreur instanceof ErreurPublicationBareme)) throw erreur;
  console.log(`REFUSÉE : ${erreur.message}`);
  for (const ligne of erreur.details) console.log(`  - ${ligne}`);
  const statut = (await prisma.baremeDocument.findFirstOrThrow({ where: { versionId: versionB } })).statut;
  console.log(`le barème reste en ${statut}`);
}
await prisma.$disconnect();
