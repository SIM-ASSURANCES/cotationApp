import { revalidatePath } from "next/cache";

import type { EtatFormulaire } from "@/composants/types";
import { adresseIpCourante } from "@/serveur/requete";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "@/serveur/types";

/**
 * Exécute une opération au nom de l'utilisateur connecté. Les refus métier et de droits deviennent un
 * message à l'écran ; toute autre erreur remonte (elle est journalisée par le serveur).
 */
export async function executerAction(
  operation: (acteur: UtilisateurCourant, adresseIp: string | null) => Promise<void>,
  succes: string,
  cheminARafraichir: string,
): Promise<EtatFormulaire> {
  const acteur = await exigerUtilisateur();
  try {
    await operation(acteur, await adresseIpCourante());
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) {
      return { erreur: erreur.message };
    }
    if (erreur instanceof ErreurAcces) {
      return { erreur: "Vous n'avez pas le droit d'effectuer cette action." };
    }
    throw erreur;
  }
  revalidatePath(cheminARafraichir);
  return { succes };
}

/** Texte d'un champ de formulaire. */
export const champ = (donnees: FormData, nom: string): string => String(donnees.get(nom) ?? "").trim();

/** Texte d'un champ facultatif : null s'il est vide. */
export const champOuNull = (donnees: FormData, nom: string): string | null => champ(donnees, nom) || null;
