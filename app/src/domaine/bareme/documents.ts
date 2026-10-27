import { Contexte, texteDeValeur } from "./contexte";
import type { Bareme, Saisie } from "./schema";

/**
 * Balises `risque.<code>` d'un produit au barème (B6b, D52) : chaque champ du barème devient une balise. La valeur est celle de la saisie
 * figée avec la cotation (code de la liste, OUI / NON, montant en décimal, choix multiples séparés par des virgules). Un champ qui ne
 * s'applique pas à la saisie (condition d'affichage) ou facultatif et laissé vide vaut « » : la balise existe toujours, vide.
 * Le barème sert à connaître les champs et leurs conditions ; aucun tarif n'est lu.
 */
export function risqueDuBareme(bareme: Bareme, saisie: Saisie): Record<string, string> {
  const contexte = new Contexte(bareme, saisie);
  return Object.fromEntries(
    bareme.champs.map((c) => {
      const lecture = contexte.lire(c.code);
      const v = lecture.valeur;
      return [c.code, v === undefined ? "" : Array.isArray(v) ? v.join(", ") : texteDeValeur(v)];
    }),
  );
}

/** Codes des champs d'un barème : les seuls `risque.<code>` que ses modèles peuvent utiliser. */
export const codesRisqueDuBareme = (bareme: Bareme): string[] => bareme.champs.map((c) => c.code);
