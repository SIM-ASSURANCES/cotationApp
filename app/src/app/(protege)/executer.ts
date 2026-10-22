import { revalidatePath } from "next/cache";

import type { EtatFormulaire } from "@/composants/types";
import { MESSAGE_ERREUR_BASE_GENERIQUE, messagePourErreurDeBase } from "@/serveur/refus-base";
import { adresseIpCourante } from "@/serveur/requete";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "@/serveur/types";

/**
 * Exécute une opération au nom de l'utilisateur connecté. Les refus métier et de droits deviennent un
 * message à l'écran. Une erreur de la base aussi (filet : un cas non prévu par les gardes du serveur ne donne ni erreur 500 ni
 * message technique) : le refus d'un de NOS déclencheurs est montré tel quel, toute autre erreur de base devient un message
 * générique et est journalisée ici. Toute autre erreur remonte (elle est journalisée par le serveur).
 */
/** Message pour une erreur de la base (voir `messagePourErreurDeBase`) ; les erreurs autres que les refus de déclencheurs sont journalisées. */
function messageErreurDeBase(erreur: unknown): string | null {
  const message = messagePourErreurDeBase(erreur);
  if (message === MESSAGE_ERREUR_BASE_GENERIQUE) console.error("[erreur de base]", erreur);
  return message;
}

export async function executerAction(
  operation: (acteur: UtilisateurCourant, adresseIp: string | null) => Promise<void | string[]>,
  /** Message de réussite ; une fonction est appelée après l'opération, quand le message dépend de son issue. */
  succes: string | (() => string),
  cheminARafraichir: string,
): Promise<EtatFormulaire> {
  const acteur = await exigerUtilisateur();
  let details: string[] | void;
  try {
    // Une opération peut renvoyer des remarques à afficher sous le message de réussite.
    details = await operation(acteur, await adresseIpCourante());
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) {
      return { erreur: erreur.message, ...(erreur.details.length ? { details: erreur.details } : {}) };
    }
    if (erreur instanceof ErreurAcces) {
      return { erreur: "Vous n'avez pas le droit d'effectuer cette action." };
    }
    const messageBase = messageErreurDeBase(erreur);
    if (messageBase) return { erreur: messageBase };
    throw erreur;
  }
  revalidatePath(cheminARafraichir);
  return { succes: typeof succes === "function" ? succes() : succes, ...(details?.length ? { details } : {}) };
}

/** Variante qui renvoie la valeur de l'opération (ex. l'identifiant créé) : à utiliser avant une redirection. */
export async function avecMessage<T>(
  operation: (acteur: UtilisateurCourant, adresseIp: string | null) => Promise<T>,
): Promise<{ ok: true; valeur: T } | { ok: false; etat: EtatFormulaire }> {
  const acteur = await exigerUtilisateur();
  try {
    return { ok: true, valeur: await operation(acteur, await adresseIpCourante()) };
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return { ok: false, etat: { erreur: erreur.message, ...(erreur.details.length ? { details: erreur.details } : {}) } };
    if (erreur instanceof ErreurAcces) return { ok: false, etat: { erreur: "Vous n'avez pas le droit d'effectuer cette action." } };
    const messageBase = messageErreurDeBase(erreur);
    if (messageBase) return { ok: false, etat: { erreur: messageBase } };
    throw erreur;
  }
}

/** Texte d'un champ de formulaire. */
export const champ = (donnees: FormData, nom: string): string => String(donnees.get(nom) ?? "").trim();

/** Texte d'un champ facultatif : null s'il est vide. */
export const champOuNull = (donnees: FormData, nom: string): string | null => champ(donnees, nom) || null;
