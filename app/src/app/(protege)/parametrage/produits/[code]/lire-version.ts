import { NIVEAUX_ARRONDI, type ModeAccessoire, type NiveauArrondi } from "@/domaine/calcul/calcul";
import { SENS_ARRONDI, normaliserMontantSaisi, type Precision, type SensArrondi } from "@/domaine/calcul/montant";
import { MODES_TARIFICATION, type GarantieParametree, type ModeTarification, type VersionSaisie } from "@/domaine/calcul/parametrage";

const champ = (donnees: FormData, nom: string): string => String(donnees.get(nom) ?? "").trim();
const champOuNull = (donnees: FormData, nom: string): string | null => champ(donnees, nom) || null;
/** Montant saisi : passe par l'analyseur unique (« 93 581,33 » → « 93581.33 »). */
const m = (texte: string): string => normaliserMontantSaisi(texte);
const mOuNull = (texte: string | null): string | null => (texte === null ? null : m(texte));

/** Liste de textes séparés par des points-virgules ou des espaces (la virgule reste le séparateur décimal). */
const liste = (texte: string | null): string[] | null => (texte ? texte.split(/[;\s]+/).filter(Boolean) : null);

/** Âge limite saisi : vide = pas de limite ; un texte non entier devient NaN, que la validation refuse avec un message. */
const age = (texte: string | undefined): number | null => ((texte ?? "").trim() === "" ? null : Number((texte ?? "").trim()));

/** Valeur parmi celles autorisées ; sinon une valeur volontairement invalide, que la validation refusera avec un message. */
const parmi = <T extends string>(valeur: string, autorisees: readonly T[]): T =>
  (autorisees as readonly string[]).includes(valeur) ? (valeur as T) : ("INVALIDE" as T);

/**
 * Garanties du produit (session 6.2b, D37) : une par ligne, « Libellé [; BRANCHE [; MONTANT_GARANTI [; ACCESSOIRES]]] »
 * (catégorie de taxe proposée, montant garanti par défaut facultatif, accessoires par défaut facultatifs).
 * Les lignes vides sont ignorées ; le contrôle (doublons, code de branche, montants >= 0) est fait par la validation du domaine.
 */
export function lireGaranties(texte: string): GarantieParametree[] {
  return texte
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== "")
    .map((ligne) => {
      const [libelle, branche, montantGaranti, accessoires] = ligne.split(";").map((x) => x.trim());
      return {
        libelle,
        branche: branche ? branche.toUpperCase() : null,
        ...(montantGaranti ? { montantGaranti: m(montantGaranti) } : {}),
        ...(accessoires ? { accessoires: m(accessoires) } : {}),
      };
    });
}

/**
 * Lit le formulaire « nouvelle version » (texte saisi) et en fait une VersionSaisie. Aucune
 * validation ici : elle est faite par problemesVersion() (domaine) puis par le service. Les montants
 * restent des TEXTES, mis en écriture canonique par l'analyseur unique quand ils sont lisibles ; seuls
 * les compteurs (tranches, jours) deviennent des nombres entiers.
 */
export function lireVersion(donnees: FormData): VersionSaisie {
  const colonne = (nom: string) => donnees.getAll(nom).map(String);
  const [libelles, taux, primes, modes, valeurs, agesMin, agesMax] = ["formule_libelle", "formule_taux", "formule_prime", "formule_mode", "formule_valeur", "formule_age_min", "formule_age_max"].map(colonne);
  const vide = (v: string | undefined) => (v ?? "").trim() === "";
  const ligneVide = (i: number) =>
    vide(colonne("formule_code")[i]) && vide(libelles[i]) && vide(taux[i]) && vide(primes[i]) && (modes[i] ?? "AUCUN") === "AUCUN" && ["", "0"].includes((valeurs[i] ?? "").trim()) && vide(agesMin[i]) && vide(agesMax[i]);
  return {
    dateEffet: champ(donnees, "dateEffet"),
    arrondi: {
      precision: Number(champ(donnees, "precision")) as Precision, // contrôlé par la validation (1, 10, 100 ou 1 000)
      sens: parmi<SensArrondi>(champ(donnees, "sens"), SENS_ARRONDI),
      niveau: parmi<NiveauArrondi>(champ(donnees, "niveau"), NIVEAUX_ARRONDI),
      // Réglage sans effet depuis le moteur v2 (TTC = somme des arrondis, D18/H4) : plus saisi, valeur fixe.
      composanteAbsorbante: "TAXE",
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
    // Champ absent : FORMULE (le comportement d'avant la 6.2a) ; valeur inconnue : refusée avec un message par la validation.
    modeTarification: parmi<ModeTarification>(champ(donnees, "modeTarification") || "FORMULE", MODES_TARIFICATION),
    // Session 6.2b : liste des garanties du produit (mode par garanties) ; la case « saisie libre » est cochée par défaut, et absente d'un formulaire d'avant.
    garanties: lireGaranties(champ(donnees, "garanties")),
    garantiesSaisieLibre: donnees.has("garantiesPresentes") ? donnees.get("garantiesSaisieLibre") === "on" : true,
    references: {
      cgModeleCode: champOuNull(donnees, "cgModeleCode")?.toUpperCase() ?? null,
      cgVisa: champOuNull(donnees, "cgVisa"),
      csModeleCode: champOuNull(donnees, "csModeleCode")?.toUpperCase() ?? null,
      csVisa: champOuNull(donnees, "csVisa"),
    },
    // Une ligne de formule entièrement vide (la ligne affichée par défaut) est ignorée : en mode par garanties (6.2b), aucune formule n'est
    // nécessaire ; en mode par formule, la validation exige au moins une formule.
    formules: colonne("formule_code")
      .map((code, i) => i)
      .filter((i) => !ligneVide(i))
      .map((i) => ({
        code: colonne("formule_code")[i].trim().toUpperCase(),
        libelle: libelles[i] ?? "",
        tauxCouverture: mOuNull((taux[i] ?? "").trim() || null),
        primeUnitaire: m(primes[i] ?? ""),
        accessoireMode: (modes[i] ?? "AUCUN") as ModeAccessoire,
        accessoireValeur: m((valeurs[i] ?? "0").trim() || "0"),
        ageMin: age(agesMin[i]),
        ageMax: age(agesMax[i]),
      })),
  };
}
