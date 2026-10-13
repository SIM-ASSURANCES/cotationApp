/**
 * Adresse IP du client derrière un ou plusieurs proxys inverses (audit du 13/10/2026, constat M1). Règle PURE.
 *
 * `X-Forwarded-For` est une liste « client, proxy1, proxy2… » : chaque proxy AJOUTE à droite l'adresse de celui qui lui a parlé,
 * sans effacer ce que le client a écrit à gauche. Le premier élément est donc choisi par le client (il le change à chaque requête
 * pour échapper à une limite de débit ou salir le journal) ; seuls les éléments ajoutés par NOS proxys sont fiables, en partant
 * de la droite. Avec N proxys de confiance, le client est le N-ième élément en partant de la droite.
 *
 * `X-Real-IP` n'est plus lu : un proxy qui ne l'écrase pas laisse passer celui du client.
 */

export const PROXIES_DE_CONFIANCE_PAR_DEFAUT = 1;
export const PROXIES_DE_CONFIANCE_MAX = 5;

/** Nombre de proxys de confiance (variable PROXIES_DE_CONFIANCE) : entier de 0 à 5 ; absent ou invalide, la valeur par défaut. */
export function proxiesDeConfiance(valeur: string | undefined): number {
  if (valeur === undefined || valeur.trim() === "") return PROXIES_DE_CONFIANCE_PAR_DEFAUT;
  const n = Number(valeur.trim());
  return Number.isInteger(n) && n >= 0 && n <= PROXIES_DE_CONFIANCE_MAX ? n : PROXIES_DE_CONFIANCE_PAR_DEFAUT;
}

/** Vrai si la valeur de PROXIES_DE_CONFIANCE est acceptable (validation au démarrage). */
export const proxiesDeConfianceValide = (valeur: string): boolean => /^[0-5]$/.test(valeur.trim());

/**
 * Adresse du client, ou null si elle est inconnue. Zéro proxy de confiance : l'en-tête n'est pas lu du tout (accès direct à
 * l'application). Liste plus courte que prévu (la requête n'a pas traversé tous les proxys) : l'élément le plus à gauche.
 */
export function adresseDuClient(forwardedFor: string | null | undefined, proxys: number): string | null {
  if (proxys <= 0 || !forwardedFor) return null;
  const adresses = forwardedFor
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "");
  if (adresses.length === 0) return null;
  const adresse = adresses[Math.max(0, adresses.length - proxys)];
  return adresse.slice(0, 64);
}
