/** Règles de sécurité des comptes : mots de passe, verrouillage, durée de session. Pures. */

export const MAX_ECHECS_CONSECUTIFS = 5;
export const DUREE_VERROUILLAGE_MINUTES = 15;
export const SESSION_DUREE_MAX_HEURES = 8;
export const MOT_DE_PASSE_LONGUEUR_MIN = 12;
export const MOT_DE_PASSE_LONGUEUR_MAX = 128;

/** Normalise un identifiant de connexion : sans espaces aux bords, en minuscules. */
export function normaliserIdentifiant(identifiant: string): string {
  return identifiant.trim().toLowerCase();
}

/** Identifiant valide : 3 à 64 caractères parmi lettres, chiffres, point, tiret, tiret bas, arobase. */
export function identifiantValide(identifiant: string): boolean {
  return /^[a-z0-9._@-]{3,64}$/.test(identifiant);
}

const MOTS_DE_PASSE_COURANTS = ["motdepasse", "password", "azerty", "qwerty", "123456", "sim assurances", "simassurances"];

/**
 * Règles du mot de passe : longueur d'abord (12 à 128 caractères), pas de mot de passe
 * courant, pas l'identifiant. Renvoie la liste des problèmes (vide si valide).
 */
export function problemesMotDePasse(motDePasse: string, identifiant: string): string[] {
  const problemes: string[] = [];
  if (motDePasse.length < MOT_DE_PASSE_LONGUEUR_MIN) {
    problemes.push(`au moins ${MOT_DE_PASSE_LONGUEUR_MIN} caractères`);
  }
  if (motDePasse.length > MOT_DE_PASSE_LONGUEUR_MAX) {
    problemes.push(`au plus ${MOT_DE_PASSE_LONGUEUR_MAX} caractères`);
  }
  const minuscules = motDePasse.toLowerCase();
  if (identifiant.length >= 3 && minuscules.includes(normaliserIdentifiant(identifiant))) {
    problemes.push("ne doit pas contenir l'identifiant");
  }
  if (MOTS_DE_PASSE_COURANTS.some((courant) => minuscules.includes(courant))) {
    problemes.push("ne doit pas contenir un mot de passe courant");
  }
  if (new Set(motDePasse).size < 5) {
    problemes.push("doit contenir au moins 5 caractères différents");
  }
  return problemes;
}

export type EtatVerrouillage = { echecsConsecutifs: number; verrouilleJusqua: Date | null };

/** Compte verrouillé à cet instant ? */
export function estVerrouille(verrouilleJusqua: Date | null, maintenant: Date): boolean {
  return verrouilleJusqua !== null && verrouilleJusqua.getTime() > maintenant.getTime();
}

/**
 * État du compte après un mot de passe faux : au MAX_ECHECS_CONSECUTIFS-ième échec
 * d'affilée, le compte est verrouillé DUREE_VERROUILLAGE_MINUTES minutes et le compteur repart de zéro.
 */
export function etatApresEchec(echecsAvant: number, maintenant: Date): EtatVerrouillage {
  const echecs = echecsAvant + 1;
  if (echecs >= MAX_ECHECS_CONSECUTIFS) {
    return {
      echecsConsecutifs: 0,
      verrouilleJusqua: new Date(maintenant.getTime() + DUREE_VERROUILLAGE_MINUTES * 60_000),
    };
  }
  return { echecsConsecutifs: echecs, verrouilleJusqua: null };
}
