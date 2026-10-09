// Session 4a, contrats de groupe (CDC §10.2) : liste des adhérents par versions, annexe imposée, nouvelle
// version des CP, certificat d'adhésion unitaire. Générateur SIMULÉ, stockage EN MÉMOIRE.
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VersionSaisie } from "@/domaine/calcul/parametrage";
import type { Analyse } from "@/domaine/documents/analyse";
import type { Assure, Beneficiaire } from "@/domaine/cotation/saisie";

import { incorporerAdherents, lireAdherents, retirerAdherents } from "./adherents";
import { assurerBranche } from "./branches-test";
import { accepter, creerBrouillon, soumettre, type SaisieCotation } from "./cotations";
import { emettreCertificat, emettreCp, mettreAJourCp, reediter } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
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

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let produitCode: string;
let compteurPolice = 0;
const numeroPolice = (lettre: string) => `TST-2026-${String(Date.now() % 1_000_000).padStart(6, "0")}-${lettre}${String(++compteurPolice).padStart(5, "0")}`;

const demandes: DemandePdf[] = [];
const fichiers = new Map<string, Uint8Array>();
let prochaineAnalyse: Analyse;

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const analyse = (chemins: string[]): Analyse => ({
  docx_valide: true,
  erreur: null,
  nombre_balises: chemins.length,
  references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })),
  problemes: [],
  champs_word: [],
  blocs: [],
  filtres: [],
  polices: [],
  polices_absentes: [],
  textes: [],
});
const CONTENU_CP = [
  "police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc", "police.duree_libelle", "prime.nette", "prime.accessoires", "prime.taxe",
  "produit.cg_libelle", "produit.cg_visa", "societe.email_reclamation", "doc.lieu_emission", "doc.date_emission", "signature_sim",
];
const CONTENU_CERTIFICAT = ["police.numero", "police.police_mere", "souscripteur.nom", "police.date_effet", "doc.date_emission"];

const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
async function publier(type: "CP" | "CG" | "CERTIFICAT", code: string | null, chemins: string[], options: { visa?: string } = {}) {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: type === "CG" ? "SECUR DOMMAGE (test)" : `Modèle ${type}`, produitCode: code, ...sans }, null);
  prochaineAnalyse = analyse(chemins);
  await deposerVersion(technique, id, { fichier: texte(`docx ${type}`), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: options.visa ?? null, dateDocument: options.visa ? "2025-06-19" : null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, aujourdhui(), null);
  return { code: (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code };
}

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

const adherent = (i: number, formule = "SOLO"): Omit<Assure, "ordre"> => ({ nom_prenoms: `Adhérent ${i} Inventé`, date_naissance: "1990-01-01", sexe: i % 2 ? "F" : "M", lien: "Salarié", formule });
const trois: Assure[] = [1, 2, 3].map((i) => ({ ordre: i, ...adherent(i) }));
const benef: Beneficiaire[] = [{ ordre: 1, nom_prenoms: "KOUADIO Paul", lien: "Enfant", contact: "0700000011", quote_part: "100" }];

/** Police mère de groupe : 3 adhérents, un bénéficiaire, cotation émise puis acceptée. */
async function policeDeGroupe(): Promise<{ cotationId: number; policeId: number; numero: string }> {
  const saisie: SaisieCotation = {
    codeProduit: produitCode,
    clientId: null,
    typeContrat: "GROUPE",
    souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE", telephone: "", email: "", adresse: "" },
    dateEffet: "2026-01-01",
    dateEcheance: "2026-12-31",
    nombreTranches: 1,
    lignes: [{ codeFormule: "SOLO", effectif: 3 }],
    motifForcage: null,
    assures: trois,
    beneficiaires: benef,
    contactsUrgence: [],
    risque: {},
  };
  const cotationId = await creerBrouillon(commercial, saisie, null);
  expect((await soumettre(commercial, cotationId, null)).statut).toBe("EMISE");
  const { numeroPolice: numero } = await accepter(commercial, cotationId, ["SOLO"], numeroPolice("G"), null);
  const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { numero } });
  return { cotationId, policeId: police.id, numero };
}

const derniereDemande = () => demandes[demandes.length - 1];
const nombreAssures = (d: DemandePdf) => (d.donnees.assures as unknown[]).length;

beforeAll(async () => {
  remplacerGenerateur({
    analyser: async () => prochaineAnalyse,
    genererPdf: async (demande) => {
      demandes.push(demande);
      return texte(`%PDF-1.7 simulé ${demandes.length}`);
    },
  });
  remplacerStockage({
    async ecrire(chemin, contenu) {
      if (fichiers.has(chemin)) throw new ErreurMetier("Stockage : déjà stocké.");
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
  const admin = unique("admin");
  await creerAdministrateurInitial({ identifiant: admin, nom: "Admin", motDePasse: MDP });
  const a = await compte(admin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(a, { identifiant, nom: profil, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, dg, commercial] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL")];
  await assurerSignature(technique);

  const cg = await publier("CG", null, ["produit.cg_visa"], { visa: "MFB/DGTCP/DA/N° 01498" });
  const code = CODE("GRP");
  const branche = `SANTE_${code}`;
  await assurerBranche(branche);
  await creerTaxe(technique, { branche, typeContrat: "GROUPE", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code, libelle: "Santé groupe (test)", gamme: "RELAX", branche }, null);
  const version: VersionSaisie = {
    dateEffet: "2020-01-01",
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    prorata: { actif: true, primeMinimale: null },
    fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
    cotation: { validiteMois: 3, formulesMax: 3 },
    seuilValidationTtc: "20000000",
    formules: [{ code: "SOLO", libelle: "Solo", tauxCouverture: "80", primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" }],
    references: { cgModeleCode: cg.code, cgVisa: "MFB/DGTCP/DA/N° 01498", csModeleCode: null, csVisa: null },
  };
  await creerVersion(technique, code, version, null);
  await publier("CP", code, CONTENU_CP);
  await publier("CERTIFICAT", code, CONTENU_CERTIFICAT);
  produitCode = code;
});

afterAll(async () => {
  remplacerGenerateur(null);
  remplacerStockage(null);
  await obtenirPrisma().$disconnect();
});

describe("police mère : CP de groupe avec la liste des adhérents en annexe", () => {
  it("la liste est imposée en annexe même sous le seuil ; bénéficiaires et compléments passent dans les données", async () => {
    const { cotationId } = await policeDeGroupe();
    const cp = await emettreCp(technique, cotationId, null);

    expect(cp).toMatchObject({ type: "CP", version: 1 });
    expect(derniereDemande().listesEnAnnexe).toEqual(["assures"]);
    expect(nombreAssures(derniereDemande())).toBe(3);
    expect(derniereDemande().donnees.beneficiaires).toEqual(benef);
    expect(derniereDemande().donnees.contacts_urgence).toEqual([]);
    expect(derniereDemande().donnees.police).toMatchObject({ type_contrat: "GROUPE", police_mere: null, duree_libelle: "1 an" });
    // assures[].prime vient du moteur (H45) : TTC d'une unité, 288 000 / 3 = 96 000.
    expect((derniereDemande().donnees.assures as { ordre: number; prime: string | null }[]).map((a) => [a.ordre, a.prime])).toEqual([[1, "96000"], [2, "96000"], [3, "96000"]]);
  });

  it("un contrat individuel n'impose aucune annexe", async () => {
    const saisie: SaisieCotation = {
      codeProduit: produitCode,
      clientId: null,
      typeContrat: "INDIVIDUEL",
      souscripteur: { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa", raison_sociale: "", telephone: "", email: "", adresse: "" },
      dateEffet: "2026-01-01",
      dateEcheance: "2026-12-31",
      nombreTranches: 1,
      lignes: [{ codeFormule: "SOLO", effectif: 1 }],
      motifForcage: null,
      assures: [],
      beneficiaires: [],
      contactsUrgence: [],
      risque: {},
    };
    await creerTaxe(technique, { branche: (await obtenirPrisma().produit.findUniqueOrThrow({ where: { code: produitCode } })).branche, typeContrat: "INDIVIDUEL", tauxMixte: false, commentaire: null, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null).catch(() => undefined);
    const id = await creerBrouillon(commercial, saisie, null);
    await soumettre(commercial, id, null);
    await accepter(commercial, id, ["SOLO"], numeroPolice("I"), null);
    await emettreCp(technique, id, null);

    expect(derniereDemande().listesEnAnnexe).toEqual([]);
  });
});

describe("incorporation et retrait : nouvelles versions de la liste, nouvelle version de l'annexe", () => {
  it("incorpore, retire, numérote sans réutiliser un numéro, édite chaque fois une nouvelle version des CP et réédite à l'identique (T10)", async () => {
    const { cotationId, policeId, numero } = await policeDeGroupe();
    const v1 = await emettreCp(technique, cotationId, null);
    expect((await lireAdherents(technique, policeId))!.cp).toMatchObject({ version: 1, versionAdherents: 1 });

    // Rien n'a changé : pas de nouvelle version des CP.
    await expect(mettreAJourCp(technique, policeId, null)).rejects.toThrow(/n'a pas changé/);

    // Incorporation de deux adhérents : liste 2, numéros 4 et 5.
    const inc = await incorporerAdherents(technique, policeId, "2026-03-01", [adherent(4), adherent(5)], null);
    expect(inc).toEqual({ numeroVersion: 2, ordres: [4, 5] });
    const police = await obtenirPrisma().police.findUniqueOrThrow({ where: { id: policeId } });
    expect((police.assures as unknown as Assure[]).map((a) => a.ordre)).toEqual([1, 2, 3, 4, 5]);

    const v2 = await mettreAJourCp(technique, policeId, null);
    expect(v2).toMatchObject({ numero, version: 2 });
    expect(nombreAssures(derniereDemande())).toBe(5);
    expect(derniereDemande().listesEnAnnexe).toEqual(["assures"]);
    // Les adhérents incorporés après la liste initiale ne sont pas dans le calcul de la police : leur prime reste vide.
    expect((derniereDemande().donnees.assures as { ordre: number; prime: string | null }[]).map((a) => [a.ordre, a.prime])).toEqual([[1, "96000"], [2, "96000"], [3, "96000"], [4, null], [5, null]]);
    await expect(mettreAJourCp(technique, policeId, null)).rejects.toThrow(/n'a pas changé/);

    // Retrait de l'adhérent 2, puis incorporation : le numéro 2 (et 6 ensuite) n'est jamais réutilisé.
    expect(await retirerAdherents(technique, policeId, "2026-06-01", [2], null)).toEqual({ numeroVersion: 3, ordres: [2] });
    const inc2 = await incorporerAdherents(technique, policeId, "2026-06-01", [adherent(6)], null);
    expect(inc2.ordres).toEqual([6]);
    await mettreAJourCp(technique, policeId, null);
    expect((derniereDemande().donnees.assures as { ordre: number }[]).map((a) => a.ordre)).toEqual([1, 3, 4, 5, 6]);

    const vue = (await lireAdherents(technique, policeId))!;
    expect(vue.versions.map((v) => [v.numero, v.motif, v.dateEffet, v.adherents.length])).toEqual([
      [1, "INITIALE", "2026-01-01", 3],
      [2, "INCORPORATION", "2026-03-01", 5],
      [3, "RETRAIT", "2026-06-01", 4],
      [4, "INCORPORATION", "2026-06-01", 5],
    ]);
    expect(vue.cp).toMatchObject({ version: 3, versionAdherents: 4 });

    // T10 : rééditer la version 1 redonne la liste de la version 1 (3 adhérents), la version 2 celle de la version 2 (5), pas la liste courante.
    const v1Reeditee = await reediter(technique, v1.id, null);
    expect(v1Reeditee.version).toBe(4);
    expect(nombreAssures(derniereDemande())).toBe(3);
    expect(derniereDemande().listesEnAnnexe).toEqual(["assures"]);
    const v2Reeditee = await reediter(technique, v2.id, null);
    expect(v2Reeditee.version).toBe(5);
    expect(nombreAssures(derniereDemande())).toBe(5);
  });

  it("les contrôles : droit, contrat de groupe, date dans la période et sans retour en arrière, formule connue, liste jamais vide", async () => {
    const { policeId, cotationId } = await policeDeGroupe();

    await expect(incorporerAdherents(commercial, policeId, "2026-03-01", [adherent(4)], null)).rejects.toThrow(ErreurAcces);
    await expect(incorporerAdherents(technique, policeId, "2025-12-31", [adherent(4)], null)).rejects.toThrow(/période de la police/);
    await expect(incorporerAdherents(technique, policeId, "2027-01-01", [adherent(4)], null)).rejects.toThrow(/période de la police/);
    await expect(incorporerAdherents(technique, policeId, "2026-03-01", [adherent(4, "INCONNUE")], null)).rejects.toThrow(/inconnue/);
    await expect(incorporerAdherents(technique, policeId, "2026-03-01", [], null)).rejects.toThrow(/au moins un adhérent/);
    await incorporerAdherents(technique, policeId, "2026-06-01", [adherent(4)], null);
    await expect(retirerAdherents(technique, policeId, "2026-03-01", [4], null)).rejects.toThrow(/dernier changement/);
    await expect(retirerAdherents(technique, policeId, "2026-07-01", [99], null)).rejects.toThrow(/introuvable/);
    await expect(retirerAdherents(technique, policeId, "2026-07-01", [1, 2, 3, 4], null)).rejects.toThrow(/au moins un adhérent/);

    // Rien d'enregistré en cas de refus : toujours 2 versions.
    expect((await lireAdherents(technique, policeId))!.versions).toHaveLength(2);
    // Une version d'adhérents ne se modifie jamais (déclencheur).
    await expect(obtenirPrisma().$executeRawUnsafe(`UPDATE adherents_versions SET adherents = '[]'::jsonb WHERE police_id = ${policeId}`)).rejects.toThrow();
    // Les CP ne sont pas encore émises : pas de nouvelle version possible.
    await expect(mettreAJourCp(technique, policeId, null)).rejects.toThrow(/pas encore émises/);
    expect(cotationId).toBeGreaterThan(0);
  });
});

describe("certificat d'adhésion unitaire", () => {
  it("numéro saisi et unique, police.police_mere, QR propre, sans prime ; un seul certificat par adhérent ; réédition à l'identique", async () => {
    const { policeId, numero } = await policeDeGroupe();
    const numeroCertificat = numeroPolice("G");
    const doc = await emettreCertificat(technique, policeId, 2, numeroCertificat, null);

    expect(doc).toMatchObject({ type: "CERTIFICAT", numero: numeroCertificat, version: 1, policeNumero: numero });
    const d = derniereDemande();
    expect(d.donnees.police).toMatchObject({ numero: numeroCertificat, police_mere: numero, type_contrat: "GROUPE", date_effet: "2026-01-01" });
    expect((d.donnees.assures as { ordre: number; nom_prenoms: string }[]).map((a) => [a.ordre, a.nom_prenoms])).toEqual([[2, "Adhérent 2 Inventé"]]);
    expect(d.donnees).not.toHaveProperty("prime");
    expect(d.donnees).not.toHaveProperty("echeances");
    expect(d.donnees.doc).toMatchObject({ type: "CERTIFICAT", numero: numeroCertificat });
    expect(d.qr?.url).toMatch(/^https:\/\/documents\.exemple\.ci\/verif\//);
    expect(d.piecesJointes ?? []).toEqual([]);

    // Le jeton du QR est propre au certificat ; la page publique ne montre que l'adhérent, masqué.
    const ligne = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    expect(ligne).toMatchObject({ adherentOrdre: 2, policeId, type: "CERTIFICAT" });
    expect(ligne.souscripteurMasque).toBe("A******* 2 I******");

    await expect(emettreCertificat(technique, policeId, 2, numeroPolice("G"), null)).rejects.toThrow(/déjà émis/);
    await expect(emettreCertificat(technique, policeId, 3, numeroCertificat, null)).rejects.toThrow(/déjà utilisé/);
    await expect(emettreCertificat(technique, policeId, 3, numero, null)).rejects.toThrow(/déjà utilisé/);
    await expect(emettreCertificat(technique, policeId, 3, "N'IMPORTE-QUOI", null)).rejects.toThrow(/format/i);
    await expect(emettreCertificat(technique, policeId, 99, numeroPolice("G"), null)).rejects.toThrow(/ne fait pas partie/);
    await expect(emettreCertificat(commercial, policeId, 3, numeroPolice("G"), null)).rejects.toThrow(ErreurAcces);

    // Réédition : même numéro, version 2, mêmes données.
    const reedite = await reediter(technique, doc.id, null);
    expect(reedite).toMatchObject({ numero: numeroCertificat, version: 2 });
    expect(derniereDemande().donnees.police).toMatchObject({ police_mere: numero });
    expect((await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: reedite.id } })).adherentOrdre).toBe(2);
  });

  it("la date d'adhésion d'un adhérent incorporé est celle de l'incorporation ; un contrat individuel n'a pas de certificat", async () => {
    const { policeId } = await policeDeGroupe();
    await incorporerAdherents(technique, policeId, "2026-06-15", [adherent(4)], null);
    await emettreCertificat(technique, policeId, 4, numeroPolice("G"), null);

    expect(derniereDemande().donnees.police).toMatchObject({ date_effet: "2026-06-15", date_echeance: "2026-12-31", duree_jours: 200, duree_libelle: "200 jours" });
    // Un certificat n'a pas de prime (H36) : la clé n'existe pas dans ses données.
    expect("prime" in (derniereDemande().donnees.assures as object[])[0]).toBe(false);
  });
});
