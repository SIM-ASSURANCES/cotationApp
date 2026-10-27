// Fiche d'une cotation (défaut de recette : « Droit insuffisant : factures » levé pendant le rendu pour un Commercial). Pour CHAQUE profil par
// défaut, les parties liées de la fiche d'une cotation acceptée (police, CP, facture, reçu) se chargent sans jamais lever d'erreur : seules les
// parties que le profil a le droit de lire sont présentes. Générateur SIMULÉ, stockage EN MÉMOIRE. Données inventées.
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Analyse } from "@/domaine/documents/analyse";
import { peutLire, type CodeAction } from "@/domaine/droits";

import { assurerBranche, rattacherCgDeTest } from "./branches-test";
import { accepter, creerBrouillon, lireCotation, soumettre, valider } from "./cotations";
import { emettreCp } from "./documents";
import { initialiserProfilsEtDroits, niveauDuProfil } from "./droits";
import { creerFactureAffaireNouvelle, emettreFacture, enregistrerPaiement, facturesDePolice } from "./factures";
import { chargerPartiesLiees } from "./fiche-cotation";
import { remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { assurerSignature } from "./societe-test";
import { remplacerStockage } from "./stockage";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const sha256 = (o: Uint8Array) => createHash("sha256").update(o).digest("hex");
const texte = (t: string) => new TextEncoder().encode(t);

// Les six profils par défaut ; l'Admin système est créé à part (creerAdministrateurInitial).
const PROFILS = ["COMMERCIAL", "GESTIONNAIRE_PRODUCTION", "TECHNIQUE", "COMPTABILITE", "DIRECTION_GENERALE"] as const;
const comptes = new Map<string, UtilisateurCourant>();
let cotationId = 0;
let prochaineAnalyse: Analyse;

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const analyse = (chemins: string[], options: { filtres?: string[]; textes?: string[] } = {}): Analyse => ({
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
const CONTENU_CP = [
  "police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "police.duree_libelle", "prime.nette", "prime.accessoires", "prime.taxe",
  "produit.cg_libelle", "produit.cg_visa", "societe.email_reclamation", "doc.lieu_emission", "doc.date_emission", "signature_sim",
];
const CONTENU_FACTURE = [
  "doc.numero", "doc.date_emission", "police.numero", "police.date_effet", "police.date_echeance", "souscripteur.raison_sociale", "souscripteur.adresse",
  "prime.taux_taxe", "prime.taxe", "prime.ttc", "societe.rccm", "societe.ncc", "societe.rib[].numero", "societe.mobile_money[].numero_marchand", "signature_sim", "qr_code",
  "echeances[].statut", "solde.restant_du", "envoye_a.nom",
];
const CONTENU_RECU = ["police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "paiements[].montant", "doc.facture_origine"];

const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
async function publier(type: "CP" | "CG" | "FACTURE" | "RECU", code: string | null, a: Analyse, options: { visa?: string } = {}) {
  const id = await creerModele(comptes.get("TECHNIQUE")!, { type, code: CODE(type), libelle: `Modèle ${type}`, produitCode: code, ...sans }, null);
  prochaineAnalyse = a;
  await deposerVersion(comptes.get("TECHNIQUE")!, id, { fichier: texte(`docx ${type}`), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: options.visa ?? null, dateDocument: options.visa ? "2025-06-19" : null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(comptes.get("TECHNIQUE")!, v.id, null);
  await publierVersion(comptes.get("DIRECTION_GENERALE")!, v.id, aujourdhui(), null);
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

beforeAll(async () => {
  fixerDateMinimumEffetPourTests("2026-01-01");
  const fichiers = new Map<string, Uint8Array>();
  remplacerGenerateur({ analyser: async () => prochaineAnalyse, genererPdf: async () => texte("%PDF-1.7 simulé") });
  remplacerStockage({
    async ecrire(chemin, contenu) {
      fichiers.set(chemin, contenu);
      return { empreinte: sha256(contenu) };
    },
    async lire(chemin) {
      const f = fichiers.get(chemin);
      if (!f) throw new ErreurMetier("Stockage : introuvable.");
      return f;
    },
    async zip(liste) {
      return texte(`PK ${liste.map((f) => f.nom).join(",")}`);
    },
  });
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const admin = await compte(idAdmin);
  comptes.set("ADMIN", admin);
  for (const profil of PROFILS) {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: `${profil} inventé`, profil, motDePasse: MDP }, null);
    comptes.set(profil, await compte(identifiant));
  }
  const technique = comptes.get("TECHNIQUE")!;
  await assurerSignature(technique);

  const cg = await publier("CG", null, analyse(["produit.cg_visa"]), { visa: "VISA-INVENTE-01" });
  await rattacherCgDeTest("MALADIE", cg);
  const produit = CODE("IND");
  const branche = await assurerBranche(`SANTE_${produit}`);
  await creerTaxe(technique, { branche, typeContrat: "INDIVIDUEL", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code: produit, libelle: "Santé individuelle (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche }, null);
  await creerVersion(
    technique,
    produit,
    {
      dateEffet: "2020-01-01",
      arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
      prorata: { actif: false, primeMinimale: null },
      fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
      cotation: { validiteMois: 3, formulesMax: 3 },
      references: { csModeleCode: null, csVisa: null },
      seuilValidationTtc: "20000000",
      formules: [{ code: "F", libelle: "Formule unique", tauxCouverture: "80", primeUnitaire: "100000", accessoireMode: "AUCUN", accessoireValeur: "0" }],
    } as VersionSaisie,
    null,
  );
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2020-01-01T00:00:00.000Z") } },
    update: { valeur: "20000000" },
    create: { cle: "seuil_validation_global", valeur: "20000000", dateEffet: new Date("2020-01-01T00:00:00.000Z"), creePar: "test" },
  });
  await publier("CP", produit, analyse(CONTENU_CP));
  await publier("FACTURE", null, analyse(CONTENU_FACTURE, { filtres: ["lettres"], textes: ["Article 13 du Code CIMA : la prise d'effet est subordonnée au paiement de la prime."] }));
  await publier("RECU", null, analyse(CONTENU_RECU));

  // Cotation acceptée avec police, CP émises, facture émise et un paiement (reçu).
  const commercial = comptes.get("COMMERCIAL")!;
  cotationId = await creerBrouillon(
    commercial,
    {
      codeProduit: produit,
      typeContrat: "INDIVIDUEL",
      clientId: null,
      souscripteur: { type: "PHYSIQUE", nom: "YAO", prenoms: "Koffi (inventé)", raison_sociale: "", telephone: "0700000000", email: "", adresse: "Cocody, rue inventée" },
      dateEffet: "2026-07-22",
      dateEcheance: "2026-12-31",
      nombreTranches: 1,
      lignes: [{ codeFormule: "F", effectif: 1 }],
      assures: [],
      motifForcage: null,
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
    } as never,
    null,
  );
  if ((await soumettre(commercial, cotationId, null)).statut === "A_VALIDER") await valider(technique, cotationId, null);
  const { numeroPolice } = await accepter(commercial, cotationId, ["F"], `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-I00001`, null);
  await emettreCp(technique, cotationId, null);
  const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero: numeroPolice } });
  const factureId = await creerFactureAffaireNouvelle(technique, police.id, null, null);
  await emettreFacture(technique, factureId, null);
  await enregistrerPaiement(comptes.get("GESTIONNAIRE_PRODUCTION")!, factureId, { date: aujourdhui(), montant: "1000", canal: "VIREMENT", reference: "VIR-INVENTE-001", payeur: "" }, null);
});

afterAll(async () => {
  fixerDateMinimumEffetPourTests(null);
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: "seuil_validation_global", dateEffet: new Date("2026-01-01T00:00:00.000Z") } },
    update: { valeur: "10000000" },
    create: { cle: "seuil_validation_global", valeur: "10000000", dateEffet: new Date("2026-01-01T00:00:00.000Z"), creePar: "test" },
  });
  await obtenirPrisma().parametre.deleteMany({ where: { cle: "seuil_validation_global", dateEffet: { not: new Date("2026-01-01T00:00:00.000Z") } } });
  remplacerGenerateur(null);
  remplacerStockage(null);
  await obtenirPrisma().$disconnect();
});

/** Droit qui ouvre la lecture de chaque type de document de la fiche (documents.ts, ACTION_DU_TYPE). */
const ACTION_DU_TYPE: Record<string, CodeAction> = { CP: "EMETTRE_CONTRAT", FACTURE: "EMETTRE_FACTURE", RECU: "ENREGISTRER_PAIEMENT" };

describe("fiche d'une cotation acceptée (police, CP, facture, reçu) : jamais d'erreur, seulement les parties autorisées", () => {
  for (const profil of [...PROFILS, "ADMIN"] as const) {
    it(profil, async () => {
      const acteur = comptes.get(profil)!;
      const lire = async (action: CodeAction) => peutLire(await niveauDuProfil(acteur.profil, action));

      if (!(await lire("CREER_COTATION"))) {
        // Pas de droit de lire les cotations : la page renvoie vers « accès refusé » (garde exigerDroit) et le service refuse aussi.
        await expect(lireCotation(acteur, cotationId)).rejects.toThrow(ErreurAcces);
        return;
      }
      const c = await lireCotation(acteur, cotationId);
      expect(c?.numeroPolice).toBeTruthy();
      const liees = await chargerPartiesLiees(acteur, c!); // ne doit JAMAIS lever

      const lireFactures = (await lire("EMETTRE_FACTURE")) || (await lire("EMETTRE_AVOIR")) || (await lire("ENREGISTRER_PAIEMENT"));
      const typesAttendus = (await Promise.all(Object.entries(ACTION_DU_TYPE).map(async ([type, action]) => ((await lire(action)) ? type : null)))).filter((t) => t !== null);
      // Une facture a plusieurs versions (réédition après paiement) : on compare les types.
      expect([...new Set(liees.documents.map((d) => d.type))].sort()).toEqual(typesAttendus.sort());
      expect(liees.accesFactures).toBe(lireFactures);
      expect(liees.vueFactures !== null).toBe(lireFactures);
      if (liees.vueFactures) expect(liees.vueFactures.factures).toHaveLength(1);
      expect(liees.etatContrat !== null).toBe(await lire("EMETTRE_CONTRAT"));
      if (!(await lire("EMETTRE_CONTRAT")) && !(await lire("EMETTRE_FACTURE"))) expect(liees.taches).toEqual([]);
    });
  }

  it("le Commercial (ni contrat, ni factures, ni reçus) : la fiche n'a aucune partie liée", async () => {
    const acteur = comptes.get("COMMERCIAL")!;
    const liees = await chargerPartiesLiees(acteur, (await lireCotation(acteur, cotationId))!);
    expect(liees).toMatchObject({ vueFactures: null, accesFactures: false, etatContrat: null, taches: [], documents: [] });
  });

  it("le contrôle reste au serveur : le service des factures refuse toujours le Commercial", async () => {
    await expect(facturesDePolice(comptes.get("COMMERCIAL")!, cotationId)).rejects.toThrow(ErreurAcces);
  });
});
