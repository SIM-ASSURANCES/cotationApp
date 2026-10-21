import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  cheminStockageArborescent,
  type ContexteCheminStockage,
  type TypeDocument,
} from "@/domaine/documents/emission";

export type EntreeResolutionStockage = {
  type: TypeDocument;
  numero: string;
  version: number;
  produitCode: string;
  policeNumero?: string | null;
  cotationId?: number | null;
  policeId?: number | null;
  factureId?: number | null;
  versionAdherents?: number | null;
  adherentOrdre?: number | null;
};

/**
 * Résout le contexte hiérarchique complet du portefeuille pour un document émis :
 * Branche → Produit → Client (CLI- ou PROSP-) → Cotation → Contrat (POL-) → Avenant (AVN-) → Facture (FAC-) → Pièce
 */
export async function resoudreContexteStockage(
  prisma: PrismaClient,
  entree: EntreeResolutionStockage,
): Promise<ContexteCheminStockage> {
  // 1. Branche principale du produit
  const produit = await prisma.produit.findUnique({
    where: { code: entree.produitCode },
    select: { branchePrincipale: true },
  });
  const brancheCode = produit?.branchePrincipale ?? "BRANCHE";

  // 2. Cotation et client
  let cotationId = entree.cotationId ?? null;
  let policeId = entree.policeId ?? null;
  let policeNumero = entree.policeNumero ?? null;

  if (entree.factureId && (!policeId || !cotationId)) {
    const f = await prisma.facture.findUnique({
      where: { id: entree.factureId },
      select: {
        policeId: true,
        police: {
          select: {
            numero: true,
            cotationId: true,
          },
        },
      },
    });
    if (f) {
      if (!policeId) policeId = f.policeId;
      if (!policeNumero) policeNumero = f.police.numero;
      if (!cotationId) cotationId = f.police.cotationId;
    }
  }

  if (policeId && !cotationId) {
    const p = await prisma.police.findUnique({
      where: { id: policeId },
      select: { cotationId: true, numero: true },
    });
    if (p) {
      cotationId = p.cotationId;
      if (!policeNumero) policeNumero = p.numero;
    }
  }

  let clientIdentifiant = "CLI-0";
  let cotationNumero = "COT-0";

  if (cotationId) {
    const cotation = await prisma.cotation.findUnique({
      where: { id: cotationId },
      select: { id: true, clientId: true, numero: true },
    });
    if (cotation) {
      clientIdentifiant = cotation.clientId !== null ? `CLI-${cotation.clientId}` : `PROSP-${cotation.id}`;
      cotationNumero = cotation.numero ?? `COT-${cotation.id}`;
    }
  }

  // 3. Avenant et Facture
  let avenantNumero: string | null = null;
  let factureNumero: string | null = null;

  if (entree.factureId) {
    const facture = await prisma.facture.findUnique({
      where: { id: entree.factureId },
      select: {
        numero: true,
        adherentsVersion: true,
        factureOrigine: { select: { numero: true } },
      },
    });
    if (facture) {
      if (facture.adherentsVersion && facture.adherentsVersion > 1) {
        avenantNumero = `AVN-${String(facture.adherentsVersion).padStart(2, "0")}`;
      }
      if (entree.type === "FACTURE") {
        factureNumero = entree.numero;
      } else if (entree.type === "AVOIR") {
        factureNumero = facture.factureOrigine?.numero ?? facture.numero ?? null;
      } else {
        factureNumero = facture.numero ?? null;
      }
    }
  }

  if (!avenantNumero && entree.versionAdherents && entree.versionAdherents > 1) {
    avenantNumero = `AVN-${String(entree.versionAdherents).padStart(2, "0")}`;
  }

  return {
    brancheCode,
    produitCode: entree.produitCode,
    clientIdentifiant,
    cotationNumero,
    policeNumero,
    avenantNumero,
    factureNumero,
    type: entree.type,
    numero: entree.numero,
    version: entree.version,
  };
}

/**
 * Calcule le chemin arborescent de stockage d'un document en résolvant son contexte.
 */
export async function calculerCheminStockage(
  prisma: PrismaClient,
  entree: EntreeResolutionStockage,
): Promise<string> {
  const contexte = await resoudreContexteStockage(prisma, entree);
  return cheminStockageArborescent(contexte);
}

