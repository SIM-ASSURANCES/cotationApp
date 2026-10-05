import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { obtenirConfig } from "./config";

// Un seul client Prisma, donc un seul groupe de connexions, pour tout le serveur.
// En développement, le rechargement à chaud de Next.js réévalue les modules : le
// client est rangé dans globalThis pour ne pas ouvrir de nouvelles connexions à
// chaque modification de code.
const globalPourPrisma = globalThis as unknown as { prisma?: PrismaClient };

function creerClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: obtenirConfig().DATABASE_URL,
    // Avec Prisma 7 et le pilote pg, le délai de connexion par défaut est 0, c'est-à-dire
    // une attente sans limite. On rétablit les 5 secondes de Prisma 6 : une base
    // injoignable doit échouer vite.
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}

/**
 * Client Prisma partagé. Il est créé à la première utilisation, et non à l'import :
 * la construction de l'application (`next build`) ne lit donc pas la configuration.
 */
export function obtenirPrisma(): PrismaClient {
  globalPourPrisma.prisma ??= creerClient();
  return globalPourPrisma.prisma;
}
