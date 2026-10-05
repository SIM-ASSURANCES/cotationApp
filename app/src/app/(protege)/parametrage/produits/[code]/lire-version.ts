import { COMPOSANTES, NIVEAUX_ARRONDI, type Composante, type ModeAccessoire, type NiveauArrondi } from "@/domaine/calcul/calcul";
import { SENS_ARRONDI, type Precision, type SensArrondi } from "@/domaine/calcul/montant";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

const champ = (donnees: FormData, nom: string): string => String(donnees.get(nom) ?? "").trim();
const champOuNull = (donnees: FormData, nom: string): string | null => champ(donnees, nom) || null;

/** Liste de textes séparés par des points-virgules ou des espaces (la virgule reste le séparateur décimal). */
const liste = (texte: string | null): string[] | null => (texte ? texte.split(/[;\s]+/).filter(Boolean) : null);

/** Valeur parmi celles autorisées ; sinon une valeur volontairement invalide, que la validation refusera avec un message. */
const parmi = <T extends string>(valeur: string, autorisees: readonly T[]): T =>
  (autorisees as readonly string[]).includes(valeur) ? (valeur as T) : ("INVALIDE" as T);

/**
 * Lit le formulaire « nouvelle version » (texte saisi) et en fait une VersionSaisie. Aucune
 * validation ici : elle est faite par problemesVersion() (domaine) puis par le service. Les montants
 * restent des TEXTES ; seuls les compteurs (tranches, jours) deviennent des nombres entiers.
 */
export function lireVersion(donnees: FormData): VersionSaisie {
  const colonne = (nom: string) => donnees.getAll(nom).map(String);
  const [libelles, taux, primes, modes, valeurs] = ["formule_libelle", "formule_taux", "formule_prime", "formule_mode", "formule_valeur"].map(colonne);
  return {
    dateEffet: champ(donnees, "dateEffet"),
    arrondi: {
      precision: Number(champ(donnees, "precision")) as Precision, // contrôlé par la validation (1, 10, 100 ou 1 000)
      sens: parmi<SensArrondi>(champ(donnees, "sens"), SENS_ARRONDI),
      niveau: parmi<NiveauArrondi>(champ(donnees, "niveau"), NIVEAUX_ARRONDI),
      composanteAbsorbante: parmi<Composante>(champ(donnees, "composante"), COMPOSANTES),
    },
    prorata: { actif: donnees.get("prorataActif") === "on", primeMinimale: champOuNull(donnees, "primeMinimale") },
    fractionnement: {
      tranchesMax: Number(champ(donnees, "tranchesMax")),
      repartitionPourcent: liste(champOuNull(donnees, "repartition")),
      decalagesMois: liste(champOuNull(donnees, "decalages"))?.map(Number) ?? null,
      frais: champ(donnees, "frais") || "0",
    },
    cotation: { validiteJours: Number(champ(donnees, "validiteJours")), formulesMax: Number(champ(donnees, "formulesMax")) },
    seuilValidationTtc: champOuNull(donnees, "seuil"),
    formules: colonne("formule_code").map((code, i) => ({
      code: code.trim().toUpperCase(),
      libelle: libelles[i] ?? "",
      tauxCouverture: (taux[i] ?? "").trim() || null,
      primeUnitaire: (primes[i] ?? "").trim(),
      accessoireMode: (modes[i] ?? "AUCUN") as ModeAccessoire,
      accessoireValeur: (valeurs[i] ?? "0").trim() || "0",
    })),
  };
}
