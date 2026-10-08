// Aide des tests d'intégration : inscrit une branche fiscale dans la liste (D21) avant d'y rattacher un taux ou un produit.
import { obtenirPrisma } from "./prisma";

export async function assurerBranche(code: string): Promise<string> {
  await obtenirPrisma().branche.upsert({ where: { code }, update: {}, create: { code, libelle: `${code} (test)`, creePar: "test" } });
  return code;
}
