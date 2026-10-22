// Aide des tests : seuil de validation global (10 000 000 F TTC par défaut depuis l'étape 3), relevé le temps d'un fichier de test.
import { obtenirPrisma } from "./prisma";

const DATE_SEUIL = new Date("2026-01-01T00:00:00.000Z");
const CLE = "seuil_validation_global";

/** Fixe le seuil global (ligne du 01/01/2026, celle de la migration). */
export async function fixerSeuilGlobalDeTest(valeur: string): Promise<void> {
  await obtenirPrisma().parametre.upsert({
    where: { cle_dateEffet: { cle: CLE, dateEffet: DATE_SEUIL } },
    update: { valeur },
    create: { cle: CLE, valeur, dateEffet: DATE_SEUIL, creePar: "test" },
  });
}

/** Rétablit le seuil de la migration (10 000 000) à la fin d'un fichier de test. */
export async function retablirSeuilGlobalDeTest(): Promise<void> {
  await fixerSeuilGlobalDeTest("10000000");
  await obtenirPrisma().parametre.deleteMany({ where: { cle: CLE, dateEffet: { not: DATE_SEUIL } } });
}
