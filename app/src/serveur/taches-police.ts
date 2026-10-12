import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { peutAgir, peutLire, type CodeAction } from "@/domaine/droits";
import { estOuverte, LIBELLE_TACHE, problemesMotifFermeture, type PiecesEmises, type TacheLue, type TypeTache } from "@/domaine/imports/taches";

import { journaliser, type ActeurAudit } from "./audit";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Tâches visibles sur une police après un import en masse (H64) : « Nouvelle version des CP à émettre » et « Facture
 * d'avenant à émettre ». Créées dans la transaction qui confirme l'import ; fermées (H66, session 6.0) automatiquement à
 * l'émission de la pièce, ou à la main avec un motif obligatoire. Chaque fermeture est journalisée (TACHE_FERMEE).
 */

type Client = Prisma.TransactionClient | ReturnType<typeof obtenirPrisma>;

/** Droit d'émettre la pièce d'une tâche : c'est aussi le droit de la fermer à la main. */
const ACTION_DE: Record<TypeTache, CodeAction> = { CP_A_EMETTRE: "EMETTRE_CONTRAT", FACTURE_AVENANT_A_EMETTRE: "EMETTRE_FACTURE" };

/** Dans la transaction de la confirmation : les deux tâches de la nouvelle version de la liste (rejouable sans doublon). */
export async function creerTachesImport(tx: Prisma.TransactionClient, a: { policeId: number; lotId: number; versionAdherents: number; creePar: string }): Promise<void> {
  await tx.tachePolice.createMany({
    data: (["CP_A_EMETTRE", "FACTURE_AVENANT_A_EMETTRE"] as const).map((type) => ({ policeId: a.policeId, type, lotId: a.lotId, versionAdherents: a.versionAdherents, creePar: a.creePar })),
    skipDuplicates: true,
  });
}

/** Pièces émises de la police : listes reprises par les CP émises, versions facturées par une facture d'avenant émise. */
async function piecesEmises(client: Client, policeId: number): Promise<PiecesEmises> {
  const [cp, avenants] = await Promise.all([
    client.documentEmis.findMany({ where: { policeId, type: "CP" }, select: { versionsAssociees: true } }),
    client.facture.findMany({ where: { policeId, type: "AVENANT", numero: { not: null } }, select: { adherentsVersion: true } }),
  ]);
  return {
    cpVersionsAdherents: cp.map((d) => (d.versionsAssociees as { versionAdherents?: number | null }).versionAdherents ?? null),
    avenantsEmis: avenants.map((f) => f.adherentsVersion),
  };
}

/**
 * Fermeture AUTOMATIQUE (H66) : toute tâche encore ouverte dont la pièce est maintenant émise. Appelée après l'émission
 * d'une version des CP et dans la transaction de l'émission d'une facture. Sans effet s'il n'y a rien à fermer.
 */
export async function fermerTachesAutomatiquement(client: Client, policeId: number, acteur: ActeurAudit, adresseIp: string | null): Promise<number> {
  const ouvertes = await client.tachePolice.findMany({ where: { policeId, fermeture: null } });
  if (ouvertes.length === 0) return 0;
  const pieces = await piecesEmises(client, policeId);
  let fermees = 0;
  for (const t of ouvertes) {
    if (estOuverte({ type: t.type as TypeTache, versionAdherents: t.versionAdherents }, pieces)) continue;
    const motif = t.type === "CP_A_EMETTRE" ? `Conditions particulières émises avec la liste version ${t.versionAdherents} ou plus récente.` : `Facture d'avenant émise pour la liste version ${t.versionAdherents}.`;
    // Condition « encore ouverte » : deux émissions simultanées ne ferment (ni ne journalisent) la tâche qu'une fois.
    const fait = await client.tachePolice.updateMany({ where: { id: t.id, fermeture: null }, data: { fermeture: "AUTOMATIQUE", fermeeLe: new Date(), fermeePar: acteur.identifiant ?? "système", motifFermeture: motif } });
    if (fait.count === 0) continue;
    await journaliser({ acteur, action: "TACHE_FERMEE", objetType: "tache_police", objetId: t.id, apres: { police: policeId, tache: LIBELLE_TACHE[t.type as TypeTache], versionAdherents: t.versionAdherents, fermeture: "AUTOMATIQUE", motif }, adresseIp }, client);
    fermees += 1;
  }
  return fermees;
}

/** Fermeture MANUELLE (H66) : motif obligatoire ; droit d'émettre la pièce de la tâche. Une tâche fermée ne rouvre pas. */
export async function fermerTache(acteur: UtilisateurCourant, tacheId: number, motif: string, adresseIp: string | null): Promise<void> {
  const prisma = obtenirPrisma();
  const t = await prisma.tachePolice.findUnique({ where: { id: tacheId } });
  if (!t) throw new ErreurMetier("Tâche introuvable.");
  if (!peutAgir(await niveauDuProfil(acteur.profil, ACTION_DE[t.type as TypeTache]))) throw new ErreurAcces("Droit insuffisant : fermeture de la tâche.");
  const problemes = problemesMotifFermeture(motif);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  await prisma.$transaction(async (tx) => {
    const fait = await tx.tachePolice.updateMany({ where: { id: tacheId, fermeture: null }, data: { fermeture: "MANUELLE", fermeeLe: new Date(), fermeePar: acteur.identifiant, motifFermeture: motif.trim() } });
    if (fait.count === 0) throw new ErreurMetier("Cette tâche est déjà fermée.");
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "TACHE_FERMEE",
        objetType: "tache_police",
        objetId: tacheId,
        apres: { police: t.policeId, tache: LIBELLE_TACHE[t.type as TypeTache], versionAdherents: t.versionAdherents, fermeture: "MANUELLE", motif: motif.trim() },
        adresseIp,
      },
      tx,
    );
  });
}

/** Tâches OUVERTES d'une police, les plus anciennes d'abord. Lecture : droit de lire les contrats ou les factures. */
export async function tachesDePolice(acteur: UtilisateurCourant, policeId: number): Promise<TacheLue[]> {
  const [contrat, facture] = await Promise.all([niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT"), niveauDuProfil(acteur.profil, "EMETTRE_FACTURE")]);
  if (!peutLire(contrat) && !peutLire(facture)) return [];
  const prisma = obtenirPrisma();
  const taches = await prisma.tachePolice.findMany({ where: { policeId, fermeture: null }, orderBy: [{ versionAdherents: "asc" }, { type: "asc" }] });
  if (taches.length === 0) return [];
  // Tâche d'avant la session 6.0 : sa pièce a pu être émise sans fermeture enregistrée.
  const pieces = await piecesEmises(prisma, policeId);
  const agit: Record<TypeTache, boolean> = { CP_A_EMETTRE: peutAgir(contrat), FACTURE_AVENANT_A_EMETTRE: peutAgir(facture) };
  return taches
    .map((t) => ({ id: t.id, type: t.type as TypeTache, versionAdherents: t.versionAdherents, creeLe: t.creeLe, creePar: t.creePar, lotId: t.lotId }))
    .filter((t) => estOuverte(t, pieces))
    .map((t) => ({ ...t, libelle: LIBELLE_TACHE[t.type], fermable: agit[t.type] }));
}

/** Tâches ouvertes de la police issue d'une cotation acceptée (écran de la cotation). */
export async function tachesDeCotation(acteur: UtilisateurCourant, cotationId: number): Promise<TacheLue[]> {
  const police = await obtenirPrisma().police.findUnique({ where: { cotationId }, select: { id: true } });
  return police ? tachesDePolice(acteur, police.id) : [];
}
