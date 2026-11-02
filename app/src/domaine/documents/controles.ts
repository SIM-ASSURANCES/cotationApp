import { decrireEmplacement, type Analyse, type Emplacement } from "./analyse";
import { RACINES, estConnu } from "./dictionnaire";
import { BALISES_FIXES, REGLES, type TypeModele } from "./modeles";

/**
 * Contrôles au dépôt d'un modèle (CDC §6.7). Règles pures, appliquées à l'analyse du générateur.
 *
 * Rejet (le dépôt est refusé, rien n'est enregistré) :
 *   1. fichier qui n'est pas un .docx valide ;
 *   2. balise hors dictionnaire (T9), avec son emplacement ;
 *   3. blocs if/for mal fermés, balise mal écrite, coupée par Word, filtre inconnu, calcul… ;
 *   4. champ Word (Ctrl+F9) qui imite une balise ; modèle généré sans aucune balise ;
 *      CG/CS avec d'autres balises que leur visa ; champ, filtre ou mention obligatoire absent (CP, facture…).
 * Avertissement (le dépôt est accepté) : police absente du générateur, marqueur hérité.
 */

export type Constat = { message: string; emplacement: string | null };
export type ResultatControle = { rejets: Constat[]; avertissements: Constat[] };

const constat = (message: string, emplacement: Emplacement | null): Constat => ({
  message,
  emplacement: emplacement ? decrireEmplacement(emplacement) : null,
});

/** Champs Word légitimes : numéro de page, date, sommaire, renvois… (instruction en majuscules). */
const CHAMPS_WORD_LEGITIMES = /^(PAGE|NUMPAGES|SECTIONPAGES|SECTION|DATE|TIME|CREATEDATE|SAVEDATE|PRINTDATE|HYPERLINK|TOC|TC|REF|PAGEREF|NOTEREF|SEQ|STYLEREF|SYMBOL|INCLUDEPICTURE|FORMTEXT|FORMCHECKBOX|FORMDROPDOWN|FILENAME|AUTHOR|TITLE|EQ|LISTNUM|ADVANCE|QUOTE|XE|INDEX|IF|=)\b/;

/** Une instruction de champ Word ressemble-t-elle à une balise saisie au mauvais endroit ? */
export function champImiteUneBalise(instruction: string): boolean {
  const texte = instruction.replace(/[{}]/g, " ").replace(/\\\*\s*MERGEFORMAT/gi, "").trim();
  if (texte === "" || CHAMPS_WORD_LEGITIMES.test(texte)) return false;
  const nom = texte.replace(/^MERGEFIELD\s+/i, "").replace(/^["«»\s]+|["«»\s]+$/g, "").split(/[\s|]/)[0];
  if (/^MERGEFIELD\b/i.test(texte)) return true; // champ de publipostage : jamais une balise valide ici
  return /^[a-z_][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(nom) || RACINES.has(nom.split(".")[0]);
}

/** Marqueurs hérités des anciens modèles (CDC §6.7, annexe A). */
const MARQUEURS: { motif: RegExp; libelle: string }[] = [
  { motif: /\bX{3,}\b/, libelle: "« XXX »" },
  { motif: /\b00\/00\/(00|0000)\b/, libelle: "« 00/00/00 »" },
  { motif: /\[\s*à préciser\s*\]/i, libelle: "« [à préciser] »" },
  { motif: /variable système/i, libelle: "« Variable système »" },
  { motif: /nom de la compagnie/i, libelle: "« Nom de la compagnie »" },
  { motif: /_{3,}/, libelle: "suite de « ___ »" },
];

export function controlerDepot(type: TypeModele, analyse: Analyse, options: { blocNom?: string | null } = {}): ResultatControle {
  const rejets: Constat[] = [];
  const avertissements: Constat[] = [];
  const regle = REGLES[type];

  if (!analyse.docx_valide) {
    return { rejets: [constat(analyse.erreur ?? "Le fichier n'est pas un document Word .docx valide.", null)], avertissements };
  }

  for (const probleme of analyse.problemes) {
    rejets.push(constat(probleme.message.charAt(0).toUpperCase() + probleme.message.slice(1) + ".", probleme.emplacement));
  }

  for (const reference of analyse.references) {
    if (!estConnu(reference.chemin)) {
      rejets.push(constat(`Balise inconnue « ${reference.chemin} » dans ${reference.balise} : ce nom n'est pas dans le dictionnaire des champs.`, reference.emplacement));
    } else if (regle.fixe && !(BALISES_FIXES[type as "CG" | "CS"] as readonly string[]).includes(reference.chemin)) {
      rejets.push(
        constat(
          `${regle.libelle} : seules les balises du visa sont permises (${BALISES_FIXES[type as "CG" | "CS"].join(", ")}), pas « ${reference.chemin} ».`,
          reference.emplacement,
        ),
      );
    }
  }

  // `garantie.*` (D61) : la ligne courante d'une garantie, vue du seul sous-modèle bloc("garanties", g.code). Ailleurs la donnée est absente à la génération :
  // mieux vaut refuser au dépôt. `blocNom` inconnu (vérification hors dépôt) : tout sous-modèle est accepté.
  const garantieVisible = type === "SOUS_MODELE" && (options.blocNom === undefined || options.blocNom === "garanties");
  if (!garantieVisible) {
    for (const reference of analyse.references) {
      if (reference.chemin === "garantie" || reference.chemin.startsWith("garantie.")) {
        rejets.push(constat(`Balise « ${reference.chemin} » dans ${reference.balise} : « garantie » n'existe que dans un sous-modèle de nom « garanties », inséré par bloc("garanties", g.code) ; ailleurs, parcourez garanties_souscrites (par exemple {%p for g in garanties_souscrites %}).`, reference.emplacement));
      }
    }
  }

  for (const champ of analyse.champs_word) {
    if (champImiteUneBalise(champ.instruction)) {
      rejets.push(constat(`Balise saisie comme champ Word (« ${champ.instruction} ») : retapez-la au clavier, avec des accolades ordinaires.`, champ.emplacement));
    }
  }

  if (type === "SOUS_MODELE") {
    for (const bloc of analyse.blocs) rejets.push(constat("Un sous-modèle ne peut pas appeler bloc() à son tour.", bloc.emplacement));
  }
  if (regle.fixe && analyse.blocs.length > 0) {
    rejets.push(constat(`${regle.libelle} : bloc() n'est pas permis.`, analyse.blocs[0].emplacement));
  }

  if (regle.genere && analyse.nombre_balises === 0) {
    rejets.push(
      constat(
        `Aucune balise : un modèle de ${regle.libelle.toLowerCase()} est rempli à chaque génération et doit contenir des balises. Un document fixe se dépose comme conditions générales ou spéciales.`,
        null,
      ),
    );
  }

  const utilises = new Set(analyse.references.map((r) => r.chemin));
  for (const obligatoire of regle.obligatoires) {
    const unDe: readonly string[] = typeof obligatoire === "string" ? [obligatoire] : obligatoire;
    if (!unDe.some((chemin) => utilises.has(chemin))) {
      const attendu = unDe.map((chemin) => `{{ ${chemin} }}`).join(" ou ");
      rejets.push(constat(`Champ obligatoire pour un modèle de ${regle.libelle.toLowerCase()} absent : ${attendu}.`, null));
    }
  }

  for (const filtre of regle.filtres ?? []) {
    if (!analyse.filtres.includes(filtre)) rejets.push(constat(`Filtre obligatoire pour un modèle de ${regle.libelle.toLowerCase()} absent : « ${filtre} » (par exemple {{ prime.ttc | ${filtre} }}).`, null));
  }
  for (const { motif, libelle } of regle.textes ?? []) {
    if (!analyse.textes.some((t) => motif.test(t.texte))) rejets.push(constat(`Mention obligatoire pour un modèle de ${regle.libelle.toLowerCase()} absente : ${libelle}.`, null));
  }

  if (analyse.polices_absentes === null) {
    avertissements.push(constat("Les polices installées sur le générateur n'ont pas pu être vérifiées.", null));
  } else if (analyse.polices_absentes.length > 0) {
    avertissements.push(
      constat(
        `Police(s) absente(s) du générateur : ${analyse.polices_absentes.join(", ")}. LibreOffice en prendra une autre : la mise en page peut différer de Word (voir generateur/polices/README.md).`,
        null,
      ),
    );
  }

  for (const { texte, emplacement } of analyse.textes) {
    for (const marqueur of MARQUEURS) {
      if (marqueur.motif.test(texte)) avertissements.push(constat(`Marqueur hérité ${marqueur.libelle} : à remplacer par une balise ou à supprimer.`, emplacement));
    }
  }

  return { rejets, avertissements };
}

/** Clé de `bloc("garanties", g.code)` dans une boucle sur `garanties_souscrites` : le code de la garantie courante (D61). */
export const CLE_BLOC_DE_GARANTIE = "garanties_souscrites[].code";

/**
 * Sous-modèles de garanties d'un produit au barème (D61), en avertissement (le barème et les modèles ont chacun leur date d'effet et leur publication).
 *  - Un modèle (CP, cotation…) qui appelle `bloc("garanties", g.code)` : chaque garantie du barème publié qui n'a pas de sous-modèle PUBLIÉ est nommée, avec la clé attendue.
 *  - Un sous-modèle de nom « garanties » dont la clé n'est pas le code d'une garantie du barème : signalé (faute de frappe, garantie renommée).
 * `codes` : codes des garanties des barèmes publiés du produit (vide : sans barème, aucun contrôle) ; `publiees` : clés des sous-modèles « garanties » publiés
 * pour le produit (les siens, puis les communs).
 */
export function avertissementsDeGaranties(
  type: TypeModele,
  analyse: Analyse,
  codes: ReadonlySet<string>,
  publiees: ReadonlySet<string>,
  sousModele: { blocNom: string | null; blocCle: string | null } | null = null,
): Constat[] {
  if (codes.size === 0) return [];
  const liste = [...codes].sort().join(", ");
  if (type === "SOUS_MODELE") {
    if (sousModele?.blocNom !== "garanties" || !sousModele.blocCle || codes.has(sousModele.blocCle)) return [];
    return [constat(`Sous-modèle « garanties » de clé « ${sousModele.blocCle} » : ce n'est le code d'aucune garantie du barème publié de ce produit (garanties : ${liste}). Il ne sera inséré que pour une garantie de ce code.`, null)];
  }
  const appel = analyse.blocs.find((b) => b.nom === "garanties" && b.cle === CLE_BLOC_DE_GARANTIE);
  if (!appel) return [];
  return [...codes]
    .sort()
    .filter((code) => !publiees.has(code))
    .map((code) => constat(`Le modèle appelle bloc("garanties", g.code) : la garantie « ${code} » du barème publié n'a pas de sous-modèle publié (nom du bloc : garanties, clé : ${code}). Tant qu'il n'est pas déposé et publié, les conditions particulières d'une cotation qui la souscrit ne s'émettent pas.`, appel.emplacement));
}

/**
 * Balises `risque.<code>` et `risque_code.<code>` qu'un produit au barème ne connaît pas (B6b, D52) : le code n'est pas un champ de son barème publié. Un
 * avertissement et non un rejet : le barème et le modèle ont leurs propres dates d'effet, et un champ peut arriver avec une version
 * publiée plus tard. `codes` : champs de tous les barèmes publiés du produit (jamais vide : sans barème, le contrôle ne s'applique pas).
 */
export function avertissementsRisque(analyse: Analyse, codes: ReadonlySet<string>): Constat[] {
  const vus = new Set<string>();
  const avertissements: Constat[] = [];
  for (const reference of analyse.references) {
    const [racine, code] = reference.chemin.split(".");
    if ((racine !== "risque" && racine !== "risque_code") || code === undefined || codes.has(code) || vus.has(reference.chemin)) continue;
    vus.add(reference.chemin);
    avertissements.push(constat(`Balise « ${reference.chemin} » : « ${code} » n'est pas un champ du barème publié de ce produit (champs : ${[...codes].sort().join(", ")}). Elle ne sera pas renseignée.`, reference.emplacement));
  }
  return avertissements;
}
