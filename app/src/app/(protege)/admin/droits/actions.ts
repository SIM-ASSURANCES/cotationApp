"use server";

import { revalidatePath } from "next/cache";

import type { EtatFormulaire } from "@/composants/types";
import { enregistrerDroit } from "@/serveur/droits";
import { adresseIpCourante } from "@/serveur/requete";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces, ErreurMetier } from "@/serveur/types";

/** Les listes déroulantes s'appellent « PROFIL|ACTION » ; seuls les droits changés sont écrits (et journalisés). */
export async function enregistrerLesDroits(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const acteur = await exigerUtilisateur();
  const adresseIp = await adresseIpCourante();
  let modifies = 0;
  try {
    for (const [cle, valeur] of donnees.entries()) {
      const [profil, action] = cle.split("|");
      if (!profil || !action || typeof valeur !== "string") {
        continue;
      }
      if (await enregistrerDroit(acteur, { profil, action, niveau: valeur }, adresseIp)) {
        modifies += 1;
      }
    }
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) {
      return { erreur: erreur.message };
    }
    if (erreur instanceof ErreurAcces) {
      return { erreur: "Vous n'avez pas le droit de modifier les droits." };
    }
    throw erreur;
  }
  revalidatePath("/admin/droits");
  return { succes: modifies === 0 ? "Aucun changement." : `${modifies} droit(s) modifié(s) et journalisé(s).` };
}
