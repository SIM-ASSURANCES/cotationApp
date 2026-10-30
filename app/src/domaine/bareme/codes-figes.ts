import { jsonCanonique } from "./canonique";
import { codeValeur } from "./contexte";
import { codesRisqueDuBareme } from "./documents";
import type { Bareme, Champ } from "./schema";

/**
 * Codes figés et balises des modèles (session B5, D59, ajouts 9 et 10). Règles PURES ; le serveur les applique à l'enregistrement d'un
 * brouillon (renommage) et à la publication (balise sans clé).
 */

// ---------------------------------------------------------------- 10. Renommer un code publié

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
const ensembleDeValeurs = (c: Champ): string => (c.valeurs ?? []).map(codeValeur).sort().join("\u0001");

const sansCode = (c: Champ): string => jsonCanonique({ ...c, code: "" });

/**
 * Deux champs sont « le même » quand le type est le même et que : le libellé est le même, ou les listes proposent exactement les mêmes valeurs
 * (au moins deux), ou tout le reste est identique (seul le code diffère : c'est un renommage, par définition).
 */
function memeChamp(a: Champ, b: Champ): boolean {
  if (a.type !== b.type) return false;
  if (a.libelle !== undefined && b.libelle !== undefined && sansAccent(a.libelle) !== "" && sansAccent(a.libelle) === sansAccent(b.libelle)) return true;
  if ((a.type === "LISTE" || a.type === "CHOIX_MULTIPLES") && (a.valeurs ?? []).length >= 2 && ensembleDeValeurs(a) === ensembleDeValeurs(b)) return true;
  return sansCode(a) === sansCode(b);
}

/**
 * Renommages d'un code publié, reconnus dans un document : le serveur reçoit un document ENTIER et ne voit pas le geste de l'écran. Un
 * champ (ou une valeur intermédiaire) du barème publié d'origine dont le code a disparu, alors qu'un élément NOUVEAU du même genre le
 * remplace — même type et même libellé, ou mêmes valeurs de liste, ou tout le reste identique, pour un champ ; même calcul pour une valeur intermédiaire — est un
 * renommage : refusé. Supprimer sans remplacer reste permis (la publication contrôle alors les balises des modèles).
 */
export function renommagesInterdits(origine: Bareme, nouveau: Bareme): string[] {
  const codesOrigine = new Set([...origine.champs.map((c) => c.code), ...origine.intermediaires.map((i) => i.code)]);
  const codesNouveau = new Set([...nouveau.champs.map((c) => c.code), ...nouveau.intermediaires.map((i) => i.code)]);
  const messages: string[] = [];
  const message = (genre: string, ancien: string, remplacant: string) =>
    `Le code du ${genre} « ${ancien} » ne peut pas changer : il figure dans le barème publié dont ce brouillon est issu (ses balises risque.${ancien} et ses cotations le citent). « ${remplacant} » en est le renommage. Rendez-lui son code « ${ancien} », ou supprimez le ${genre} sans le recréer.`;

  const champsAjoutes = nouveau.champs.filter((c) => !codesOrigine.has(c.code));
  const prises = new Set<string>();
  for (const ancien of origine.champs.filter((c) => !codesNouveau.has(c.code))) {
    const remplacant = champsAjoutes.find((n) => !prises.has(n.code) && memeChamp(ancien, n));
    if (remplacant) {
      prises.add(remplacant.code);
      messages.push(message("champ", ancien.code, remplacant.code));
    }
  }
  const intermediairesAjoutes = nouveau.intermediaires.filter((i) => !codesOrigine.has(i.code));
  for (const ancien of origine.intermediaires.filter((i) => !codesNouveau.has(i.code))) {
    const remplacant = intermediairesAjoutes.find((n) => !prises.has(n.code) && jsonCanonique(n.op) === jsonCanonique(ancien.op));
    if (remplacant) {
      prises.add(remplacant.code);
      messages.push(message("valeur intermédiaire", ancien.code, remplacant.code));
    }
  }
  return messages;
}

// ---------------------------------------------------------------- 9. Balises des modèles publiés

/** Une balise de risque citée par un modèle : `risque.<code>` ou `risque_code.<code>`. */
export type BaliseRisque = { chemin: string; code: string };

/** Les balises `risque.*` et `risque_code.*` parmi les chemins lus dans un modèle (analyse du dépôt). */
export function balisesRisqueDeLAnalyse(chemins: readonly string[]): BaliseRisque[] {
  const vues = new Set<string>();
  const balises: BaliseRisque[] = [];
  for (const chemin of chemins) {
    const [racine, code] = chemin.split(".");
    if ((racine !== "risque" && racine !== "risque_code") || !code || vues.has(chemin)) continue;
    vues.add(chemin);
    balises.push({ chemin, code });
  }
  return balises;
}

export type ModelePublie = { description: string; chemins: readonly string[] };

/**
 * Balises citées par des modèles publiés en vigueur qui n'ont pas de clé dans le nouveau barème. La liste des clés est LA MÊME que celle
 * de l'émission et de l'aperçu (`codesRisqueDuBareme`) : champs, attributs tarifaires, valeurs intermédiaires.
 */
export function balisesSansCle(modeles: readonly ModelePublie[], bareme: Bareme): string[] {
  const cles = new Set(codesRisqueDuBareme(bareme));
  return modeles.flatMap((m) => balisesRisqueDeLAnalyse(m.chemins).filter((b) => !cles.has(b.code)).map((b) => `${m.description} cite ${b.chemin}, absent du barème`));
}
