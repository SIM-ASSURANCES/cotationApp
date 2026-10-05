"use server";

import { AuthError } from "next-auth";

import { destinationSure } from "@/domaine/acces";
import type { EtatFormulaire } from "@/composants/types";
import { signIn } from "@/serveur/auth";

export async function connecter(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  try {
    await signIn("credentials", {
      identifiant: donnees.get("identifiant"),
      motDePasse: donnees.get("motDePasse"),
      redirectTo: destinationSure(String(donnees.get("destination") ?? "")),
    });
  } catch (erreur) {
    if (erreur instanceof AuthError) {
      // Message unique : on ne dit jamais si c'est l'identifiant, le mot de passe ou le verrouillage.
      return {
        erreur: "Identifiant ou mot de passe incorrect, ou compte temporairement verrouillé.",
      };
    }
    throw erreur; // dont la redirection après une connexion réussie
  }
  return {};
}
