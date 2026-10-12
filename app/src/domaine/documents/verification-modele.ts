import { schemaAnalyse } from "./analyse";
import { champImiteUneBalise, controlerDepot, type ResultatControle } from "./controles";
import { CHAMPS_FACULTATIFS, estConnu } from "./dictionnaire";
import { estTypeModele, TYPES_MODELE, type TypeModele } from "./modeles";

/**
 * Vérification d'un modèle Word AVANT son dépôt (session 6.1, aide au balisage). Aucune règle nouvelle : on rejoue les mêmes
 * contrôles que le dépôt (`controlerDepot`) et le même dictionnaire (`estConnu`, `CHAMPS_FACULTATIFS`) sur l'analyse du
 * générateur. Appelée par `scripts/controler-modele.mts`, elle-même appelée par `generateur/scripts/verifier_modele.py`, pour
 * que le dictionnaire reste à un seul endroit (celui de l'application).
 */

export type SortieVerification =
  | { ok: true; type: TypeModele; inconnues: { chemin: string; balise: string; emplacement: string }[]; champsWordImitantUneBalise: string[]; facultatifs: readonly string[]; controle: ResultatControle }
  | { ok: false; erreur: string };

export function verifierModele(entree: { type: string; analyse: unknown }): SortieVerification {
  if (!estTypeModele(entree.type)) {
    return { ok: false, erreur: `Type de modèle inconnu « ${entree.type} » : ${TYPES_MODELE.join(", ")}.` };
  }
  const lue = schemaAnalyse.safeParse(entree.analyse);
  if (!lue.success) return { ok: false, erreur: "Analyse illisible : le générateur et l'application ne sont pas de la même version." };
  const analyse = lue.data;
  const emplacement = (e: (typeof analyse.references)[number]["emplacement"]) => `${e.partie}, ${e.tableau !== null ? `tableau ${e.tableau}, ligne ${e.ligne}, colonne ${e.colonne}` : `paragraphe ${e.paragraphe}`}`;
  return {
    ok: true,
    type: entree.type,
    inconnues: analyse.references.filter((r) => !estConnu(r.chemin)).map((r) => ({ chemin: r.chemin, balise: r.balise, emplacement: emplacement(r.emplacement) })),
    champsWordImitantUneBalise: analyse.champs_word.filter((c) => champImiteUneBalise(c.instruction)).map((c) => c.instruction),
    facultatifs: CHAMPS_FACULTATIFS,
    controle: controlerDepot(entree.type, analyse),
  };
}
