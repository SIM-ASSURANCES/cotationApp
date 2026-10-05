import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { peutLire, type CodeAction, type CodeNiveau } from "@/domaine/droits";

import { auth } from "./auth";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";
import { versUtilisateurCourant } from "./utilisateurs";

/**
 * Utilisateur connecté, ou null. Le jeton de session ne sert qu'à retrouver l'identifiant :
 * le compte est relu en base, donc un compte désactivé ou un profil modifié prend effet tout de
 * suite, sans attendre l'expiration de la session. `cache` évite de relire la base plusieurs
 * fois pendant une même requête.
 */
export const obtenirUtilisateurCourant = cache(async (): Promise<UtilisateurCourant | null> => {
  const session = await auth();
  const id = Number(session?.user?.id);
  if (!Number.isInteger(id)) {
    return null;
  }
  const utilisateur = await obtenirPrisma().utilisateur.findUnique({
    where: { id },
    include: { profil: true },
  });
  return utilisateur?.actif ? versUtilisateurCourant(utilisateur) : null;
});

/** Pour une page protégée : redirige vers la connexion, ou vers le changement de mot de passe obligatoire. */
export async function exigerUtilisateur(
  options: { autoriserChangementMotDePasse?: boolean } = {},
): Promise<UtilisateurCourant> {
  const utilisateur = await obtenirUtilisateurCourant();
  if (!utilisateur) {
    redirect("/connexion");
  }
  if (utilisateur.doitChangerMotDePasse && !options.autoriserChangementMotDePasse) {
    redirect("/mon-compte");
  }
  return utilisateur;
}

/** Pour une page réservée : connecté ET niveau suffisant sur l'action, sinon page « accès refusé ». */
export async function exigerDroit(
  action: CodeAction,
  acceptable: (niveau: CodeNiveau) => boolean = peutLire,
): Promise<UtilisateurCourant> {
  const utilisateur = await exigerUtilisateur();
  if (!acceptable(await niveauDuProfil(utilisateur.profil, action))) {
    redirect("/acces-refuse");
  }
  return utilisateur;
}
