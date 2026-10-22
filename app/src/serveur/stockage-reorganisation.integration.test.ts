import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import { assurerBranche } from "./branches-test";
import { ErreurDejaStocke } from "./generateur";
import { obtenirPrisma } from "./prisma";
import { remplacerStockage, type Stockage } from "./stockage";
import {
  rangerDocumentsDev,
  ReorganisationInterditeEnProduction,
} from "./stockage-reorganisation";

const CODE = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
const sha256 = (o: Uint8Array) => createHash("sha256").update(o).digest("hex");
const AUTORISE = { NODE_ENV: "development", AUTORISER_RANGEMENT_DEV: "oui" } as NodeJS.ProcessEnv;

describe("script idempotent de rangement des documents dev (Étape 5, D41)", () => {
  const fichiers = new Map<string, Uint8Array>();

  // Stockage en ajout seul, comme le vrai : écrire un chemin existant est refusé.
  const stockageTest: Stockage = {
    async ecrire(chemin, contenu) {
      if (fichiers.has(chemin)) throw new ErreurDejaStocke("Déjà stocké");
      fichiers.set(chemin, contenu);
      return { empreinte: sha256(contenu) };
    },
    async lire(chemin) {
      const c = fichiers.get(chemin);
      if (!c) throw new Error("Introuvable");
      return c;
    },
    async zip(liste) {
      return new TextEncoder().encode(`PK ${liste.map((f) => f.nom).join(",")}`);
    },
  };

  beforeAll(async () => {
    fixerDateMinimumEffetPourTests("2026-01-01");
    remplacerStockage(stockageTest);
  });

  /** Crée un document émis dont le chemin est l'ancien format ; le fichier source n'est écrit que si demandé. */
  async function creerDocument(opts: { fichierSource: boolean }) {
    const prisma = obtenirPrisma();
    await assurerBranche("SANTE");
    const prodCode = CODE("PRD");

    const produit = await prisma.produit.create({
      data: {
        code: prodCode,
        libelle: "Produit Test Reorg",
        gamme: "STANDARD",
        branche: "SANTE",
        branchePrincipale: "MALADIE",
        creePar: "admin",
      },
    });
    const client = await prisma.client.create({
      data: { nom: "CLIENT REORG", type: "MORALE", creePar: "admin" },
    });
    const numCotation = CODE("COT");
    const cotation = await prisma.cotation.create({
      data: {
        produitId: produit.id,
        clientId: client.id,
        numero: numCotation,
        versionDateEffet: new Date("2026-01-01"),
        statut: "EMISE",
        dateEffet: new Date("2026-01-01"),
        dateEcheance: new Date("2026-12-31"),
        souscripteur: { type: "MORALE", raison_sociale: "CLIENT REORG" },
        lignes: [],
        auteurId: 1,
        auteurIdentifiant: "admin",
      },
    });
    const modele = await prisma.modele.create({
      data: { code: CODE("MOD"), libelle: "Modèle Cotation", type: "COTATION", creePar: "admin" },
    });
    // Transaction : le mode replica ne survit pas à la fin du bloc.
    const modeleVersionId = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
      const mv = await tx.modeleVersion.create({
        data: {
          modeleId: modele.id,
          numero: 1,
          statut: "PUBLIE",
          fichier: new Uint8Array([1]),
          nomFichier: "modele.docx",
          taille: 1,
          empreinte: "a".repeat(64),
          commentaire: "version initiale",
          dateEffet: new Date("2026-01-01"),
          analyse: {},
          auteurId: 1,
          auteurIdentifiant: "admin",
        },
      });
      return mv.id;
    });

    // Ancien format de chemin CDC §14.2 : {Produit}/{AAAA}/{MM}/{Type}/...
    const ancienChemin = `${prodCode}/2026/10/COTATION/${numCotation}_COTATION_20261001_v1.pdf`;
    const contenu = new Uint8Array([10, 20, 30]);
    if (opts.fichierSource) fichiers.set(ancienChemin, contenu);

    const doc = await prisma.documentEmis.create({
      data: {
        type: "COTATION",
        numero: numCotation,
        version: 1,
        jeton: `jeton-${Math.random().toString(36).slice(2, 10)}${"a".repeat(24)}`,
        chemin: ancienChemin,
        empreinte: sha256(contenu),
        taille: 3,
        produitCode: prodCode,
        souscripteurNom: "CLIENT REORG",
        souscripteurMasque: "C***** R****",
        cotationId: cotation.id,
        dateEmission: new Date("2026-10-01"),
        modeleVersionId,
        versionsAssociees: {},
        parametresDate: new Date("2026-01-01"),
        donnees: {},
        emisPar: "admin",
      },
    });
    const cheminAttendu = `MALADIE/${prodCode}/CLI-${client.id}/${numCotation}/${numCotation}_COTATION_v1.pdf`;
    return { doc, ancienChemin, cheminAttendu, contenu };
  }

  const cheminEnBase = async (id: number) =>
    (await obtenirPrisma().documentEmis.findUniqueOrThrow({ where: { id } })).chemin;

  it("refuse en production, et sans AUTORISER_RANGEMENT_DEV exactement « oui »", async () => {
    const prisma = obtenirPrisma();
    const refus = (env: NodeJS.ProcessEnv) =>
      expect(rangerDocumentsDev(prisma, env)).rejects.toBeInstanceOf(ReorganisationInterditeEnProduction);
    await refus({ NODE_ENV: "production", AUTORISER_RANGEMENT_DEV: "oui" } as NodeJS.ProcessEnv);
    await refus({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    await refus({ NODE_ENV: "development", AUTORISER_RANGEMENT_DEV: "OUI" } as NodeJS.ProcessEnv);
    await refus({ NODE_ENV: "development", AUTORISER_RANGEMENT_DEV: "true" } as NodeJS.ProcessEnv);
  });

  it("range un document, garde l'ancien fichier, reste idempotent et ne laisse aucune connexion en replica", async () => {
    const prisma = obtenirPrisma();
    const { doc, ancienChemin, cheminAttendu, contenu } = await creerDocument({ fichierSource: true });

    const rapport1 = await rangerDocumentsDev(prisma, AUTORISE);
    expect(rapport1.deplaces).toBeGreaterThanOrEqual(1);
    expect(rapport1.erreurs.filter((e) => e.id === doc.id)).toEqual([]);
    expect(await cheminEnBase(doc.id)).toBe(cheminAttendu);
    expect(fichiers.get(cheminAttendu)).toEqual(contenu);
    // Stockage en ajout seul : l'ancien fichier n'est jamais supprimé.
    expect(fichiers.get(ancienChemin)).toEqual(contenu);

    // 2e passage : strictement idempotent, 0 déplacement
    const rapport2 = await rangerDocumentsDev(prisma, AUTORISE);
    expect(rapport2.deplaces).toBe(0);
    expect(rapport2.dejaRanges).toBe(rapport2.total - rapport2.introuvables - rapport2.erreurs.length);

    // Aucune connexion n'est restée en replica : le déclencheur refuse toujours la modification.
    for (let i = 0; i < 5; i++) {
      await expect(
        prisma.documentEmis.update({ where: { id: doc.id }, data: { chemin: `X/${i}.pdf` } }),
      ).rejects.toThrow();
    }
    expect(await cheminEnBase(doc.id)).toBe(cheminAttendu);
  });

  it("fichier source introuvable : chemin inchangé, compté en introuvables et non en déplacés", async () => {
    const prisma = obtenirPrisma();
    await rangerDocumentsDev(prisma, AUTORISE); // met à l'état stable les documents rangeables
    const { doc, ancienChemin } = await creerDocument({ fichierSource: false });

    const rapport = await rangerDocumentsDev(prisma, AUTORISE);
    expect(rapport.deplaces).toBe(0);
    expect(rapport.introuvables).toBeGreaterThanOrEqual(1);
    expect(await cheminEnBase(doc.id)).toBe(ancienChemin);
  });

  it("cible déjà présente : même empreinte = idempotent, empreinte différente = erreur sans UPDATE", async () => {
    const prisma = obtenirPrisma();

    const identique = await creerDocument({ fichierSource: true });
    fichiers.set(identique.cheminAttendu, new Uint8Array(identique.contenu));

    const different = await creerDocument({ fichierSource: true });
    const autre = new Uint8Array([99, 98, 97]);
    fichiers.set(different.cheminAttendu, autre);

    const rapport = await rangerDocumentsDev(prisma, AUTORISE);

    expect(rapport.erreurs.filter((e) => e.id === identique.doc.id)).toEqual([]);
    expect(await cheminEnBase(identique.doc.id)).toBe(identique.cheminAttendu);

    const erreur = rapport.erreurs.find((e) => e.id === different.doc.id);
    expect(erreur?.erreur).toContain(different.cheminAttendu);
    expect(await cheminEnBase(different.doc.id)).toBe(different.ancienChemin);
    expect(fichiers.get(different.cheminAttendu)).toEqual(autre); // jamais écrasé
  });

  it("autre erreur d'écriture : erreur au rapport, pas d'UPDATE", async () => {
    const prisma = obtenirPrisma();
    const { doc, ancienChemin, cheminAttendu } = await creerDocument({ fichierSource: true });

    remplacerStockage({
      async ecrire() {
        throw new Error("Disque plein");
      },
      async lire(chemin) {
        const c = fichiers.get(chemin);
        if (!c) throw new Error("Introuvable");
        return c;
      },
      async zip() {
        return new Uint8Array();
      },
    });
    try {
      const rapport = await rangerDocumentsDev(prisma, AUTORISE);
      expect(rapport.erreurs.find((e) => e.id === doc.id)?.erreur).toBe("Disque plein");
    } finally {
      remplacerStockage(stockageTest);
    }
    expect(await cheminEnBase(doc.id)).toBe(ancienChemin);
    expect(fichiers.has(cheminAttendu)).toBe(false);
  });
});
