"use server";

import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
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
  redirect("/");
}
