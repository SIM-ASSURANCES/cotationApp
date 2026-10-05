import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import type { DateIso } from "@/domaine/calcul/dates";
import { cleCompteur, formaterNumero, formaterNumeroPolice, type PrefixeNumero } from "@/domaine/cotation/numerotation";

/**
 * Numérotation continue et SANS TROU (CDC §11.4). Le compteur est une ligne de la table `sequences` :
 * l'incrément verrouille cette ligne jusqu'à la fin de la transaction. Deux émissions simultanées
 * passent donc l'une après l'autre, et si la transaction est annulée l'incrément l'est aussi :
 * le numéro suivant ne saute jamais.
 *
 * À appeler UNIQUEMENT dans la transaction de l'émission, après les contrôles, au plus près de l'écriture.
 */
async function incrementer(tx: Prisma.TransactionClient, cle: string): Promise<number> {
  const lignes = await tx.$queryRaw<{ valeur: number }[]>`
    INSERT INTO sequences (cle, valeur) VALUES (${cle}, 1)
    ON CONFLICT (cle) DO UPDATE SET valeur = sequences.valeur + 1
    RETURNING valeur`;
  return lignes[0].valeur;
}

export async function allouerNumero(tx: Prisma.TransactionClient, prefixe: PrefixeNumero, date: DateIso): Promise<string> {
  return formaterNumero(prefixe, date, await incrementer(tx, cleCompteur(prefixe, date)));
}

export async function allouerNumeroPolice(tx: Prisma.TransactionClient, date: DateIso): Promise<string> {
  return formaterNumeroPolice(date, await incrementer(tx, cleCompteur("POL", date)));
}
