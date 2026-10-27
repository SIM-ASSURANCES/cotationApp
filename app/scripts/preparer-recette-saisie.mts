// Complète la base de recette de scripts/preparer-recette-bareme.mts pour scripts/verifier-saisie-conservee.mjs : une facture ÉMISE
// (donc payable) sur une police inventée. Générateur et stockage simulés dans ce processus (aucun PDF réel). Données INVENTÉES
// uniquement ; réservé à une base dont le nom finit par _test. À lancer APRÈS preparer-recette-bareme.mts :
//   DATABASE_URL=postgresql://…/sim_documents_recette_test npx tsx --conditions=react-server scripts/preparer-recette-saisie.mts
import { createHash } from "node:crypto";

import nextEnv from "@next/env";

process.env.URL_PUBLIQUE ??= "https://documents.exemple.ci";

nextEnv.loadEnvConfig(process.cwd());

const base = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgresql://x/inconnue").pathname.slice(1));
if (!base.endsWith("_test")) {
  console.error(`Refus : la base « ${base} » n'est pas une base de test (nom en _test exigé).`);
  process.exit(1);
}

const { ajouterJours, aujourdhui } = await import("../src/domaine/calcul/dates");
const { assurerBranche, rattacherCgDeTest } = await import("../src/serveur/branches-test");
const { accepter, creerBrouillon, soumettre, valider } = await import("../src/serveur/cotations");
const { emettreCp } = await import("../src/serveur/documents");
const { creerFactureAffaireNouvelle, emettreFacture } = await import("../src/serveur/factures");
const { remplacerGenerateur } = await import("../src/serveur/generateur");
const { creerModele, deposerVersion, publierVersion, soumettreVersion } = await import("../src/serveur/modeles");
const { creerProduit, creerTaxe, creerVersion } = await import("../src/serveur/parametrage");
const { obtenirPrisma } = await import("../src/serveur/prisma");
const { assurerSignature } = await import("../src/serveur/societe-test");
const { remplacerStockage } = await import("../src/serveur/stockage");
const { creerUtilisateur, versUtilisateurCourant } = await import("../src/serveur/utilisateurs");

const prisma = obtenirPrisma();
const MDP = "phrase-de-passe-recette-inventee-2026";
const compte = async (identifiant: string) => versUtilisateurCourant(await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
const texte = (t: string) => new TextEncoder().encode(t);

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const analyse = (chemins: string[], options: { filtres?: string[]; textes?: string[] } = {}) => ({
  docx_valide: true,
  erreur: null,
  nombre_balises: chemins.length,
  references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
  problemes: [],
  champs_word: [],
  blocs: [],
  filtres: options.filtres ?? [],
  polices: [],
  polices_absentes: [],
  textes: (options.textes ?? []).map((t) => ({ texte: t, emplacement: ici })),
});
let prochaine = analyse([]);
remplacerGenerateur({ analyser: async () => prochaine as never, genererPdf: async () => texte("%PDF-1.7 simulé") });
const fichiers = new Map<string, Uint8Array>();
remplacerStockage({
  async ecrire(chemin: string, contenu: Uint8Array) {
    fichiers.set(chemin, contenu);
    return { empreinte: createHash("sha256").update(contenu).digest("hex") };
  },
  async lire(chemin: string) {
    return fichiers.get(chemin) ?? texte("x");
  },
  async zip(liste: { nom: string }[]) {
    return texte(`PK ${liste.map((f) => f.nom).join(",")}`);
  },
} as never);

const admin = await compte("recette-admin");
const technique = await compte("recette-technique");
const commercial = await compte("recette-commercial");
await creerUtilisateur(admin, { identifiant: "recette-dg", nom: "DG recette", profil: "DIRECTION_GENERALE", motDePasse: MDP }, null);
await creerUtilisateur(admin, { identifiant: "recette-gestionnaire", nom: "Gestionnaire recette", profil: "GESTIONNAIRE_PRODUCTION", motDePasse: MDP }, null);
await prisma.utilisateur.updateMany({ where: { identifiant: { in: ["recette-dg", "recette-gestionnaire"] } }, data: { doitChangerMotDePasse: false } });
const dg = await compte("recette-dg");
const gestionnaire = await compte("recette-gestionnaire");
await assurerSignature(technique);

const CP = ["police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "police.duree_libelle", "prime.nette", "prime.accessoires", "prime.taxe", "produit.cg_libelle", "produit.cg_visa", "societe.email_reclamation", "doc.lieu_emission", "doc.date_emission", "signature_sim"];
const FACTURE = ["doc.numero", "doc.date_emission", "police.numero", "police.date_effet", "police.date_echeance", "souscripteur.raison_sociale", "souscripteur.adresse", "prime.taux_taxe", "prime.taxe", "prime.ttc", "societe.rccm", "societe.ncc", "societe.rib[].numero", "societe.mobile_money[].numero_marchand", "signature_sim", "qr_code", "echeances[].statut", "solde.restant_du", "envoye_a.nom"];
const RECU = ["police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "paiements[].montant", "doc.facture_origine"];
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
async function publier(type: "CP" | "CG" | "FACTURE" | "RECU", code: string | null, a: ReturnType<typeof analyse>, visa?: string) {
  const id = await creerModele(technique, { type, code: `RECETTE_${type}${code ? `_${code}` : ""}`, libelle: `Modèle ${type} (recette)`, produitCode: code, ...sans }, null);
  prochaine = a;
  await deposerVersion(technique, id, { fichier: texte(`docx ${type}`), nomFichier: "m.docx", commentaire: "recette", dateEffet: aujourdhui(), visa: visa ?? null, dateDocument: visa ? "2025-06-19" : null }, null);
  const v = await prisma.modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return (await prisma.modele.findUniqueOrThrow({ where: { id } })).code;
}

const cg = await publier("CG", null, analyse(["produit.cg_visa"]), "VISA-INVENTE-01");
await rattacherCgDeTest("MALADIE", cg);

const CODE = "RECETTE_SANTE";
const branche = await assurerBranche("RECETTE_SANTE_BR");
await creerTaxe(technique, { branche, typeContrat: "INDIVIDUEL", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
await creerProduit(technique, { code: CODE, libelle: "Santé individuelle (recette inventée)", gamme: "RELAX", branchePrincipale: "MALADIE", branche }, null);
await creerVersion(
  technique,
  CODE,
  {
    dateEffet: "2020-01-01",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: true, primeMinimale: null },
    fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    seuilValidationTtc: null,
    formules: [{ code: "F", libelle: "Formule unique", tauxCouverture: "80", primeUnitaire: "270129.11", accessoireMode: "AUCUN", accessoireValeur: "0" }],
    references: { csModeleCode: null, csVisa: null },
  } as never,
  null,
);
await publier("CP", CODE, analyse(CP));
await publier("FACTURE", null, analyse(FACTURE, { filtres: ["lettres"], textes: ["Article 13 du Code CIMA : la prise d'effet est subordonnée au paiement de la prime."] }));
await publier("RECU", null, analyse(RECU));

const cotationId = await creerBrouillon(
  commercial,
  {
    codeProduit: CODE,
    typeContrat: "INDIVIDUEL",
    clientId: null,
    motifForcage: null,
    beneficiaires: [],
    contactsUrgence: [],
    risque: {},
    souscripteur: { type: "PHYSIQUE", nom: "YAO", prenoms: "Koffi (inventé)", raison_sociale: "", telephone: "0700000000", email: "", adresse: "Cocody, rue inventée" },
    dateEffet: aujourdhui(),
    dateEcheance: ajouterJours(aujourdhui(), 364),
    nombreTranches: 1,
    lignes: [{ codeFormule: "F", effectif: 1 }],
    assures: [],
  } as never,
  null,
);
if ((await soumettre(commercial, cotationId, null)).statut === "A_VALIDER") await valider(technique, cotationId, null);
const { numeroPolice } = await accepter(commercial, cotationId, ["F"], `REC-${aujourdhui().slice(0, 4)}-000001-I00001`, null);
await emettreCp(technique, cotationId, null);
const police = await prisma.police.findUniqueOrThrow({ where: { numero: numeroPolice } });
const factureId = await creerFactureAffaireNouvelle(gestionnaire, police.id, { nom: "Payeur inventé", adresse: "Plateau, rue inventée" }, null);
const r = await emettreFacture(gestionnaire, factureId, null);
console.log(JSON.stringify({ factureId, statut: r.statut, comptes: ["recette-gestionnaire", "recette-dg"], motDePasse: MDP }));
await prisma.$disconnect();
