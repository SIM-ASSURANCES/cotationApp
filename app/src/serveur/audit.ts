import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type { ActionAudit } from "@/domaine/audit";

import { obtenirPrisma } from "./prisma";

/**
 * Journal d'audit (CDC §15.4) : table en ajout seul (un déclencheur PostgreSQL refuse toute
 * modification), écrite par la SEULE fonction `journaliser` ci-dessous. Une règle ESLint interdit
 * tout autre accès à `journalAudit` dans le code.
 */

export type ActeurAudit = { id: number | null; identifiant: string | null };

export type EntreeAudit = {
  /** null = action du système (script d'installation, par exemple). */
  acteur: ActeurAudit | null;
  action: ActionAudit;
  objetType?: string;
  objetId?: string | number;
  /** États avant/après, sans secret (jamais d'empreinte de mot de passe). */
  avant?: Prisma.InputJsonValue;
  apres?: Prisma.InputJsonValue;
  adresseIp?: string | null;
};

type ClientPrisma = PrismaClient | Prisma.TransactionClient;

/**
 * Ajoute une ligne au journal. À appeler DANS la même transaction que la modification
 * journalisée (paramètre `client`) : si l'une échoue, l'autre est annulée.
 */
export async function journaliser(entree: EntreeAudit, client: ClientPrisma = obtenirPrisma()): Promise<void> {
  await client.journalAudit.create({
    data: {
      utilisateurId: entree.acteur?.id ?? null,
      utilisateurIdentifiant: entree.acteur?.identifiant ?? null,
      action: entree.action,
      objetType: entree.objetType ?? null,
      objetId: entree.objetId === undefined ? null : String(entree.objetId),
      avant: entree.avant,
      apres: entree.apres,
      adresseIp: entree.adresseIp ?? null,
    },
  });
}

export type LigneJournal = {
  id: string;
  horodatage: Date;
  utilisateur: string | null;
  action: string;
  objet: string | null;
  avant: unknown;
  apres: unknown;
  adresseIp: string | null;
};

const TAILLE_PAGE = 50;

/** Lecture paginée, du plus récent au plus ancien. `avantId` : pour la page suivante. */
export async function lireJournal(options: {
  action?: string;
  avantId?: bigint;
}): Promise<{ lignes: LigneJournal[]; suivant: string | null }> {
  const lignes = await obtenirPrisma().journalAudit.findMany({
    where: {
      ...(options.action ? { action: options.action } : {}),
      ...(options.avantId ? { id: { lt: options.avantId } } : {}),
    },
    orderBy: { id: "desc" },
    take: TAILLE_PAGE + 1,
  });
  const page = lignes.slice(0, TAILLE_PAGE);
  return {
    lignes: page.map((l) => ({
      id: l.id.toString(),
      horodatage: l.horodatage,
      utilisateur: l.utilisateurIdentifiant,
      action: l.action,
      objet: l.objetType ? `${l.objetType}${l.objetId ? ` ${l.objetId}` : ""}` : null,
      avant: l.avant,
      apres: l.apres,
      adresseIp: l.adresseIp,
    })),
    suivant: lignes.length > TAILLE_PAGE ? page[page.length - 1].id.toString() : null,
  };
}

const TAILLE_LOT_EXPORT = 2_000;

/**
 * Lecture du journal pour l'export Excel : du plus récent au plus ancien, par lots, jusqu'à `limite` lignes. `tronque` : il en reste
 * de plus anciennes (le filtre est le même que celui de l'écran : l'action).
 */
export async function lireJournalPourExport(options: { action?: string; limite: number }): Promise<{ lignes: LigneJournal[]; tronque: boolean }> {
  const lignes: LigneJournal[] = [];
  let avantId: bigint | undefined;
  const filtre = (): Prisma.JournalAuditWhereInput => ({ ...(options.action ? { action: options.action } : {}), ...(avantId ? { id: { lt: avantId } } : {}) });
  while (lignes.length < options.limite) {
    const lot = await obtenirPrisma().journalAudit.findMany({
      where: filtre(),
      orderBy: { id: "desc" },
      take: Math.min(TAILLE_LOT_EXPORT, options.limite - lignes.length),
    });
    if (lot.length === 0) return { lignes, tronque: false };
    for (const l of lot) {
      lignes.push({
        id: l.id.toString(),
        horodatage: l.horodatage,
        utilisateur: l.utilisateurIdentifiant,
        action: l.action,
        objet: l.objetType ? `${l.objetType}${l.objetId ? ` ${l.objetId}` : ""}` : null,
        avant: l.avant,
        apres: l.apres,
        adresseIp: l.adresseIp,
      });
    }
    avantId = BigInt(lignes[lignes.length - 1].id);
  }
  // Limite atteinte : reste-t-il une ligne plus ancienne ?
  return { lignes, tronque: (await obtenirPrisma().journalAudit.count({ where: filtre() })) > 0 };
}

/** Une action a-t-elle déjà été journalisée pour cet objet ? (tâche quotidienne rejouée : une seule trace par jour) */
export async function dejaJournalise(action: ActionAudit, objetType: string, objetId: string): Promise<boolean> {
  return (await obtenirPrisma().journalAudit.count({ where: { action, objetType, objetId } })) > 0;
}
