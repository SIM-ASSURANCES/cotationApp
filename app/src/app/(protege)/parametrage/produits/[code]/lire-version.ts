import { COMPOSANTES, NIVEAUX_ARRONDI, type Composante, type ModeAccessoire, type NiveauArrondi } from "@/domaine/calcul/calcul";
import { SENS_ARRONDI, normaliserMontantSaisi, type Precision, type SensArrondi } from "@/domaine/calcul/montant";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

const champ = (donnees: FormData, nom: string): string => String(donnees.get(nom) ?? "").trim();
const champOuNull = (donnees: FormData, nom: string): string | null => champ(donnees, nom) || null;
/** Montant saisi : passe par l'analyseur unique (« 93 581,33 » → « 93581.33 »). */
const m = (texte: string): string => normaliserMontantSaisi(texte);
const mOuNull = (texte: string | null): string | null => (texte === null ? null : m(texte));

/** Liste de textes séparés par des points-virgules ou des espaces (la virgule reste le séparateur décimal). */
const liste = (texte: string | null): string[] | null => (texte ? texte.split(/[;\s]+/).filter(Boolean) : null);

/** Valeur parmi celles autorisées ; sinon une valeur volontairement invalide, que la validation refusera avec un message. */
const parmi = <T extends string>(valeur: string, autorisees: readonly T[]): T =>
  (autorisees as readonly string[]).includes(valeur) ? (valeur as T) : ("INVALIDE" as T);

/**
 * Lit le formulaire « nouvelle version » (texte saisi) et en fait une VersionSaisie. Aucune
 * validation ici : elle est faite par problemesVersion() (domaine) puis par le service. Les montants
 * restent des TEXTES, mis en écriture canonique par l'analyseur unique quand ils sont lisibles ; seuls
 * les compteurs (tranches, jours) deviennent des nombres entiers.
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
    prorata: { actif: donnees.get("prorataActif") === "on", primeMinimale: mOuNull(champOuNull(donnees, "primeMinimale")) },
    fractionnement: {
      tranchesMax: Number(champ(donnees, "tranchesMax")),
      repartitionPourcent: liste(champOuNull(donnees, "repartition"))?.map(m) ?? null,
      decalagesMois: liste(champOuNull(donnees, "decalages"))?.map(Number) ?? null,
      frais: m(champ(donnees, "frais") || "0"),
    },
    cotation: { validiteMois: Number(champ(donnees, "validiteMois")), formulesMax: Number(champ(donnees, "formulesMax")) },
    seuilValidationTtc: mOuNull(champOuNull(donnees, "seuil")),
    references: {
      cgModeleCode: champOuNull(donnees, "cgModeleCode")?.toUpperCase() ?? null,
      cgVisa: champOuNull(donnees, "cgVisa"),
      csModeleCode: champOuNull(donnees, "csModeleCode")?.toUpperCase() ?? null,
      csVisa: champOuNull(donnees, "csVisa"),
    },
    formules: colonne("formule_code").map((code, i) => ({
      code: code.trim().toUpperCase(),
      libelle: libelles[i] ?? "",
      tauxCouverture: mOuNull((taux[i] ?? "").trim() || null),
      primeUnitaire: m(primes[i] ?? ""),
      accessoireMode: (modes[i] ?? "AUCUN") as ModeAccessoire,
      accessoireValeur: m((valeurs[i] ?? "0").trim() || "0"),
    })),
  };
}
