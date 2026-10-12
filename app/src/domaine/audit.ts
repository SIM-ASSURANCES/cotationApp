/** Actions du journal d'audit (CDC §15.4). La liste s'allonge avec les phases suivantes. */
export const ACTIONS_AUDIT = [
  // Connexion
  "CONNEXION_REUSSIE",
  "CONNEXION_ECHEC",
  "CONNEXION_REFUSEE_COMPTE_VERROUILLE",
  "CONNEXION_REFUSEE_COMPTE_INACTIF",
  "COMPTE_VERROUILLE",
  "DECONNEXION",
  // Utilisateurs et droits
  "UTILISATEUR_CREE",
  "UTILISATEUR_MODIFIE",
  "UTILISATEUR_DESACTIVE",
  "UTILISATEUR_REACTIVE",
  "MOT_DE_PASSE_CHANGE",
  "MOT_DE_PASSE_REINITIALISE",
  "DROIT_MODIFIE",
  // Prévues par le CDC, branchées dans les phases suivantes
  "MODELE_DEPOSE",
  "MODELE_PUBLIE",
  "PARAMETRE_MODIFIE",
  "PRIME_FORCEE",
  "DOCUMENT_VALIDE",
  "DOCUMENT_EMIS",
  "DOCUMENT_REEDITE",
  "AVOIR_EMIS",
  "DOCUMENT_TELECHARGE",
  "ECRITURE_PARTAGE_ECHEC",
  // Cotations (phase 2)
  "COTATION_CREEE",
  "COTATION_MODIFIEE",
  "COTATION_COMPOSEE",
  "COTATION_COMPOSITION_VIDEE",
  "COTATION_SOUMISE",
  "COTATION_RENVOYEE",
  "COTATION_ACCEPTEE",
  "COTATION_REFUSEE",
  "COTATION_EXPIREE",
  "POLICE_CREEE",
  "CLIENT_CREE",
  "MOTIF_REFUS_CREE",
  // Bibliothèque de modèles (phase 3) ; MODELE_DEPOSE et MODELE_PUBLIE sont plus haut
  "MODELE_CREE",
  "MODELE_DEPOT_REFUSE",
  "MODELE_SOUMIS",
  "MODELE_RENVOYE",
  "MODELE_TELECHARGE",
  "MODELE_APERCU",
  // Documents émis (phase 3b) ; DOCUMENT_EMIS, DOCUMENT_REEDITE, DOCUMENT_TELECHARGE sont plus haut
  "DOCUMENT_ANNULE",
  // Session 4.0 : accessoires modifiés dans une cotation (H1, D18)
  "ACCESSOIRES_MODIFIES",
  // Session 4a : liste des adhérents d'une police de groupe (CDC §10.2)
  "ADHERENTS_INCORPORES",
  "ADHERENTS_RETIRES",
  // Corrections de la 4a : émission d'un contrat au-dessus du seuil du produit (CDC §4 « Oui (sous seuil) »)
  "CONTRAT_A_VALIDER",
  "CONTRAT_VALIDE",
  // Session 4b : factures, avoirs, paiements, reçus (CDC §11, §12) ; AVOIR_EMIS est plus haut
  "FACTURE_CREEE",
  "FACTURE_MODIFIEE",
  "FACTURE_A_VALIDER",
  "FACTURE_EMISE",
  "FACTURE_ANNULEE",
  "FACTURE_ABANDONNEE",
  "PAIEMENT_ENREGISTRE",
  "PDF_EN_ATTENTE",
  // Session 5a : stockage indisponible (T14, ECRITURE_PARTAGE_ECHEC est plus haut) et import en masse (CDC §13)
  "ECRITURE_REPRISE",
  "ECRITURE_RELANCEE",
  "IMPORT_CONTROLE",
  "IMPORT_ABANDONNE",
  "IMPORT_CONFIRME",
  "IMPORT_TERMINE",
  // Session 5b : avis d'échéance et relances (CDC §12) ; chaque document produit est DOCUMENT_EMIS
  "LISTE_ECHEANCES_ETABLIE",
  "LOT_ECHEANCES_CREE",
  "LOT_ECHEANCES_TERMINE",
  // Session 6.0 : report des paiements d'une facture annulée (H47), avance sur police (H33), intermédiaires, tâches (H66)
  "PAIEMENT_REPORTE",
  "AVANCE_CREDITEE",
  "AVANCE_IMPUTEE",
  "AVANCE_RESTITUEE",
  "INTERMEDIAIRE_CREE",
  "INTERMEDIAIRE_MODIFIE",
  "TACHE_FERMEE",
] as const;

export type ActionAudit = (typeof ACTIONS_AUDIT)[number];
