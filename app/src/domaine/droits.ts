/**
 * Profils et droits (CDC §4). Règles pures : la matrice par défaut ci-dessous est
 * celle du CDC ; l'administrateur peut la modifier (elle est alors lue en base).
 */

export const PROFILS = [
  { code: "COMMERCIAL", libelle: "Commercial" },
  { code: "GESTIONNAIRE_PRODUCTION", libelle: "Gestionnaire production" },
  { code: "TECHNIQUE", libelle: "Technique (valideur)" },
  { code: "COMPTABILITE", libelle: "Comptabilité" },
  { code: "DIRECTION_GENERALE", libelle: "Direction Générale" },
  { code: "ADMIN_SYSTEME", libelle: "Admin système" },
] as const;

export type CodeProfil = (typeof PROFILS)[number]["code"];

export const ACTIONS = [
  { code: "CREER_COTATION", libelle: "Créer une cotation" },
  { code: "FORCER_PRIME", libelle: "Forcer une prime" },
  { code: "EMETTRE_CONTRAT", libelle: "Émettre un contrat" },
  { code: "EMETTRE_FACTURE", libelle: "Émettre une facture" },
  { code: "EMETTRE_AVOIR", libelle: "Émettre un avoir" },
  { code: "ENREGISTRER_PAIEMENT", libelle: "Enregistrer un paiement / reçu" },
  { code: "DEPOSER_MODELE", libelle: "Déposer/modifier un modèle Word" },
  { code: "PUBLIER_MODELE", libelle: "Publier un modèle" },
  { code: "PARAMETRER_PRODUITS", libelle: "Paramétrer produits, taxes, arrondis" },
  { code: "GERER_UTILISATEURS", libelle: "Gérer utilisateurs, droits, dossier partagé" },
  { code: "CONSULTER_AUDIT", libelle: "Consulter le journal d'audit" },
  // Extension hors tableau du CDC §4 (réponse H7 de la Technique, D18) : droit paramétrable.
  { code: "VALIDER_COTATION", libelle: "Valider une cotation (prime forcée ou seuil dépassé)" },
] as const;

/** Actions ajoutées au tableau du CDC §4 par une décision consignée (decisions.md). */
export const ACTIONS_HORS_CDC: readonly CodeAction[] = ["VALIDER_COTATION"];

export type CodeAction = (typeof ACTIONS)[number]["code"];

/** Niveau de droit d'un profil sur une action (valeurs du tableau du CDC §4). */
export const NIVEAUX = [
  { code: "AUCUN", libelle: "–" },
  { code: "LECTURE", libelle: "Lecture" },
  { code: "DEMANDE", libelle: "Demande" },
  { code: "PROPOSITION", libelle: "Proposition" },
  { code: "OUI_SOUS_SEUIL", libelle: "Oui (sous seuil)" },
  { code: "OUI", libelle: "Oui" },
  { code: "VALIDE", libelle: "Valide" },
] as const;

export type CodeNiveau = (typeof NIVEAUX)[number]["code"];

export type MatriceDroits = Record<CodeProfil, Record<CodeAction, CodeNiveau>>;

const A = "AUCUN", L = "LECTURE", D = "DEMANDE", P = "PROPOSITION", S = "OUI_SOUS_SEUIL", O = "OUI", V = "VALIDE";

/**
 * Tableau du CDC §4, colonnes dans l'ordre : Commercial, Gestionnaire production,
 * Technique, Comptabilité, Direction Générale, Admin système.
 * « Publier un modèle » : Technique = « Non (auteur) » dans le CDC, soit AUCUN ici.
 */
const LIGNES: Record<CodeAction, readonly CodeNiveau[]> = {
  CREER_COTATION: [O, O, O, A, L, A],
  FORCER_PRIME: [D, D, V, A, V, A],
  EMETTRE_CONTRAT: [A, S, O, A, L, A],
  EMETTRE_FACTURE: [A, S, O, O, L, A],
  EMETTRE_AVOIR: [A, A, V, O, V, A],
  ENREGISTRER_PAIEMENT: [A, O, A, O, A, A],
  DEPOSER_MODELE: [A, A, O, A, A, A],
  PUBLIER_MODELE: [A, A, A, A, O, A],
  PARAMETRER_PRODUITS: [A, A, O, P, V, A],
  GERER_UTILISATEURS: [A, A, A, A, A, O],
  CONSULTER_AUDIT: [A, A, L, A, L, L],
  // H7 (D18) : la validation des cotations est réservée au profil Technique (droit paramétrable).
  VALIDER_COTATION: [A, A, V, A, A, A],
};

export function droitsParDefaut(): MatriceDroits {
  const matrice = {} as MatriceDroits;
  PROFILS.forEach((profil, colonne) => {
    matrice[profil.code] = {} as Record<CodeAction, CodeNiveau>;
    for (const action of ACTIONS) {
      matrice[profil.code][action.code] = LIGNES[action.code][colonne];
    }
  });
  return matrice;
}

export function estCodeProfil(valeur: string): valeur is CodeProfil {
  return PROFILS.some((p) => p.code === valeur);
}

export function estCodeAction(valeur: string): valeur is CodeAction {
  return ACTIONS.some((a) => a.code === valeur);
}

export function estCodeNiveau(valeur: string): valeur is CodeNiveau {
  return NIVEAUX.some((n) => n.code === valeur);
}

/** Voit l'écran ou la donnée (tout niveau sauf AUCUN). */
export const peutLire = (niveau: CodeNiveau): boolean => niveau !== "AUCUN";

/** Peut accomplir l'action lui-même (sous seuil : le seuil est contrôlé par l'appelant). */
export const peutAgir = (niveau: CodeNiveau): boolean =>
  niveau === "OUI" || niveau === "OUI_SOUS_SEUIL" || niveau === "VALIDE";

/** Peut valider ce que d'autres ont demandé (le valideur n'est jamais l'auteur : CDC §4.1). */
export const peutValider = (niveau: CodeNiveau): boolean => niveau === "VALIDE";

/**
 * Garde-fou contre le verrouillage de l'administration : l'Admin système doit
 * toujours pouvoir gérer les utilisateurs et les droits.
 */
export function modificationDroitInterdite(
  profil: CodeProfil,
  action: CodeAction,
  niveau: CodeNiveau,
): string | null {
  if (profil === "ADMIN_SYSTEME" && action === "GERER_UTILISATEURS" && niveau !== "OUI") {
    return "L'Admin système doit toujours pouvoir gérer les utilisateurs.";
  }
  return null;
}
