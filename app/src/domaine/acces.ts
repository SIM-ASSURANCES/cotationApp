/**
 * Routes accessibles SANS connexion (CDC §14.1 et plan de la phase 0). Tout le reste exige
 * une session : en cas d'oubli, la route est protégée.
 *   - /connexion et /api/auth/* : la connexion elle-même ;
 *   - /api/sante : contrôle de supervision, sans donnée sensible ;
 *   - /verif/{token} : page publique de vérification d'un QR code (à venir, phase 3).
 */
export function estRoutePublique(chemin: string): boolean {
  const propre = chemin.length > 1 ? chemin.replace(/\/+$/, "") : chemin;
  return (
    propre === "/connexion" ||
    propre === "/api/sante" ||
    propre === "/api/auth" ||
    propre.startsWith("/api/auth/") ||
    propre.startsWith("/verif/")
  );
}

/**
 * Après un changement de mot de passe (obligatoire ou volontaire), la session est fermée et l'utilisateur revient sur la page de
 * connexion avec ce paramètre. Un SEUL message est possible, jamais un texte venu de l'adresse.
 */
export const PARAMETRE_MOT_DE_PASSE_MODIFIE = "motdepasse";
export const VALEUR_MOT_DE_PASSE_MODIFIE = "modifie";
export const ADRESSE_MOT_DE_PASSE_MODIFIE = `/connexion?${PARAMETRE_MOT_DE_PASSE_MODIFIE}=${VALEUR_MOT_DE_PASSE_MODIFIE}`;
export const MESSAGE_MOT_DE_PASSE_MODIFIE = "Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.";

/** Message de succès de la page de connexion pour la valeur du paramètre, ou null. */
export function messageDeConnexion(valeur: string | string[] | undefined): string | null {
  return valeur === VALEUR_MOT_DE_PASSE_MODIFIE ? MESSAGE_MOT_DE_PASSE_MODIFIE : null;
}

/** Adresse de retour acceptée après connexion : un chemin interne uniquement (anti redirection ouverte). */
export function destinationSure(destination: string | null | undefined): string {
  if (!destination || !destination.startsWith("/") || destination.startsWith("//") || destination.includes("\\")) {
    return "/";
  }
  return destination;
}

/**
 * Page de retour après connexion, à partir du paramètre callbackUrl d'Auth.js (souvent une URL
 * complète) : seul le chemin interne est conservé, l'origine est ignorée.
 */
export function cheminDeRetour(callbackUrl: string | null | undefined): string {
  if (!callbackUrl) {
    return "/";
  }
  try {
    const url = new URL(callbackUrl, "http://interne.invalide");
    return destinationSure(url.pathname + url.search);
  } catch {
    return "/";
  }
}
