import { analyserMontant, montant } from "../calcul/montant";

/**
 * Seuil unique de validation pour tous les produits (décision de la Technique du 20/10/2026).
 * Défaut : 10 000 000 FCFA TTC.
 * Au-delà de ce montant (comparaison stricte, D18), le document passe en « À valider ».
 */

export const CLE_SEUIL_VALIDATION_GLOBAL = "seuil_validation_global";
export const SEUIL_VALIDATION_GLOBAL_DEFAUT = "10000000";

/** Contrôle le seuil de validation saisi : entier positif non nul (FCFA TTC). */
export function problemesSeuilValidationGlobal(valeur: string): string[] {
  const p: string[] = [];
  const texte = valeur.trim();
  if (texte === "") {
    p.push("Le seuil de validation est obligatoire.");
    return p;
  }
  try {
    const m = montant(analyserMontant(texte, { negatif: true }));
    if (m.isNegative() || m.isZero()) {
      p.push("Le seuil de validation doit être un montant strictement positif.");
    }
  } catch (erreur) {
    p.push(`Le seuil de validation n'est pas un montant valide : ${erreur instanceof Error ? erreur.message : ""}`);
  }
  return p;
}
