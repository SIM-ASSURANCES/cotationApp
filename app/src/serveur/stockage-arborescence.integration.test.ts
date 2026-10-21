import { beforeAll, describe, expect, it } from "vitest";

import { fixerDateMinimumEffetPourTests } from "@/domaine/calcul/dates";
import { obtenirPrisma } from "./prisma";
import { calculerCheminStockage, resoudreContexteStockage } from "./stockage-arborescence";

const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

describe("stockage arborescent (Étape 5, D41)", () => {
  beforeAll(async () => {
    fixerDateMinimumEffetPourTests("2026-01-01");
  });

  it("génère l'arborescence complète pour une cotation prospect et client enregistré", async () => {
    const prisma = obtenirPrisma();
    const prodCode = CODE("SANTE");

    const produit = await prisma.produit.create({
      data: {
        code: prodCode,
        libelle: "Produit Test",
        gamme: "STANDARD",
        branche: "SANTE",
        branchePrincipale: "MALADIE",
        creePar: "admin",
      },
    });

    // Cotation prospect (sans clientId)
    const cotationProspect = await prisma.cotation.create({
      data: {
        produitId: produit.id,
        versionDateEffet: new Date("2026-01-01"),
        statut: "SOUMISE",
        dateEffet: new Date("2026-06-01"),
        dateEcheance: new Date("2027-05-31"),
        souscripteur: { type: "PHYSIQUE", nom: "KOUAME", prenoms: "Jean" },
        lignes: [],
        auteurId: 1,
        auteurIdentifiant: "admin",
      },
    });

    const contexteProspect = await resoudreContexteStockage(prisma, {
      type: "COTATION",
      numero: "COT-2026-10-0042",
      version: 1,
      produitCode: prodCode,
      cotationId: cotationProspect.id,
    });

    expect(contexteProspect.brancheCode).toBe("MALADIE");
    expect(contexteProspect.produitCode).toBe(prodCode);
    expect(contexteProspect.clientIdentifiant).toBe(`PROSP-${cotationProspect.id}`);

    const cheminProspect = await calculerCheminStockage(prisma, {
      type: "COTATION",
      numero: "COT-2026-10-0042",
      version: 1,
      produitCode: prodCode,
      cotationId: cotationProspect.id,
    });

    expect(cheminProspect).toBe(`MALADIE/${prodCode}/PROSP-${cotationProspect.id}/COT-2026-10-0042/COT-2026-10-0042_COTATION_v1.pdf`);
    expect(cheminProspect.split("/")).toHaveLength(5);

    // Client enregistré
    const client = await prisma.client.create({
      data: {
        nom: "SOCIETE CIV",
        type: "MORALE",
        creePar: "admin",
      },
    });
    await prisma.cotation.update({
      where: { id: cotationProspect.id },
      data: { clientId: client.id, numero: "COT-2026-10-0042" },
    });

    const cheminClient = await calculerCheminStockage(prisma, {
      type: "COTATION",
      numero: "COT-2026-10-0042",
      version: 1,
      produitCode: prodCode,
      cotationId: cotationProspect.id,
    });

    expect(cheminClient).toBe(`MALADIE/${prodCode}/CLI-${client.id}/COT-2026-10-0042/COT-2026-10-0042_COTATION_v1.pdf`);
  });

  it("génère l'arborescence pour un contrat (CP), certificat, facture affaire nouvelle et avenant", async () => {
    const prisma = obtenirPrisma();
    const prodCode = CODE("CORP");

    const produit = await prisma.produit.create({
      data: {
        code: prodCode,
        libelle: "Accidents corporels",
        gamme: "STANDARD",
        branche: "ACCIDENTS_CORPORELS",
        branchePrincipale: "ACCIDENTS_CORPORELS",
        creePar: "admin",
      },
    });

    const client = await prisma.client.create({ data: { nom: "ENTREPRISE B", type: "MORALE", creePar: "admin" } });
    const cotation = await prisma.cotation.create({
      data: {
        produitId: produit.id,
        clientId: client.id,
        numero: "COT-2026-10-0099",
        versionDateEffet: new Date("2026-01-01"),
        statut: "ACCEPTEE",
        dateEffet: new Date("2026-01-01"),
        dateEcheance: new Date("2026-12-31"),
        souscripteur: { type: "MORALE", raison_sociale: "ENTREPRISE B" },
        lignes: [],
        auteurId: 1,
        auteurIdentifiant: "admin",
      },
    });

    const police = await prisma.police.create({
      data: {
        numero: "POL-2026-000099",
        cotationId: cotation.id,
        produitCode: prodCode,
        souscripteur: { type: "MORALE", raison_sociale: "ENTREPRISE B" },
        assures: [],
        risque: {},
        formulesRetenues: {},
        donneesCalcul: {},
        resultat: {},
        ttcTotal: "500000",
        echeancier: [],
        dateEffet: new Date("2026-01-01"),
        dateEcheance: new Date("2026-12-31"),
        creePar: "test",
      },
    });

    // 1. CP
    const cheminCp = await calculerCheminStockage(prisma, {
      type: "CP",
      numero: "POL-2026-000099",
      version: 1,
      produitCode: prodCode,
      policeId: police.id,
      policeNumero: police.numero,
    });
    expect(cheminCp).toBe(`ACCIDENTS_CORPORELS/${prodCode}/CLI-${client.id}/COT-2026-10-0099/POL-2026-000099/POL-2026-000099_CP_v1.pdf`);
    expect(cheminCp.split("/")).toHaveLength(6);

    // 2. Certificat initial
    const cheminCertificat = await calculerCheminStockage(prisma, {
      type: "CERTIFICAT",
      numero: "POL-2026-000099-001",
      version: 1,
      produitCode: prodCode,
      policeId: police.id,
      policeNumero: police.numero,
    });
    expect(cheminCertificat).toBe(`ACCIDENTS_CORPORELS/${prodCode}/CLI-${client.id}/COT-2026-10-0099/POL-2026-000099/certificats/POL-2026-000099-001_CERTIFICAT_v1.pdf`);
    expect(cheminCertificat.split("/")).toHaveLength(7);

    // 3. Facture d'affaire nouvelle
    const factureAn = await prisma.facture.create({
      data: {
        type: "AFFAIRE_NOUVELLE",
        statut: "EMISE",
        numero: "FAC-2026-10-0099",
        policeId: police.id,
        produitId: produit.id,
        versionDateEffet: new Date("2026-01-01"),
        dateEffet: new Date("2026-01-01"),
        dateEcheance: new Date("2026-12-31"),
        contenu: {},
        ttc: "500000",
        creeParId: 1,
        creePar: "test",
      },
    });

    const cheminFactureAn = await calculerCheminStockage(prisma, {
      type: "FACTURE",
      numero: factureAn.numero!,
      version: 1,
      produitCode: prodCode,
      policeId: police.id,
      factureId: factureAn.id,
    });
    expect(cheminFactureAn).toBe(`ACCIDENTS_CORPORELS/${prodCode}/CLI-${client.id}/COT-2026-10-0099/POL-2026-000099/FAC-2026-10-0099/FAC-2026-10-0099_FACTURE_v1.pdf`);
    expect(cheminFactureAn.split("/")).toHaveLength(7);

    // 4. Facture d'avenant (incorporation v2)
    const factureAvn = await prisma.facture.create({
      data: {
        type: "AVENANT",
        statut: "EMISE",
        numero: "FAC-2026-10-0100",
        policeId: police.id,
        produitId: produit.id,
        versionDateEffet: new Date("2026-01-01"),
        adherentsVersion: 2,
        dateEffet: new Date("2026-03-01"),
        dateEcheance: new Date("2026-12-31"),
        contenu: {},
        ttc: "120000",
        creeParId: 1,
        creePar: "test",
      },
    });

    const cheminFactureAvn = await calculerCheminStockage(prisma, {
      type: "FACTURE",
      numero: factureAvn.numero!,
      version: 1,
      produitCode: prodCode,
      policeId: police.id,
      factureId: factureAvn.id,
    });
    expect(cheminFactureAvn).toBe(`ACCIDENTS_CORPORELS/${prodCode}/CLI-${client.id}/COT-2026-10-0099/POL-2026-000099/AVN-02/FAC-2026-10-0100/FAC-2026-10-0100_FACTURE_v1.pdf`);
    expect(cheminFactureAvn.split("/")).toHaveLength(8);

    // 5. Reçu sous facture d'affaire nouvelle
    const cheminRecu = await calculerCheminStockage(prisma, {
      type: "RECU",
      numero: "REC-2026-10-0099",
      version: 1,
      produitCode: prodCode,
      policeId: police.id,
      factureId: factureAn.id,
    });
    expect(cheminRecu).toBe(`ACCIDENTS_CORPORELS/${prodCode}/CLI-${client.id}/COT-2026-10-0099/POL-2026-000099/FAC-2026-10-0099/recus/REC-2026-10-0099_RECU_v1.pdf`);
    expect(cheminRecu.split("/")).toHaveLength(8);

    // 6. Relance sous facture
    const cheminRelance = await calculerCheminStockage(prisma, {
      type: "RELANCE",
      numero: "REL-2026-10-0099",
      version: 1,
      produitCode: prodCode,
      policeId: police.id,
      factureId: factureAn.id,
    });
    expect(cheminRelance).toBe(`ACCIDENTS_CORPORELS/${prodCode}/CLI-${client.id}/COT-2026-10-0099/POL-2026-000099/FAC-2026-10-0099/relances/REL-2026-10-0099_RELANCE_v1.pdf`);
    expect(cheminRelance.split("/")).toHaveLength(8);

    // 7. Avoir annulant la facture
    const factureAvoir = await prisma.facture.create({
      data: {
        type: "AVOIR",
        statut: "EMISE",
        numero: "AV-2026-10-0001",
        policeId: police.id,
        produitId: produit.id,
        versionDateEffet: new Date("2026-01-01"),
        factureOrigineId: factureAn.id,
        dateEffet: new Date("2026-01-01"),
        dateEcheance: new Date("2026-12-31"),
        contenu: {},
        ttc: "-500000",
        motif: "Erreur de saisie",
        creeParId: 1,
        creePar: "test",
      },
    });

    const cheminAvoir = await calculerCheminStockage(prisma, {
      type: "AVOIR",
      numero: factureAvoir.numero!,
      version: 1,
      produitCode: prodCode,
      policeId: police.id,
      factureId: factureAvoir.id,
    });
    expect(cheminAvoir).toBe(`ACCIDENTS_CORPORELS/${prodCode}/CLI-${client.id}/COT-2026-10-0099/POL-2026-000099/FAC-2026-10-0099/avoir/AV-2026-10-0001_AVOIR_v1.pdf`);
    expect(cheminAvoir.split("/")).toHaveLength(8);
  });
});
