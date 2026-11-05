/**
 * Calcul automatique d'une cotation par formules (D63) : ce que l'écran regarde pour décider D'ENVOYER la saisie au serveur. Rien ici ne
 * calcule un montant (le serveur est la seule source, D4) ni ne juge une règle métier : seulement « la saisie est-elle assez complète
 * pour qu'un calcul ait un sens ? » et « ce champ-là change-t-il le calcul ? ». Fonctions pures.
 */

/** Valeurs lues dans le formulaire (texte brut, jamais interprété). */
export type SaisieAEvaluer = { typeContrat: string; dateEffet: string; dateEcheance: string; effectifs: string[] };

/**
 * Libellés de ce qui manque pour calculer : le type de contrat (il détermine le taux de taxe), les deux dates et l'effectif d'au moins une
 * formule. Le calcul ne part que si la liste est vide ; sinon l'écran dit « Complétez : … » sans rien envoyer.
 */
export function champsManquantsFormules(saisie: SaisieAEvaluer): string[] {
  const manquants: string[] = [];
  if (saisie.typeContrat.trim() === "") manquants.push("Type de contrat");
  if (saisie.dateEffet.trim() === "") manquants.push("Date d'effet");
  if (saisie.dateEcheance.trim() === "") manquants.push("Date d'échéance");
  if (!saisie.effectifs.some((e) => e.trim() !== "")) manquants.push("Effectif d'au moins une formule");
  return manquants;
}

/**
 * Le champ de nom `nom` change-t-il le calcul ? Contrat, régime, dates, tranches et, par formule, effectif, prime forcée et accessoires.
 * Le souscripteur, les assurés, le motif… n'y changent rien : leur frappe ne doit pas interroger le serveur.
 */
export function nomChangeLeCalcul(nom: string): boolean {
  return ["typeContrat", "regimeTaxe", "dateEffet", "dateEcheance", "nombreTranches"].includes(nom) || /^(eff|forcee|acc)_/.test(nom);
}
