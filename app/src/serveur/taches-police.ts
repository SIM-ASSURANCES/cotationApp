import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { peutLire } from "@/domaine/droits";
import { LIBELLE_TACHE, tachesOuvertes, type TacheLue, type TypeTache } from "@/domaine/imports/taches";

import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";

/**
 * Tâches visibles sur une police après un import en masse (H64) : « Nouvelle version des CP à émettre » et « Facture
 * d'avenant à émettre ». Créées dans la transaction qui confirme l'import ; ouvertes tant que la pièce n'est pas émise,
 * état recalculé à chaque lecture depuis les documents émis et les factures (`domaine/imports/taches.ts`).
 */

/** Dans la transaction de la confirmation : les deux tâches de la nouvelle version de la liste (rejouable sans doublon). */
export async function creerTachesImport(tx: Prisma.TransactionClient, a: { policeId: number; lotId: number; versionAdherents: number; creePar: string }): Promise<void> {
  await tx.tachePolice.createMany({
    data: (["CP_A_EMETTRE", "FACTURE_AVENANT_A_EMETTRE"] as const).map((type) => ({ policeId: a.policeId, type, lotId: a.lotId, versionAdherents: a.versionAdherents, creePar: a.creePar })),
    skipDuplicates: true,
  });
}

/** Tâches OUVERTES d'une police, les plus anciennes d'abord. Lecture : droit de lire les contrats ou les factures. */
export async function tachesDePolice(acteur: UtilisateurCourant, policeId: number): Promise<TacheLue[]> {
  const [contrat, facture] = await Promise.all([niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT"), niveauDuProfil(acteur.profil, "EMETTRE_FACTURE")]);
  if (!peutLire(contrat) && !peutLire(facture)) return [];
  const prisma = obtenirPrisma();
  const taches = await prisma.tachePolice.findMany({ where: { policeId }, orderBy: [{ versionAdherents: "asc" }, { type: "asc" }] });
  if (taches.length === 0) return [];
  const [cp, avenants] = await Promise.all([
    prisma.documentEmis.findMany({ where: { policeId, type: "CP" }, select: { versionsAssociees: true } }),
    prisma.facture.findMany({ where: { policeId, type: "AVENANT", numero: { not: null } }, select: { adherentsVersion: true } }),
  ]);
  const ouvertes = tachesOuvertes(
    taches.map((t) => ({ id: t.id, type: t.type as TypeTache, versionAdherents: t.versionAdherents, creeLe: t.creeLe, creePar: t.creePar, lotId: t.lotId })),
    {
      cpVersionsAdherents: cp.map((d) => (d.versionsAssociees as { versionAdherents?: number | null }).versionAdherents ?? null),
      avenantsEmis: avenants.map((f) => f.adherentsVersion),
    },
  );
  return ouvertes.map((t) => ({ ...t, libelle: LIBELLE_TACHE[t.type] }));
}

/** Tâches ouvertes de la police issue d'une cotation acceptée (écran de la cotation). */
export async function tachesDeCotation(acteur: UtilisateurCourant, cotationId: number): Promise<TacheLue[]> {
  const police = await obtenirPrisma().police.findUnique({ where: { cotationId }, select: { id: true } });
  return police ? tachesDePolice(acteur, police.id) : [];
}
