import { CHAMPS_TEXTE_COMPLEMENTS, type Beneficiaire, type ContactUrgence, type SouscripteurComplements } from "@/domaine/cotation/saisie";

const champ = (d: FormData, nom: string) => String(d.get(nom) ?? "").trim();
const colonne = (d: FormData, nom: string) => d.getAll(nom).map((v) => String(v).trim());

/**
 * Compléments du souscripteur (dictionnaire §6.3.2) lus dans un formulaire qui les propose : ils sont
 * TOUS présents dans le résultat, vides s'il n'y avait rien à saisir (un champ saisi mais laissé vide
 * s'écrit vide, D15). Aucune validation ici : elle est faite par le service. Un nombre d'enfants illisible
 * devient NaN, refusé ensuite avec un message en français.
 */
export function lireComplementsSouscripteur(d: FormData): Required<SouscripteurComplements> {
  const enfants = champ(d, "souscripteur_nb_enfants");
  return {
    ...(Object.fromEntries(CHAMPS_TEXTE_COMPLEMENTS.map((nom) => [nom, champ(d, `souscripteur_${nom}`)])) as Record<(typeof CHAMPS_TEXTE_COMPLEMENTS)[number], string>),
    date_naissance: champ(d, "souscripteur_date_naissance") as Required<SouscripteurComplements>["date_naissance"],
    nb_enfants: enfants === "" ? null : /^\d+$/.test(enfants) ? Number(enfants) : Number.NaN,
  };
}

/** Bénéficiaires : les lignes entièrement vides sont ignorées ; les numéros d'ordre suivent l'ordre de saisie. */
export function lireBeneficiaires(d: FormData): Beneficiaire[] {
  const [noms, liens, contacts, quotes] = ["benef_nom", "benef_lien", "benef_contact", "benef_quote"].map((n) => colonne(d, n));
  return noms
    .map((nom, i) => ({ nom_prenoms: nom, lien: liens[i] ?? "", contact: contacts[i] ?? "", quote_part: quotes[i] ?? "" }))
    .filter((b) => b.nom_prenoms !== "" || b.lien !== "" || b.contact !== "" || b.quote_part !== "")
    .map((b, i) => ({ ordre: i + 1, ...b }));
}

/** Contacts d'urgence : les lignes entièrement vides sont ignorées. */
export function lireContactsUrgence(d: FormData): ContactUrgence[] {
  const [noms, contacts] = ["urgence_nom", "urgence_contact"].map((n) => colonne(d, n));
  return noms.map((nom, i) => ({ nom_prenoms: nom, contact: contacts[i] ?? "" })).filter((c) => c.nom_prenoms !== "" || c.contact !== "");
}
