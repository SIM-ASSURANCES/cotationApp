import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TypeDocument } from "@/domaine/documents/emission";
import { calculerCheminStockage } from "./stockage-arborescence";
import { stockage as getStockage } from "./stockage";

export class ReorganisationInterditeEnProduction extends Error {
  constructor() {
    super("Le rangement des fichiers est strictement interdit en environnement de production.");
  }
}

export type RapportRangement = {
  total: number;
  deplaces: number;
  dejaRanges: number;
  introuvables: number;
  erreurs: { id: number; numero: string; erreur: string }[];
};

/**
 * Script idempotent de rangement des documents de développement (Étape 5, D41).
 * Recalcule le chemin arborescent, déplace le fichier physique dans le stockage
 * et met à jour la colonne `chemin` dans documents_emis en désactivant temporairement
 * le déclencheur PostgreSQL d'immuabilité (session_replication_role = 'replica').
 *
 * STRICTEMENT INTERDIT EN PRODUCTION.
 */
export async function rangerDocumentsDev(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RapportRangement> {
  if (env.NODE_ENV === "production") {
    throw new ReorganisationInterditeEnProduction();
  }

  const s = getStockage();
  const tous = await prisma.documentEmis.findMany({
    orderBy: { id: "asc" },
  });

  const rapport: RapportRangement = {
    total: tous.length,
    deplaces: 0,
    dejaRanges: 0,
    introuvables: 0,
    erreurs: [],
  };

  for (const doc of tous) {
    try {
      const nouveauChemin = await calculerCheminStockage(prisma, {
        type: doc.type as TypeDocument,
        numero: doc.numero,
        version: doc.version,
        produitCode: doc.produitCode,
        policeNumero: doc.policeNumero,
        cotationId: doc.cotationId,
        policeId: doc.policeId,
        versionAdherents: null,
        adherentOrdre: doc.adherentOrdre,
      });

      if (doc.chemin === nouveauChemin) {
        rapport.dejaRanges += 1;
        continue;
      }

      // Tentative de lecture de l'ancien fichier
      let contenu: Uint8Array | null = null;
      try {
        contenu = await s.lire(doc.chemin);
      } catch {
        rapport.introuvables += 1;
      }

      // Écriture du nouveau fichier si le contenu est disponible
      if (contenu) {
        try {
          await s.ecrire(nouveauChemin, contenu);
        } catch {
          // Déjà présent (idempotence)
        }
      }

      // Mise à jour en base en contournant le trigger par session_replication_role
      await prisma.$executeRawUnsafe("SET session_replication_role = 'replica';");
      try {
        await prisma.$executeRawUnsafe(
          "UPDATE documents_emis SET chemin = $1 WHERE id = $2;",
          nouveauChemin,
          doc.id,
        );
      } finally {
        await prisma.$executeRawUnsafe("SET session_replication_role = 'origin';");
      }

      rapport.deplaces += 1;
    } catch (err) {
      rapport.erreurs.push({
        id: doc.id,
        numero: doc.numero,
        erreur: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return rapport;
}

