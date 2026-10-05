"use server";

import { journaliser } from "@/serveur/audit";
import { signOut } from "@/serveur/auth";
import { adresseIpCourante } from "@/serveur/requete";
import { obtenirUtilisateurCourant } from "@/serveur/session";

export async function deconnecter(): Promise<void> {
  const utilisateur = await obtenirUtilisateurCourant();
  if (utilisateur) {
    await journaliser({
      acteur: { id: utilisateur.id, identifiant: utilisateur.identifiant },
      action: "DECONNEXION",
      objetType: "utilisateur",
      objetId: utilisateur.id,
      adresseIp: await adresseIpCourante(),
    });
  }
  await signOut({ redirectTo: "/connexion" });
}
