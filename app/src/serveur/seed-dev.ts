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
 * code ni affiché. Deux gardes : NODE_ENV différent de « production » ET AUTORISER_SEED_DEV=oui.
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

/**
 * Crée les comptes de la liste qui n'existent pas encore. Un compte déjà présent est ignoré : jamais
 * dupliqué ni modifié. Aucun compte hors de la liste n'est lu ni touché.
 */
export async function executerSeedDev(motDePasse: string): Promise<{ crees: string[]; ignores: string[] }> {
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
