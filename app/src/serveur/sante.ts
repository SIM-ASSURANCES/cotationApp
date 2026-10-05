import "server-only";

import { obtenirConfig } from "./config";
import { obtenirPrisma } from "./prisma";

export type EtatService = "ok" | "ko";

export type Sante = {
  statut: "ok" | "degrade";
  base: EtatService;
  generateur: EtatService;
};

/** Délai court : le contrôle de santé doit répondre vite, même si le générateur est arrêté. */
const DELAI_GENERATEUR_MS = 2_000;

/** Trace côté serveur uniquement : la réponse HTTP, elle, ne contient jamais de détail. */
function journaliser(service: string, erreur: unknown): void {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  console.error(`[sante] ${service} : ko (${message})`);
}

async function verifierBase(): Promise<EtatService> {
  try {
    await obtenirPrisma().$queryRaw`SELECT 1`;
    return "ok";
  } catch (erreur) {
    journaliser("base", erreur);
    return "ko";
  }
}

async function verifierGenerateur(): Promise<EtatService> {
  try {
    const reponse = await fetch(new URL("/sante", obtenirConfig().GENERATEUR_URL), {
      signal: AbortSignal.timeout(DELAI_GENERATEUR_MS),
      cache: "no-store",
    });
    if (!reponse.ok) {
      journaliser("generateur", `HTTP ${reponse.status}`);
      return "ko";
    }
    const corps: unknown = await reponse.json();
    const enBonneSante =
      typeof corps === "object" && corps !== null && "statut" in corps && corps.statut === "ok";
    return enBonneSante ? "ok" : "ko";
  } catch (erreur) {
    journaliser("generateur", erreur);
    return "ko";
  }
}

/** Vérifie la base et le générateur en parallèle. */
export async function verifierSante(): Promise<Sante> {
  const [base, generateur] = await Promise.all([verifierBase(), verifierGenerateur()]);
  return {
    statut: base === "ok" && generateur === "ok" ? "ok" : "degrade",
    base,
    generateur,
  };
}
