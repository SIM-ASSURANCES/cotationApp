"use server";

import type { EtatFormulaire } from "@/composants/types";
import { ADRESSE_MOT_DE_PASSE_MODIFIE } from "@/domaine/acces";
import { signOut } from "@/serveur/auth";
import { adresseIpCourante } from "@/serveur/requete";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurMetier } from "@/serveur/types";
import { changerMotDePasse } from "@/serveur/utilisateurs";

export async function changerSonMotDePasse(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const utilisateur = await exigerUtilisateur({ autoriserChangementMotDePasse: true });
  const actuel = String(donnees.get("actuel") ?? "");
  const nouveau = String(donnees.get("nouveau") ?? "");
  if (nouveau !== String(donnees.get("confirmation") ?? "")) {
    return { erreur: "La confirmation ne correspond pas au nouveau mot de passe." };
  }
  try {
    await changerMotDePasse(utilisateur, actuel, nouveau, await adresseIpCourante());
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) {
      return { erreur: erreur.message };
    }
    throw erreur;
  }
  // Le changement ferme la session (obligatoire ou volontaire : une seule règle) : la page « / » n'est jamais rendue dans l'ancienne
  // coquille, et l'ancienne session ne survit pas. Reconnexion avec le nouveau mot de passe.
  await signOut({ redirectTo: ADRESSE_MOT_DE_PASSE_MODIFIE });
  return {};
}
