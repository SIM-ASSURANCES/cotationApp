import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import type { DateIso } from "@/domaine/calcul/dates";
import { cleCompteur, cleFormatNumero, FORMATS_NUMERO_DEFAUT, formaterSelon, type PrefixeNumero } from "@/domaine/cotation/numerotation";

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

/** Format en vigueur à une date (paramètre historisé, session 4b), sinon le format par défaut du CDC. */
export async function formatNumeroEnVigueur(client: Pick<Prisma.TransactionClient, "parametre">, prefixe: PrefixeNumero, date: DateIso): Promise<string> {
  const ligne = await client.parametre.findFirst({ where: { cle: cleFormatNumero(prefixe), dateEffet: { lte: new Date(`${date}T00:00:00.000Z`) } }, orderBy: { dateEffet: "desc" } });
  return ligne?.valeur ?? FORMATS_NUMERO_DEFAUT[prefixe];
}

export async function allouerNumero(tx: Prisma.TransactionClient, prefixe: PrefixeNumero, date: DateIso): Promise<string> {
  const format = await formatNumeroEnVigueur(tx, prefixe, date);
  return formaterSelon(format, date, await incrementer(tx, cleCompteur(prefixe, date)));
}
