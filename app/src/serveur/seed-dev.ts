import "server-only";

import type { CodeProfil } from "@/domaine/droits";
import { normaliserIdentifiant, problemesMotDePasse } from "@/domaine/securite";

import { obtenirPrisma } from "./prisma";
import { creerCompteSeedDev } from "./utilisateurs";

/**
 * Seed de DÉVELOPPEMENT : un compte de test par profil du CDC §4, sans changement de mot de passe
 * imposé, pour accélérer les remises à zéro pendant la recette. Jamais lancé automatiquement :
 * seulement à la main (npm run seed:dev). Jamais sur un serveur : voir docs/deploiement.md.
 *
 * Le mot de passe vient UNIQUEMENT de la variable SEED_MOT_DE_PASSE ; il n'est jamais écrit dans le
 * code ni affiché. Trois gardes : NODE_ENV différent de « production », AUTORISER_SEED_DEV=oui, et une base
 * qui ne contient aucun compte étranger au seed (audit m7 : même avec les deux variables forcées, le seed ne
 * touche jamais une base où de vrais comptes existent).
 */

export const COMPTES_SEED_DEV: readonly { identifiant: string; nom: string; profil: CodeProfil }[] = [
  { identifiant: "test.commercial", nom: "Test – Commercial", profil: "COMMERCIAL" },
  { identifiant: "test.production", nom: "Test – Gestionnaire production", profil: "GESTIONNAIRE_PRODUCTION" },
  { identifiant: "test.technique", nom: "Test – Technique", profil: "TECHNIQUE" },
  { identifiant: "test.comptabilite", nom: "Test – Comptabilité", profil: "COMPTABILITE" },
  { identifiant: "test.direction", nom: "Test – Direction Générale", profil: "DIRECTION_GENERALE" },
  { identifiant: "test.admin", nom: "Test – Admin système", profil: "ADMIN_SYSTEME" },
];

export class SeedRefuse extends Error {
  override name = "SeedRefuse";
}

/**
 * Contrôle l'environnement avant toute écriture ; renvoie le mot de passe à utiliser. Les messages
 * ne reprennent jamais la valeur du mot de passe.
 */
export function controlerEnvironnementSeed(env: Record<string, string | undefined>): string {
  if (env.NODE_ENV === "production") {
    throw new SeedRefuse("Refus : NODE_ENV=production. Le seed de développement ne s'exécute jamais en production.");
  }
  if (env.AUTORISER_SEED_DEV !== "oui") {
    throw new SeedRefuse("Refus : AUTORISER_SEED_DEV=oui est obligatoire pour lancer le seed de développement (jamais sur le VPS).");
  }
  const motDePasse = env.SEED_MOT_DE_PASSE ?? "";
  if (motDePasse === "") {
    throw new SeedRefuse("Refus : SEED_MOT_DE_PASSE est absente ou vide (à définir dans le .env local, jamais dans le dépôt).");
  }
  const problemes = [...new Set(COMPTES_SEED_DEV.flatMap((c) => problemesMotDePasse(motDePasse, c.identifiant)))];
  if (problemes.length > 0) {
    throw new SeedRefuse(`Refus : SEED_MOT_DE_PASSE ne respecte pas la politique de mot de passe (${problemes.join(", ")}).`);
  }
  return motDePasse;
}

/** Identifiants qui ne viennent pas du seed (comparés après normalisation). */
export function comptesHorsSeed(identifiants: readonly string[]): string[] {
  const duSeed = new Set(COMPTES_SEED_DEV.map((c) => normaliserIdentifiant(c.identifiant)));
  return identifiants.filter((identifiant) => !duSeed.has(normaliserIdentifiant(identifiant)));
}

/**
 * Garde de la base (audit m7) : refus si elle contient un compte qui ne vient pas du seed. Le message donne le nombre de comptes,
 * jamais leurs identifiants. Les comptes du seed eux-mêmes ne bloquent pas (second lancement : rien n'est dupliqué).
 */
export async function controlerBaseSansComptesHorsSeed(
  client: { utilisateur: { findMany(args: { select: { identifiant: true } }): Promise<{ identifiant: string }[]> } } = obtenirPrisma(),
): Promise<void> {
  const etrangers = comptesHorsSeed((await client.utilisateur.findMany({ select: { identifiant: true } })).map((u) => u.identifiant));
  if (etrangers.length > 0) {
    throw new SeedRefuse(
      `Refus : la base contient ${etrangers.length} compte(s) qui ne viennent pas du seed de développement. Ce n'est pas une base de développement vide : le seed ne s'y exécute pas (aucun compte créé).`,
    );
  }
}

/**
 * Crée les comptes de la liste qui n'existent pas encore. Un compte déjà présent est ignoré : jamais
 * dupliqué ni modifié. Aucun compte hors de la liste n'est lu ni touché, mais leur présence fait refuser le seed.
 * `controleBase` : la garde de la base ; les tests d'intégration, dont la base partagée contient d'autres comptes, la remplacent.
 */
export async function executerSeedDev(motDePasse: string, controleBase: () => Promise<void> = controlerBaseSansComptesHorsSeed): Promise<{ crees: string[]; ignores: string[] }> {
  await controleBase();
  const crees: string[] = [];
  const ignores: string[] = [];
  for (const compte of COMPTES_SEED_DEV) {
    const identifiant = normaliserIdentifiant(compte.identifiant);
    if (await obtenirPrisma().utilisateur.findUnique({ where: { identifiant }, select: { id: true } })) {
      ignores.push(identifiant);
      continue;
    }
    await creerCompteSeedDev({ identifiant, nom: compte.nom, profil: compte.profil, motDePasse });
    crees.push(identifiant);
  }
  return { crees, ignores };
}
