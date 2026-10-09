import "server-only";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { etatStockage, type EtatStockage } from "./stockage";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Surveillance du stockage par l'administrateur (T14, CDC §14.2 « alerte à l'administrateur ») : droit « Gérer
 * utilisateurs, droits, dossier partagé » à « Oui » (l'Admin système par défaut).
 */

export async function estAdministrateur(acteur: UtilisateurCourant): Promise<boolean> {
  return (await niveauDuProfil(acteur.profil, "GERER_UTILISATEURS")) === "OUI";
}

async function exigerAdministrateur(acteur: UtilisateurCourant): Promise<void> {
  if (!(await estAdministrateur(acteur))) throw new ErreurAcces("Droit insuffisant : surveillance du stockage.");
}

/** Bandeau : rien pour un autre profil ; pour l'administrateur, l'état des écritures différées. */
export async function alerteStockage(acteur: UtilisateurCourant): Promise<{ enAttente: number; plusAncienne: Date | null } | null> {
  if (!(await estAdministrateur(acteur))) return null;
  const enAttente = await obtenirPrisma().ecritureDifferee.count();
  if (enAttente === 0) return null;
  const plus = await obtenirPrisma().ecritureDifferee.findFirst({ orderBy: { creeLe: "asc" }, select: { creeLe: true } });
  return { enAttente, plusAncienne: plus?.creeLe ?? null };
}

export async function lireEtatStockage(acteur: UtilisateurCourant): Promise<EtatStockage> {
  await exigerAdministrateur(acteur);
  return etatStockage();
}

/** « Relancer maintenant » : toutes les écritures différées sont reconfiées à la file de tâches. */
export async function relancerEcritures(acteur: UtilisateurCourant, adresseIp: string | null): Promise<number> {
  await exigerAdministrateur(acteur);
  const lignes = await obtenirPrisma().ecritureDifferee.findMany({ select: { documentId: true } });
  if (lignes.length === 0) throw new ErreurMetier("Aucune écriture en attente.");
  const { enfilerEcriture } = await import("./taches");
  try {
    for (const { documentId } of lignes) await enfilerEcriture(documentId, { immediat: true });
  } catch {
    throw new ErreurMetier("La file de tâches est injoignable (Redis ou travailleur arrêté) : prévenez l'administrateur du serveur.");
  }
  await journaliser({ acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "ECRITURE_RELANCEE", objetType: "stockage", apres: { documents: lignes.map((l) => l.documentId) }, adresseIp });
  return lignes.length;
}
