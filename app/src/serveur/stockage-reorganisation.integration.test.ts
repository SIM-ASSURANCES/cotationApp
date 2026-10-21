import { beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import { obtenirPrisma } from "./prisma";
import { remplacerStockage } from "./stockage";
import {
  rangerDocumentsDev,
  ReorganisationInterditeEnProduction,
} from "./stockage-reorganisation";

const CODE = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

describe("script idempotent de rangement des documents dev (Étape 5, D41)", () => {
  const fichiers = new Map<string, Uint8Array>();

  beforeAll(async () => {
    fixerDateMinimumEffetPourTests("2026-01-01");
    remplacerStockage({
      async ecrire(chemin, contenu) {
        fichiers.set(chemin, contenu);
        return { empreinte: "a".repeat(64) };
      },
      async lire(chemin) {
        const c = fichiers.get(chemin);
        if (!c) throw new Error("Introuvable");
        return c;
      },
      async zip(liste) {
        return new TextEncoder().encode(`PK ${liste.map((f) => f.nom).join(",")}`);
      },
    });
  });

  it("refuse strictement l'exécution en environnement de production", async () => {
    const prisma = obtenirPrisma();
    await expect(rangerDocumentsDev(prisma, { NODE_ENV: "production" })).rejects.toBeInstanceOf(
      ReorganisationInterditeEnProduction,
    );
  });

  it("réorganise un document avec ancien chemin et vérifie l'idempotence au 2e passage", async () => {
    const prisma = obtenirPrisma();
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

    const cotation = await prisma.cotation.create({
      data: {
        produitId: produit.id,
        clientId: client.id,
        numero: "COT-2026-10-0888",
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

    // Insérer un modèle et une version pour satisfaire la clé étrangère de document_emis
    const modele = await prisma.modele.create({
      data: {
        code: CODE("MOD"),
        libelle: "Modèle Cotation",
        type: "COTATION",
        creePar: "admin",
      },
    });
    const modeleVersion = await prisma.modeleVersion.create({
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

    // Ancien format de chemin CDC §14.2 : {Produit}/{AAAA}/{MM}/{Type}/...
    const ancienChemin = `${prodCode}/2026/10/COTATION/COT-2026-10-0888_COTATION_20261001_v1.pdf`;
    fichiers.set(ancienChemin, new Uint8Array([10, 20, 30]));

    const doc = await prisma.documentEmis.create({
      data: {
        type: "COTATION",
        numero: "COT-2026-10-0888",
        version: 1,
        jeton: `jeton-${Math.random().toString(36).slice(2, 10)}${"a".repeat(24)}`,
        chemin: ancienChemin,
        empreinte: "a".repeat(64),
        taille: 3,
        produitCode: prodCode,
        souscripteurNom: "CLIENT REORG",
        souscripteurMasque: "C***** R****",
        cotationId: cotation.id,
        dateEmission: new Date("2026-10-01"),
        modeleVersionId: modeleVersion.id,
        versionsAssociees: {},
        parametresDate: new Date("2026-01-01"),
        donnees: {},
        emisPar: "admin",
      },
    });

    // 1er passage : doit déplacer le document
    const rapport1 = await rangerDocumentsDev(prisma, { NODE_ENV: "development" });
    expect(rapport1.deplaces).toBeGreaterThanOrEqual(1);

    const docMisAJour = await prisma.documentEmis.findUniqueOrThrow({ where: { id: doc.id } });
    const cheminAttendu = `MALADIE/${prodCode}/CLI-${client.id}/COT-2026-10-0888/COT-2026-10-0888_COTATION_v1.pdf`;
    expect(docMisAJour.chemin).toBe(cheminAttendu);
    expect(fichiers.has(cheminAttendu)).toBe(true);

    // 2e passage : strictement idempotent, 0 déplacement
    const rapport2 = await rangerDocumentsDev(prisma, { NODE_ENV: "development" });
    expect(rapport2.deplaces).toBe(0);
    expect(rapport2.dejaRanges).toBe(rapport2.total);
  });
});
