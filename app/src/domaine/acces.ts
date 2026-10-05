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
