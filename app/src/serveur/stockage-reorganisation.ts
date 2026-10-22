import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TypeDocument } from "@/domaine/documents/emission";
import { ErreurDejaStocke, ErreurFichierIntrouvable, ErreurGenerateurInjoignable } from "./generateur";
import { calculerCheminStockage } from "./stockage-arborescence";
import { stockage as getStockage } from "./stockage";

export class ReorganisationInterditeEnProduction extends Error {
  constructor() {
    super("Le rangement des fichiers est interdit en production et exige AUTORISER_RANGEMENT_DEV=oui.");
  }
}

/** Le générateur (volume de stockage) est injoignable : le script s'arrête, rien n'est déclaré « introuvable ». */
export class GenerateurInjoignablePourRangement extends Error {
  constructor() {
    super("Le générateur de documents est injoignable depuis cette machine : lancer le script dans Docker (docker compose run --rm -e NODE_ENV=development -e AUTORISER_RANGEMENT_DEV=oui outils npm run ranger:dev).");
  }
}

export type RapportRangement = {
  total: number;
  deplaces: number;
  dejaRanges: number;
  introuvables: number;
  erreurs: { id: number; numero: string; erreur: string }[];
};

const sha256 = (octets: Uint8Array) => createHash("sha256").update(octets).digest("hex");
const egaux = (a: Uint8Array, b: Uint8Array) => sha256(a) === sha256(b);

/**
 * Script idempotent de rangement des documents de développement (Étape 5, D41).
 * Recalcule le chemin arborescent, COPIE le fichier dans le stockage (l'ancien fichier n'est jamais
 * supprimé : stockage en ajout seul) et met à jour la colonne `chemin` de documents_emis. Pour cela,
 * le déclencheur d'immuabilité est désactivé par `SET LOCAL session_replication_role = replica`,
 * dans la même transaction que l'UPDATE : aucune connexion ne reste en mode replica.
 *
 * - fichier source introuvable (404 du générateur seulement) : `chemin` inchangé, compté en « introuvables » ;
 * - générateur injoignable : le script s'arrête aussitôt (GenerateurInjoignablePourRangement), aucun document n'est
 *   déclaré introuvable à tort ; toute autre erreur de lecture est portée au rapport du document ;
 * - fichier cible déjà présent : même empreinte SHA-256 = idempotent, empreinte différente = erreur,
 *   pas d'UPDATE ; toute autre erreur d'écriture : erreur au rapport, pas d'UPDATE.
 *
 * STRICTEMENT INTERDIT EN PRODUCTION. Lancement (jamais sur un serveur) :
 *   AUTORISER_RANGEMENT_DEV=oui npm run ranger:dev
 */
export async function rangerDocumentsDev(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RapportRangement> {
  if (env.NODE_ENV === "production" || env.AUTORISER_RANGEMENT_DEV !== "oui") {
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

      let contenu: Uint8Array;
      try {
        contenu = await s.lire(doc.chemin);
      } catch (err) {
        if (!(err instanceof ErreurFichierIntrouvable)) throw err;
        rapport.introuvables += 1;
        continue;
      }

      try {
        const ecrit = await s.ecrire(nouveauChemin, contenu);
        if (ecrit.empreinte !== sha256(contenu)) {
          throw new Error(`Empreinte écrite différente de la source pour ${nouveauChemin}`);
        }
      } catch (err) {
        if (!(err instanceof ErreurDejaStocke)) throw err;
        const present = await s.lire(nouveauChemin);
        if (!egaux(present, contenu)) {
          throw new Error(`Un fichier différent occupe déjà ${nouveauChemin} : aucun UPDATE`);
        }
      }

      // SET LOCAL et UPDATE dans UNE transaction : le mode replica s'arrête avec elle.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
        await tx.$executeRawUnsafe(
          "UPDATE documents_emis SET chemin = $1 WHERE id = $2;",
          nouveauChemin,
          doc.id,
        );
      });

      rapport.deplaces += 1;
    } catch (err) {
      if (err instanceof ErreurGenerateurInjoignable) throw new GenerateurInjoignablePourRangement();
      rapport.erreurs.push({
        id: doc.id,
        numero: doc.numero,
        erreur: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return rapport;
}

