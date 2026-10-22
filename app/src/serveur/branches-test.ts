// Aide des tests d'intégration : inscrit une branche fiscale dans la liste (D21) avant d'y rattacher un taux ou un produit.
import { obtenirPrisma } from "./prisma";

export async function assurerBranche(code: string): Promise<string> {
  await obtenirPrisma().branche.upsert({ where: { code }, update: {}, create: { code, libelle: `${code} (test)`, creePar: "test" } });
  return code;
}

/**
 * Rattache un modèle de CG à une branche principale pour un test (étape 6, D42) : REMPLACE les lignes de la branche par une ligne
 * datée de 2020-01-01. Les lignes en vigueur sont immuables (déclencheur) : le test passe en mode « replica » le temps de la
 * transaction, comme le script de rangement de développement. Base de test seulement.
 */
export async function rattacherCgDeTest(branchePrincipale: string, modeleCode: string, dateEffet = "2020-01-01"): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe('DELETE FROM branche_cg WHERE branche_principale = $1;', branchePrincipale);
    await tx.$executeRawUnsafe('INSERT INTO branche_cg (branche_principale, modele_code, date_effet, cree_par) VALUES ($1, $2, $3::date, $4);', branchePrincipale, modeleCode, dateEffet, "test");
  });
}

/** Retire les CG d'une branche principale (base de test seulement, même principe que rattacherCgDeTest). */
export async function viderCgDeTest(branchePrincipale: string): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe("DELETE FROM branche_cg WHERE branche_principale = $1;", branchePrincipale);
  });
}
