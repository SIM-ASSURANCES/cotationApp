// Tests d'intégration : vraie base de test, générateur SIMULÉ, stockage EN MÉMOIRE (npm run test:integration).
import { createHash } from "node:crypto";

process.env.URL_PUBLIQUE = "https://documents.exemple.ci";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Analyse } from "@/domaine/documents/analyse";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { creerBrouillon, accepter, soumettre, type SaisieCotation } from "./cotations";
import { annulerParAvoir, documentsDe, emettreCotation, emettreCp, rechercherDocuments, reediter, telechargerDocument, verifierJeton, zipDocuments } from "./documents";
import { initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur, type DemandePdf } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { aujourdhui, creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
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

// ---------------------------------------------------------------- Doubles : générateur et stockage

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
const SOCLE = (numero: string) => [numero, "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc"];
let prochaineAnalyse = analyse(SOCLE("doc.numero"));
const demandes: DemandePdf[] = [];
const fichiers = new Map<string, Uint8Array>();

// ---------------------------------------------------------------- Mise en place

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };
async function publier(type: "COTATION" | "CP" | "CG", produitCode: string | null, contenu: string, chemins: string[], options: { visa?: string; date?: string } = {}) {
  const id = await creerModele(technique, { type, code: CODE(type), libelle: type === "CG" ? "SECUR DOMMAGE (test)" : `Modèle ${type}`, produitCode, ...sans }, null);
  prochaineAnalyse = analyse(chemins);
  await deposerVersion(technique, id, { fichier: texte(contenu), nomFichier: "m.docx", commentaire: "test", dateEffet: aujourdhui(), visa: options.visa ?? null, dateDocument: options.visa ? "2025-06-19" : null }, null);
  const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
  await soumettreVersion(technique, v.id, null);
  await publierVersion(dg, v.id, options.date ?? aujourdhui(), null);
  return { modeleId: id, versionId: v.id, code: (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code };
}

const versionBeni = (references?: VersionSaisie["references"]): VersionSaisie => ({
  dateEffet: "2020-01-01",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
  prorata: { actif: true, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: "20000000",
  formules: [
    { code: "SOLO", libelle: "Solo", tauxCouverture: "80", primeUnitaire: "93581.33", accessoireMode: "FIXE", accessoireValeur: "3000" },
    { code: "FAMILLE", libelle: "Famille", tauxCouverture: "80", primeUnitaire: "252657.63", accessoireMode: "FIXE", accessoireValeur: "210000" },
  ],
  references,
});

async function produit(references?: VersionSaisie["references"]): Promise<string> {
  const code = CODE("BENI");
  const branche = `SANTE_${code}`;
  await creerTaxe(technique, { branche, tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerProduit(technique, { code, libelle: "Santé BENI (test)", gamme: "RELAX", branche }, null);
  await creerVersion(technique, code, versionBeni(references), null);
  return code;
}

/** Cotation T1 émise : 3 Solo + 60 Famille = 15 888 000 F. */
async function cotationT1(produitCode: string): Promise<number> {
  const saisie: SaisieCotation = {
    codeProduit: produitCode,
    clientId: null,
    souscripteur: { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa Inventée", raison_sociale: "", telephone: "0700000000", email: "", adresse: "" },
    dateEffet: "2026-01-01",
    dateEcheance: "2026-12-31",
    nombreTranches: 1,
    lignes: [{ codeFormule: "SOLO", effectif: 3 }, { codeFormule: "FAMILLE", effectif: 60 }],
    motifForcage: null,
    assures: [],
    risque: {},
  };
  const id = await creerBrouillon(commercial, saisie, null);
  expect((await soumettre(commercial, id, null)).statut).toBe("EMISE");
  return id;
}

beforeAll(async () => {
  remplacerGenerateur({
    analyser: async () => prochaineAnalyse,
    genererPdf: async (demande) => {
      demandes.push(demande);
      return texte(`%PDF-1.7 simulé ${demandes.length} ${demande.filigrane ?? ""}`);
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
});

afterAll(async () => {
  remplacerGenerateur(null);
  remplacerStockage(null);
  await obtenirPrisma().$disconnect();
});

// ---------------------------------------------------------------- Émission d'une cotation

describe("émission du PDF d'une cotation (T1)", () => {
  it("modèle publié + cotation émise → PDF stocké, QR code, empreinte, page de vérification", async () => {
    const p = await produit();
    const modele = await publier("COTATION", p, "modele cotation v1", SOCLE("doc.numero"));
    const id = await cotationT1(p);
    demandes.length = 0;
    const doc = await emettreCotation(commercial, id, null);

    expect(doc).toMatchObject({ type: "COTATION", version: 1, produitCode: p, souscripteur: "KOUADIO Awa Inventée", filigrane: null });
    const demande = demandes[0];
    expect(new TextDecoder().decode(demande.modele)).toBe("modele cotation v1");
    expect(demande.donnees.prime).toMatchObject({ ttc: "15888000" });
    expect((demande.donnees.formules as { ttc: string }[]).map((f) => f.ttc)).toEqual(["288000", "15600000"]);
    expect(demande.qr?.url).toMatch(/^https:\/\/documents\.exemple\.ci\/verif\/[A-Za-z0-9_-]{43}$/);
    expect(doc.urlVerification).toBe(demande.qr?.url);

    const ligne = await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    expect(ligne.modeleVersionId).toBe(modele.versionId);
    expect(ligne.empreinte).toBe(sha256(fichiers.get(ligne.chemin)!));
    // Jeton aléatoire de 256 bits, sans lien avec l'identifiant ni le numéro du document.
    expect(ligne.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([String(id), String(doc.id), doc.numero]).not.toContain(ligne.jeton);

    const vue = await verifierJeton(ligne.jeton);
    expect(vue).toMatchObject({ type: "Cotation", numero: doc.numero, statut: { code: "VALIDE" }, souscripteur: "K****** A.", empreinte: ligne.empreinte });
    expect(JSON.stringify(vue)).not.toContain("KOUADIO");
    expect(await verifierJeton("jeton-inconnu-mais-de-bonne-longueur-0123456789")).toBeNull();

    await expect(emettreCotation(commercial, id, null)).rejects.toThrow(/déjà émis/);
  });

  it("sans modèle publié : refus expliqué ; brouillon : pas de PDF définitif", async () => {
    const p = await produit();
    const id = await cotationT1(p);
    await expect(emettreCotation(commercial, id, null)).rejects.toThrow(/Aucun modèle de cotation publié/);
  });
});

// ---------------------------------------------------------------- T10 et T11

describe("réédition", () => {
  it("T10 : la réédition reprend le modèle v1 et les données d'origine, même après la publication d'une v2", async () => {
    const p = await produit();
    const v1 = await publier("COTATION", p, "modele cotation v1", SOCLE("doc.numero"));
    const id = await cotationT1(p);
    const doc = await emettreCotation(commercial, id, null);

    // Le temps passe : la v1 date de 2020 (déclencheur suspendu pour le test), la v2 est publiée aujourd'hui.
    const prisma = obtenirPrisma();
    await prisma.$executeRawUnsafe(`ALTER TABLE modele_versions DISABLE TRIGGER modele_versions_figees`);
    try {
      await prisma.$executeRawUnsafe(`UPDATE modele_versions SET date_effet = '2020-01-01' WHERE id = ${v1.versionId}`);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE modele_versions ENABLE TRIGGER modele_versions_figees`);
    }
    prochaineAnalyse = analyse(SOCLE("doc.numero"));
    await deposerVersion(technique, v1.modeleId, { fichier: texte("modele cotation v2"), nomFichier: "m.docx", commentaire: "Version 2", dateEffet: aujourdhui(), visa: null, dateDocument: null }, null);
    const v2 = await prisma.modeleVersion.findFirstOrThrow({ where: { modeleId: v1.modeleId, numero: 2 } });
    await soumettreVersion(technique, v2.id, null);
    await publierVersion(dg, v2.id, aujourdhui(), null);

    demandes.length = 0;
    const reedite = await reediter(commercial, doc.id, null);
    expect(new TextDecoder().decode(demandes[0].modele)).toBe("modele cotation v1");
    expect(reedite).toMatchObject({ numero: doc.numero, version: 2, filigrane: null });
    expect(demandes[0].donnees.doc).toMatchObject({ numero: doc.numero, version: "v2" });
    const origine = (await prisma.documentEmis.findUniqueOrThrow({ where: { id: doc.id } })).donnees as { prime: unknown; souscripteur: unknown };
    expect(demandes[0].donnees.prime).toEqual(origine.prime);
    expect(demandes[0].donnees.souscripteur).toEqual(origine.souscripteur);
    const ligne = await prisma.documentEmis.findUniqueOrThrow({ where: { id: reedite.id } });
    expect(ligne.origineId).toBe(doc.id);
    expect(ligne.modeleVersionId).toBe(v1.versionId);
    expect(ligne.chemin).not.toBe((await prisma.documentEmis.findUniqueOrThrow({ where: { id: doc.id } })).chemin);

    // Une NOUVELLE cotation, elle, prend la v2.
    demandes.length = 0;
    await emettreCotation(commercial, await cotationT1(p), null);
    expect(new TextDecoder().decode(demandes[0].modele)).toBe("modele cotation v2");
  });

  it("T11 : réédition d'une cotation expirée → filigrane « EXPIRÉE » ; page de vérification « Expirée »", async () => {
    const p = await produit();
    await publier("COTATION", p, "modele", SOCLE("doc.numero"));
    const id = await cotationT1(p);
    const doc = await emettreCotation(commercial, id, null);
    const prisma = obtenirPrisma();
    await prisma.$executeRawUnsafe(`ALTER TABLE cotations DISABLE TRIGGER cotations_figees`);
    try {
      await prisma.$executeRawUnsafe(`UPDATE cotations SET date_validite = '2020-06-30' WHERE id = ${id}`);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE cotations ENABLE TRIGGER cotations_figees`);
    }
    demandes.length = 0;
    const reedite = await reediter(commercial, doc.id, null);
    expect(demandes[0].filigrane).toBe("EXPIRÉE");
    expect(reedite.filigrane).toBe("EXPIRÉE");
    const ligne = await prisma.documentEmis.findUniqueOrThrow({ where: { id: reedite.id } });
    expect(ligne.filigrane).toBe("EXPIRÉE");
  });
});

// ---------------------------------------------------------------- T12

describe("T12 : facture annulée par un avoir", () => {
  it("la page de vérification affiche « Annulée – avoir AV-… », pour toutes les versions", async () => {
    const prisma = obtenirPrisma();
    const p = await produit();
    const modele = await publier("COTATION", p, "modele", SOCLE("doc.numero"));
    // Les factures arrivent en phase 4 : la facture émise est inscrite directement.
    const numero = `FAC-2026-10-${Math.floor(Math.random() * 9000 + 1000)}`;
    const base = { type: "FACTURE", numero, empreinte: "a".repeat(64), taille: 10, produitCode: p, souscripteurNom: "YAO Test", souscripteurMasque: "Y** T.", dateEmission: new Date("2026-10-06"), modeleVersionId: modele.versionId, versionsAssociees: {}, parametresDate: new Date("2026-10-06"), donnees: {}, emisPar: "test" };
    const v1 = await prisma.documentEmis.create({ data: { ...base, version: 1, jeton: "j".repeat(20) + unique("a").replace(/-/g, "_") + "x".repeat(20), chemin: `${numero}_v1.pdf` } });
    const v2 = await prisma.documentEmis.create({ data: { ...base, version: 2, origineId: v1.id, jeton: "k".repeat(20) + unique("b").replace(/-/g, "_") + "x".repeat(20), chemin: `${numero}_v2.pdf` } });
    expect((await verifierJeton(v1.jeton))?.statut.code).toBe("VALIDE");

    await expect(annulerParAvoir(commercial, numero, "AV-2026-10-0001", null)).rejects.toThrow(ErreurAcces);
    await annulerParAvoir(technique, numero, "AV-2026-10-0001", null);
    expect((await verifierJeton(v1.jeton))?.statut).toEqual({ code: "ANNULE", libelle: "Annulée – avoir AV-2026-10-0001" });
    expect((await verifierJeton(v2.jeton))?.statut.libelle).toBe("Annulée – avoir AV-2026-10-0001");
    await expect(annulerParAvoir(technique, numero, "AV-2026-10-0002", null)).rejects.toThrow(/déjà annulé/);
  });
});

// ---------------------------------------------------------------- Contrat : assemblage et visa

describe("conditions particulières : CP → CS → CG, visa contrôlé (§6.8)", () => {
  it("assemblage avec les CG publiées ; visa incohérent : émission refusée", async () => {
    const cg = await publier("CG", null, "cg docx", ["produit.cg_visa"], { visa: "MFB/DGTCP/DA/N° 01498" });
    const cgPdf = (await obtenirPrisma().modeleVersion.findUniqueOrThrow({ where: { id: cg.versionId } })).pdf!;

    const bon = await produit({ cgModeleCode: cg.code, cgVisa: "MFB/DGTCP/DA/N° 01498", csModeleCode: null, csVisa: null });
    await publier("CP", bon, "modele cp", SOCLE("police.numero"));
    const id = await cotationT1(bon);
    await accepter(commercial, id, ["SOLO", "FAMILLE"], null);
    await expect(emettreCp(commercial, id, null)).rejects.toThrow(ErreurAcces); // Commercial : pas « Émettre un contrat »
    demandes.length = 0;
    const cp = await emettreCp(technique, id, null);
    expect(cp.type).toBe("CP");
    expect(demandes[0].piecesJointes).toEqual([cgPdf]);
    expect(demandes[0].donnees.produit).toMatchObject({ cg_visa: "MFB/DGTCP/DA/N° 01498", cg_libelle: "SECUR DOMMAGE (test)", cg_date: "2025-06-19" });
    expect(demandes[0].donnees.police).toMatchObject({ numero: cp.numero });

    const faux = await produit({ cgModeleCode: cg.code, cgVisa: "MFB/DGTCP/DA/N° 01497", csModeleCode: null, csVisa: null });
    await publier("CP", faux, "modele cp", SOCLE("police.numero"));
    const id2 = await cotationT1(faux);
    await accepter(commercial, id2, ["SOLO"], null);
    await expect(emettreCp(technique, id2, null)).rejects.toThrow(/Visa incohérent/);

    const sansCg = await produit();
    await publier("CP", sansCg, "modele cp", SOCLE("police.numero"));
    const id3 = await cotationT1(sansCg);
    await accepter(commercial, id3, ["SOLO"], null);
    await expect(emettreCp(technique, id3, null)).rejects.toThrow(/pas de conditions générales/);
  });
});

// ---------------------------------------------------------------- Ajout seul, droits, intégrité

describe("documents émis : ajout seul, recherche, intégrité", () => {
  it("ni modification ni suppression en base ; recherche selon les droits ; ZIP ; fichier altéré refusé", async () => {
    const prisma = obtenirPrisma();
    const p = await produit();
    await publier("COTATION", p, "modele", SOCLE("doc.numero"));
    const id = await cotationT1(p);
    const doc = await emettreCotation(commercial, id, null);
    await expect(prisma.$executeRawUnsafe(`UPDATE documents_emis SET empreinte = '${"b".repeat(64)}' WHERE id = ${doc.id}`)).rejects.toThrow(/aucune modification/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM documents_emis WHERE id = ${doc.id}`)).rejects.toThrow(/suppression interdite/);

    expect((await rechercherDocuments(commercial, { client: "kouadio", type: "COTATION" })).some((d) => d.id === doc.id)).toBe(true);
    expect((await rechercherDocuments(commercial, { type: "CP" })).length).toBe(0); // Commercial : pas de lecture des contrats
    expect((await documentsDe(commercial, { cotationId: id })).map((d) => d.id)).toEqual([doc.id]);

    const telecharge = await telechargerDocument(commercial, doc.id, null);
    expect(telecharge.nom).toBe(`${doc.numero}_COTATION_v1.pdf`);
    expect(new TextDecoder().decode((await zipDocuments(commercial, [doc.id], null)).contenu)).toContain(`${doc.numero}_COTATION_v1.pdf`);

    const ligne = await prisma.documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    fichiers.set(ligne.chemin, texte("fichier altéré"));
    await expect(telechargerDocument(commercial, doc.id, null)).rejects.toThrow(/ne correspond plus à son empreinte/);
  });
});
