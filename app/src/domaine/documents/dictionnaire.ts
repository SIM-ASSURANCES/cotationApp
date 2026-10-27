/**
 * Dictionnaire des champs des modèles Word (CDC §6.3) : SOURCE UNIQUE DE VÉRITÉ.
 *
 * Il est lu par :
 *   - les contrôles au dépôt d'un modèle (une balise hors dictionnaire est rejetée, T9) ;
 *   - la construction des données d'un document (`champsInconnus` refuse tout nom inventé) ;
 *   - l'aide intégrée (page « Aide à la rédaction des modèles ») ;
 *   - l'aperçu d'un modèle avec des données fictives (`donneesExemple`).
 *
 * Normatif : uniquement les noms du CDC, plus `assures[].sexe` (D12), `doc.auteur_nom` (D20) et, pour les factures et
 * les reçus (D23), `envoye_a.*`, `formules[].base_taxe` et `paiements[].payeur` ; pour les avis d'échéance et les
 * relances (D25), `echeance_appelee.*` et `relance.*` ; `solde.avance` (D28, session 6.0) ; pour les produits tarifés par garanties
 * (D32, session 6.2b), `garanties_souscrites[]`, et `prime.taux_taxe` devient facultatif (vide quand plusieurs taux s'appliquent).
 * `risque.*` est ouvert : chaque produit y met ses propres champs (CDC §6.3, « extensible »).
 * Les champs des éléments de `societe.rib[]`, `societe.mobile_money[]` et `societe.recours[]` ne
 * sont pas nommés par le CDC : les noms retenus ici sont des hypothèses (decisions.md, D14).
 *
 * Notation : « assures[].nom_prenoms » = champ `nom_prenoms` de chaque élément de la liste
 * `assures` ; dans un modèle, on l'écrit dans une boucle : {%tr for a in assures %} {{ a.nom_prenoms }}.
 */

export type TypeChamp = "texte" | "montant" | "date" | "dateheure" | "entier" | "booleen" | "pourcentage" | "liste" | "objet" | "image";

export type Section = "Société, produit, intermédiaires" | "Souscripteur, assurés, bénéficiaires, risque" | "Police, formules, primes, échéances, paiements" | "Document";

export type Champ = {
  chemin: string;
  type: TypeChamp;
  description: string;
  /** Valeur d'exemple (aperçu avec des données fictives) ; absente pour les listes, objets et images. */
  exemple?: string | number | boolean | null;
  section: Section;
  /**
   * Facultatif (D19, option b de H19) : quand l'application ne le fournit pas, il est présent et VIDE.
   * Un champ non facultatif que l'application ne fournit pas est ABSENT : un modèle qui l'utilise ne se
   * génère pas, avec le nom du champ.
   */
  facultatif?: true;
};

const S1: Section = "Société, produit, intermédiaires";
const S2: Section = "Souscripteur, assurés, bénéficiaires, risque";
const S3: Section = "Police, formules, primes, échéances, paiements";
const S4: Section = "Document";

const c = (chemin: string, type: TypeChamp, description: string, exemple: Champ["exemple"], section: Section, facultatif?: true): Champ => ({
  chemin,
  type,
  description,
  exemple,
  section,
  ...(facultatif ? { facultatif } : {}),
});
/** Marque un champ facultatif (D19). */
const FACULTATIF = true as const;

export const CHAMPS: readonly Champ[] = [
  // ---------------------------------------------------------------- 6.3.1
  c("societe.raison_sociale", "texte", "Raison sociale de la compagnie", "SIM Assurances Côte d'Ivoire", S1),
  c("societe.forme", "texte", "Forme juridique", "SA", S1),
  c("societe.capital", "montant", "Capital social", "727000000", S1),
  c("societe.capital_libere", "pourcentage", "Part du capital libérée", "77", S1),
  c("societe.adresse", "texte", "Adresse du siège", "Abidjan Plateau, avenue inventée", S1),
  c("societe.bp", "texte", "Boîte postale", "01 BP 0000 Abidjan 01", S1),
  c("societe.telephone", "texte", "Téléphone", "+225 27 00 00 00 00", S1),
  c("societe.email_reclamation", "texte", "E-mail des réclamations", "reclamation@exemple.ci", S1),
  c("societe.site", "texte", "Site Internet", "www.exemple.ci", S1),
  c("societe.rccm", "texte", "N° RCCM", "CI-ABJ-0000-B-00000", S1),
  c("societe.ncc", "texte", "N° de compte contribuable", "0000000 A", S1),
  c("societe.agrement", "texte", "Agrément", "Agrément n° 0000 (exemple)", S1),
  c("societe.rib", "liste", "Comptes bancaires", undefined, S1),
  c("societe.rib[].banque", "texte", "Banque (nom retenu par hypothèse)", "BANQUE EXEMPLE", S1),
  c("societe.rib[].numero", "texte", "N° de compte (nom retenu par hypothèse)", "CI000 00000 000000000000 00", S1),
  c("societe.mobile_money", "liste", "Paiement Mobile Money", undefined, S1),
  c("societe.mobile_money[].operateur", "texte", "Opérateur (nom retenu par hypothèse)", "Opérateur exemple", S1),
  c("societe.mobile_money[].numero_marchand", "texte", "N° marchand (nom retenu par hypothèse)", "0700000000", S1),
  c("societe.recours", "liste", "Recours : OQSF-CI, Direction des Assurances, Médiation", undefined, S1),
  c("societe.recours[].libelle", "texte", "Organisme de recours (nom retenu par hypothèse)", "Médiation (exemple)", S1),
  c("societe.recours[].url", "texte", "Adresse du site (nom retenu par hypothèse)", "www.mediation.exemple.ci", S1),
  c("produit.code", "texte", "Code du produit", "RELAXSANTE", S1),
  c("produit.libelle", "texte", "Libellé du produit", "Relax Santé", S1),
  c("produit.gamme", "texte", "Gamme", "RELAX", S1),
  c("produit.branche", "texte", "Catégorie de taxe (branche fiscale)", "SANTE", S1),
  c("produit.branche_libelle", "texte", "Libellé de la branche principale du produit (extension D37)", "Incendie et dommages aux biens", S1, FACULTATIF),
  c("produit.cg_libelle", "texte", "Libellé des conditions générales", "SECUR DOMMAGE", S1),
  c("produit.cg_visa", "texte", "Visa des conditions générales", "MFB/DGTCP/DA/N° 00000", S1),
  c("produit.cg_date", "date", "Date des conditions générales", "2025-06-19", S1),
  c("produit.cs_libelle", "texte", "Libellé des conventions spéciales", "Conventions spéciales (exemple)", S1),
  c("produit.cs_visa", "texte", "Visa des conventions spéciales", "MFB/DGTCP/DA/N° 00001", S1),
  c("intermediaires", "liste", "Intermédiaires (0 à 2) ; liste vide si l'application ne les connaît pas", undefined, S1, FACULTATIF),
  c("intermediaires[].nom", "texte", "Nom de l'intermédiaire", "COURTIER EXEMPLE", S1),
  c("intermediaires[].code", "texte", "Code de l'intermédiaire", "INT-001", S1),
  c("intermediaires[].role", "texte", "Rôle (apporteur, gestionnaire…)", "Apporteur", S1),

  // ---------------------------------------------------------------- 6.3.2
  c("souscripteur.type", "texte", "PHYSIQUE ou MORALE", "PHYSIQUE", S2),
  c("souscripteur.nom", "texte", "Nom", "KOUADIO", S2),
  c("souscripteur.prenoms", "texte", "Prénoms", "Awa Inventée", S2),
  c("souscripteur.raison_sociale", "texte", "Raison sociale (personne morale)", "", S2),
  c("souscripteur.num_identification", "texte", "Pièce d'identité (CNI, passeport…)", "CNI C0000000000", S2),
  c("souscripteur.date_naissance", "date", "Date de naissance", "1985-04-12", S2),
  c("souscripteur.lieu_naissance", "texte", "Lieu de naissance", "Bouaké", S2),
  c("souscripteur.profession", "texte", "Profession", "Comptable", S2),
  c("souscripteur.activite", "texte", "Activité", "Services", S2),
  c("souscripteur.employeur", "texte", "Employeur", "ENTREPRISE EXEMPLE", S2),
  c("souscripteur.adresse", "texte", "Adresse", "Cocody, rue inventée", S2),
  c("souscripteur.bp", "texte", "Boîte postale", "", S2),
  c("souscripteur.localite", "texte", "Localité", "Abidjan", S2),
  c("souscripteur.sous_prefecture", "texte", "Sous-préfecture", "Bingerville", S2),
  c("souscripteur.telephone", "texte", "Téléphone", "0700000000", S2),
  c("souscripteur.whatsapp", "texte", "WhatsApp", "0700000000", S2),
  c("souscripteur.mobile_money", "texte", "N° Mobile Money", "0700000000", S2),
  c("souscripteur.email", "texte", "E-mail", "awa.kouadio@exemple.ci", S2),
  c("souscripteur.situation_matrimoniale", "texte", "Situation matrimoniale (santé)", "Mariée", S2),
  c("souscripteur.nb_enfants", "entier", "Nombre d'enfants (santé)", 2, S2),
  c("souscripteur.groupe_sanguin", "texte", "Groupe sanguin (santé)", "O+", S2),
  c("assures", "liste", "Assurés du contrat", undefined, S2),
  c("assures[].ordre", "entier", "N° d'ordre", 1, S2),
  c("assures[].nom_prenoms", "texte", "Nom et prénoms", "KOUADIO Awa Inventée", S2),
  c("assures[].date_naissance", "date", "Date de naissance", "1985-04-12", S2),
  c("assures[].sexe", "texte", "Sexe : M, F, ou vide si inconnu (décision du 05/10/2026)", "F", S2),
  c("assures[].lien", "texte", "Lien avec le souscripteur (filiation en santé)", "Souscripteur", S2),
  c("assures[].num_identification", "texte", "Pièce d'identité de l'assuré (CNI, passeport…), facultative à la saisie (session 6.0, D27)", "CNI C0000000001", S2),
  c("assures[].formule", "texte", "Formule de l'assuré", "SOLO", S2),
  c("assures[].prime", "montant", "Prime TTC de l'assuré : TTC d'une unité de sa formule (H45)", "96000", S2),
  c("beneficiaires", "liste", "Bénéficiaires (SECURVIE, RELAXACCIDENT)", undefined, S2),
  c("beneficiaires[].ordre", "entier", "N° d'ordre", 1, S2),
  c("beneficiaires[].nom_prenoms", "texte", "Nom et prénoms", "KOUADIO Paul Inventé", S2),
  c("beneficiaires[].lien", "texte", "Lien avec l'assuré", "Conjoint", S2),
  c("beneficiaires[].contact", "texte", "Contact", "0700000001", S2),
  c("beneficiaires[].quote_part", "pourcentage", "Quote-part", "100", S2),
  c("contacts_urgence", "liste", "Contacts d'urgence (RELAXVOYAGE)", undefined, S2),
  c("contacts_urgence[].nom_prenoms", "texte", "Nom et prénoms", "KOUADIO Paul Inventé", S2),
  c("contacts_urgence[].contact", "texte", "Contact", "0700000001", S2),
  c("envoye_a", "objet", "« Envoyé à » d'une facture (extension D23) : vide s'il n'est pas saisi ou s'il est identique à « Facturé à » (bloc à masquer)", undefined, S2),
  c("envoye_a.nom", "texte", "Destinataire de la facture", "SERVICE COMPTABLE EXEMPLE", S2),
  c("envoye_a.adresse", "texte", "Adresse du destinataire", "Plateau, rue inventée", S2),
  c("risque", "objet", "Champs propres au produit : risque.marque, risque.statut… (tout nom en minuscules). Produit au barème : un champ par champ du barème (risque.<code>), vide s'il ne s'applique pas à la saisie", undefined, S2),

  // ---------------------------------------------------------------- 6.3.3
  c("police.numero", "texte", "N° de police", "POL-2026-000001", S3),
  c("police.reference", "texte", "Référence de la police : son numéro (D27, H46 fermée)", "POL-2026-000001", S3),
  c("police.date_souscription", "date", "Date de souscription", "2026-09-01", S3),
  c("police.date_effet", "dateheure", "Date d'effet (heure obligatoire pour RELAXVOYAGE)", "2026-09-01T08:00", S3),
  c("police.date_echeance", "dateheure", "Date d'échéance", "2027-08-31T23:59", S3),
  c("police.duree_jours", "entier", "Durée en jours", 365, S3),
  c("police.duree_libelle", "texte", "Durée en toutes lettres", "un an", S3),
  c("police.type_contrat", "texte", "INDIVIDUEL, FAMILLE, GROUPE ou GROUPE_OUVERT", "FAMILLE", S3),
  c("police.police_mere", "texte", "Police mère (certificat d'adhésion) ; vide pour un autre document", "", S3, FACULTATIF),
  c("police.nantissement", "objet", "Nantissement (SECURSTOCK) ; vide s'il n'y en a pas", undefined, S3, FACULTATIF),
  c("police.nantissement.beneficiaire", "texte", "Bénéficiaire du nantissement", "BANQUE EXEMPLE", S3),
  c("police.nantissement.montant", "montant", "Montant nanti", "5000000", S3),
  c("formules", "liste", "Une ligne par formule (Solo, Famille…)", undefined, S3),
  c("formules[].code", "texte", "Code de la formule", "SOLO", S3),
  c("formules[].libelle", "texte", "Libellé", "Solo", S3),
  c("formules[].taux_couverture", "pourcentage", "Taux de couverture ; vide hors santé (facultatif, décision de Thierry, session 6.0)", "80", S3, FACULTATIF),
  c("formules[].effectif", "entier", "Effectif", 3, S3),
  c("formules[].prime_unitaire", "montant", "Prime unitaire", "93581.33", S3),
  c("formules[].prime_nette", "montant", "Prime nette", "280744", S3),
  c("formules[].accessoires", "montant", "Accessoires", "3000", S3),
  c("formules[].taxe", "montant", "Taxe", "4256", S3),
  c("formules[].ttc", "montant", "Prime TTC", "288000", S3),
  c("formules[].base_taxe", "montant", "Montant HT de la ligne : assiette de la taxe (extension D23)", "283744", S3),
  // Session 6.2b (D32) : produit tarifé par garanties. Une ligne par garantie souscrite, avec SON taux de taxe ; vide pour un produit à la formule.
  // Attention : `bloc("garanties", …)` désigne un SOUS-MODÈLE (bibliothèque de modèles), pas cette donnée.
  c("garanties_souscrites", "liste", "Une ligne par garantie souscrite d'un produit tarifé par garanties (extension D32) ; liste vide pour un produit à la formule", undefined, S3, FACULTATIF),
  c("garanties_souscrites[].libelle", "texte", "Libellé de la garantie, de la surprime ou de la majoration (extension D32)", "Incendie", S3),
  c("garanties_souscrites[].branche", "texte", "Branche fiscale de la ligne : INCENDIE, IARD, IA, DECES… (extension D32)", "INCENDIE", S3),
  c("garanties_souscrites[].montant_garanti", "montant", "Montant garanti de la garantie : capital ou 1er risque en FCFA ; vide pour une garantie sans capital (extension D37)", "10000000", S3, FACULTATIF),
  c("garanties_souscrites[].prime_nette", "montant", "Prime nette de la garantie (extension D32)", "10000", S3),
  c("garanties_souscrites[].accessoires", "montant", "Accessoires de la garantie (extension D32)", "2500", S3),
  c("garanties_souscrites[].taux_taxe", "pourcentage", "Taux de taxe de la garantie, selon sa branche (extension D32)", "12.5", S3),
  c("garanties_souscrites[].taxe", "montant", "Taxe de la garantie (extension D32)", "1563", S3),
  c("garanties_souscrites[].ttc", "montant", "Prime TTC de la garantie : nette + accessoires + taxe (extension D32)", "14063", S3),
  c("prime.nette", "montant", "Prime nette totale", "15440202", S3),
  c("prime.accessoires", "montant", "Accessoires", "213000", S3),
  c("prime.base_taxe", "montant", "Assiette de la taxe", "15653202", S3),
  c("prime.taux_taxe", "pourcentage", "Taux de taxe ; vide quand plusieurs taux s'appliquent (garanties de branches différentes, D32)", "1.5", S3, FACULTATIF),
  c("prime.taxe", "montant", "Taxe", "234798", S3),
  c("prime.ttc", "montant", "Prime TTC", "15888000", S3),
  c("prime.forcee", "booleen", "Prime forcée (non affiché au client)", false, S3),
  c("prime.motif_forcage", "texte", "Motif du forçage (non affiché au client)", "", S3),
  c("echeances", "liste", "Échéancier", undefined, S3),
  c("echeances[].numero", "entier", "N° d'échéance", 1, S3),
  c("echeances[].date", "date", "Date", "2026-09-01", S3),
  c("echeances[].montant", "montant", "Montant", "3972000", S3),
  c("echeances[].statut", "texte", "Statut : « Payé », « Partiellement payé » ou « Non payé » sur une facture (paiements répartis dans l'ordre des échéances) ; « À payer » avant l'émission (cotation, CP)", "À payer", S3),
  c("echeances[].paye", "montant", "Part de l'échéance déjà payée (extension D29) ; 0 avant l'émission", "3000000", S3),
  c("echeances[].restant", "montant", "Reste à payer sur cette échéance (extension D29) ; le montant entier avant l'émission", "972000", S3),
  c("paiements", "liste", "Historique des paiements", undefined, S3),
  c("paiements[].numero", "texte", "N° de reçu", "REC-2026-09-0001", S3),
  c("paiements[].date", "date", "Date", "2026-09-05", S3),
  c("paiements[].montant", "montant", "Montant", "41000", S3),
  c("paiements[].reference", "texte", "Référence du paiement", "VIR-EXEMPLE", S3),
  c("paiements[].canal", "texte", "Canal", "Virement", S3),
  c("paiements[].restant_du", "montant", "Restant dû après ce paiement", "15847000", S3),
  c("paiements[].payeur", "texte", "Payeur (extension D23)", "ENTREPRISE INVENTÉE", S3),
  c("solde.total_paye", "montant", "Total payé", "41000", S3),
  c("solde.restant_du", "montant", "Restant dû", "15847000", S3),
  c("solde.avance", "montant", "Avance disponible de la police : trop-perçus et sommes reportées, non encore imputées ni restituées (extension D28) ; facture, reçu, avis et relance", "0", S3),
  // Session 5b (D25) : avis d'échéance et relances. Non fournis pour les autres documents.
  c("echeance_appelee", "objet", "Échéance appelée par un avis d'échéance ou une relance (extension D25)", undefined, S3),
  c("echeance_appelee.numero", "entier", "N° de l'échéance appelée", 2, S3),
  c("echeance_appelee.date", "date", "Date de l'échéance appelée", "2026-10-01", S3),
  c("echeance_appelee.montant", "montant", "Montant de l'échéance appelée", "2898000", S3),
  c("echeance_appelee.restant_du", "montant", "Reste à payer sur cette échéance", "898000", S3),
  c("relance", "objet", "Relance : niveau et retard (extension D25) ; non fourni pour un avis", undefined, S3),
  c("relance.niveau", "entier", "Niveau de la relance (1, 2, 3…)", 3, S3),
  c("relance.libelle", "texte", "Libellé du niveau (paramétrage du produit)", "Mise en demeure", S3),
  c("relance.jours_retard", "entier", "Jours écoulés depuis la date de l'échéance", 30, S3),

  // ---------------------------------------------------------------- 6.3.4
  c("doc.type", "texte", "Type de document", "COTATION", S4),
  c("doc.numero", "texte", "N° du document", "COT-2026-09-0001", S4),
  c("doc.version", "texte", "Version", "v1", S4),
  c("doc.date_emission", "date", "Date d'émission", "2026-09-16", S4),
  c("doc.lieu_emission", "texte", "Lieu d'émission", "Abidjan", S4),
  c("doc.date_validite", "date", "Fin de validité (cotations)", "2026-12-16", S4),
  c("doc.signataire_nom", "texte", "Nom du signataire", "SIGNATAIRE Inventé", S4),
  c("doc.signataire_fonction", "texte", "Fonction du signataire", "Responsable Technique", S4),
  c("signature_sim", "image", "Signature scannée de SIM", undefined, S4),
  c("cachet_sim", "image", "Cachet de SIM", undefined, S4),
  c("qr_code", "image", "QR code de vérification", undefined, S4),
  c("doc.url_verification", "texte", "Adresse de vérification", "https://exemple.ci/verif/exemple", S4),
  c("doc.empreinte", "texte", "Empreinte SHA-256 du document ; toujours vide dans le document lui-même (H20)", "0000000000000000000000000000000000000000000000000000000000000000", S4, FACULTATIF),
  c("doc.auteur_nom", "texte", "Nom de l'auteur de la cotation (extension D20)", "AUTEUR Inventé", S4),
  c("doc.facture_origine", "texte", "Facture d'origine : facture annulée (avoir), facture réglée (reçu)", "FAC-2026-09-0003", S4),
];

const PAR_CHEMIN = new Map(CHAMPS.map((champ) => [champ.chemin, champ]));
/** Objets implicites (« souscripteur », « police.nantissement »…), utilisables dans un {% if %}. */
const CONTENEURS = new Set(
  CHAMPS.flatMap((champ) => {
    const parties: string[] = [];
    const morceaux = champ.chemin.split(".");
    for (let i = 1; i < morceaux.length; i++) parties.push(morceaux.slice(0, i).join("."));
    return parties.map((p) => p.replace(/\[\]$/, ""));
  }),
);

export const IMAGES = CHAMPS.filter((champ) => champ.type === "image").map((champ) => champ.chemin);

/** Un chemin relevé dans un modèle est-il un nom du dictionnaire ? */
export function estConnu(chemin: string): boolean {
  if (chemin === "risque" || /^risque(\.[a-z][a-z0-9_]*)+$/.test(chemin)) return true;
  return PAR_CHEMIN.has(chemin) || CONTENEURS.has(chemin) || PAR_CHEMIN.get(chemin.replace(/\[\]$/, ""))?.type === "liste";
}

export const champDuDictionnaire = (chemin: string): Champ | undefined => PAR_CHEMIN.get(chemin);

/** Racines du dictionnaire (« souscripteur », « police », « qr_code »…). */
export const RACINES: ReadonlySet<string> = new Set(CHAMPS.map((champ) => champ.chemin.split(/[.[]/)[0]));

/** Le champ est-il déclaré facultatif (D19) ? */
export const estFacultatif = (chemin: string): boolean => PAR_CHEMIN.get(chemin)?.facultatif === true;

/**
 * Champs facultatifs (D19), envoyés au générateur avec chaque demande de PDF : vide, un champ facultatif
 * s'écrit vide même passé dans un filtre (« | date », « | pct »…) ; un champ obligatoire vide arrête la génération.
 */
export const CHAMPS_FACULTATIFS: readonly string[] = CHAMPS.filter((champ) => champ.facultatif).map((champ) => champ.chemin);

/**
 * Champs `risque.<code>` facultatifs d'un document (B6b, D52, H146) : ceux dont la donnée est vide. Un champ du barème qui ne s'applique pas à la
 * saisie, ou qui est facultatif et laissé vide, est fourni vide ; un modèle qui l'emploie l'écrit vide au lieu de bloquer la génération.
 */
export function champsRisqueFacultatifs(donnees: Record<string, unknown>): string[] {
  const risque = donnees.risque;
  if (typeof risque !== "object" || risque === null) return [];
  return Object.entries(risque)
    .filter(([, valeur]) => valeur === "")
    .map(([code]) => `risque.${code}`);
}

/**
 * Marqueur d'une donnée que l'application NE FOURNIT PAS (profession non saisie, bénéficiaires non gérés…).
 * Distinct de null, qui veut dire « connue et vide ».
 */
export const NON_FOURNI: unique symbol = Symbol("non fourni");
export type NonFourni = typeof NON_FOURNI;

/**
 * Option b de H19 (D19) : remplace chaque donnée NON_FOURNI par une valeur vide (null, ou [] pour une
 * liste) si le champ est facultatif, et la RETIRE sinon : un modèle qui l'utilise ne se génère pas.
 * Renvoie aussi la liste des champs retirés (pour l'information de l'utilisateur et les tests).
 */
export function appliquerFacultatifs(donnees: Donnees): { donnees: Donnees; absents: string[] } {
  const absents = new Set<string>();
  const traiter = (valeur: unknown, chemin: string): unknown => {
    if (Array.isArray(valeur)) return valeur.map((v) => traiter(v, `${chemin}[]`));
    if (valeur === null || typeof valeur !== "object") return valeur;
    const sortie: Donnees = {};
    for (const [cle, v] of Object.entries(valeur)) {
      const enfant = chemin ? `${chemin}.${cle}` : cle;
      if (v === NON_FOURNI) {
        if (estFacultatif(enfant)) sortie[cle] = PAR_CHEMIN.get(enfant)?.type === "liste" ? [] : null;
        else absents.add(enfant);
        continue;
      }
      sortie[cle] = traiter(v, enfant);
    }
    return sortie;
  };
  return { donnees: traiter(donnees, "") as Donnees, absents: [...absents].sort() };
}

// ------------------------------------------------------------------ Données fictives (aperçu)

type Donnees = Record<string, unknown>;

function placer(cible: Donnees, chemin: string[], valeur: unknown): void {
  const [tete, ...reste] = chemin;
  if (reste.length === 0) {
    cible[tete] = valeur;
    return;
  }
  cible[tete] ??= {};
  placer(cible[tete] as Donnees, reste, valeur);
}

function element(liste: string, rang: number): Donnees {
  const item: Donnees = {};
  for (const champ of CHAMPS) {
    if (!champ.chemin.startsWith(`${liste}[].`) || champ.exemple === undefined) continue;
    const nom = champ.chemin.slice(liste.length + 3);
    let valeur = champ.exemple;
    if (nom === "ordre" || nom === "numero") valeur = typeof valeur === "number" ? rang : `${String(valeur).replace(/\d+$/, "")}${String(rang).padStart(4, "0")}`;
    if (nom === "nom_prenoms" && typeof valeur === "string") valeur = `${valeur} ${rang}`;
    placer(item, nom.split("."), valeur);
  }
  return item;
}

/**
 * Données fictives couvrant TOUT le dictionnaire (aperçu d'un modèle, CDC §6.6 « Brouillon »).
 * `nombreAssures` permet de vérifier le renvoi en annexe des listes longues (T7).
 */
export function donneesExemple(options: { nombreAssures?: number } = {}): Donnees {
  const donnees: Donnees = {};
  for (const champ of CHAMPS) {
    if (champ.chemin.includes("[]") || champ.exemple === undefined) continue;
    placer(donnees, champ.chemin.split("."), champ.exemple);
  }
  const tailles: Record<string, number> = { assures: options.nombreAssures ?? 2 };
  for (const champ of CHAMPS) {
    if (champ.type !== "liste") continue;
    const nombre = tailles[champ.chemin] ?? 2;
    placer(donnees, champ.chemin.split("."), Array.from({ length: nombre }, (_, i) => element(champ.chemin, i + 1)));
  }
  placer(donnees, ["risque"], { statut: "PROPRIETAIRE", marque: "MARQUE EXEMPLE", nb_pieces: "4" });
  return donnees;
}

/**
 * Noms présents dans des données mais absents du dictionnaire : une construction de données qui
 * inventerait un nom (ou en mal orthographierait un) est refusée avant toute génération.
 */
export function champsInconnus(donnees: Donnees): string[] {
  const inconnus: string[] = [];
  const parcourir = (valeur: unknown, chemin: string): void => {
    if (chemin.startsWith("risque.") || chemin === "risque") return;
    if (Array.isArray(valeur)) {
      if (!estConnu(chemin)) inconnus.push(chemin);
      valeur.forEach((v) => parcourir(v, `${chemin}[]`));
      return;
    }
    if (valeur !== null && typeof valeur === "object") {
      if (chemin !== "" && !estConnu(chemin)) inconnus.push(chemin);
      for (const [cle, v] of Object.entries(valeur)) parcourir(v, chemin ? `${chemin}.${cle}` : cle);
      return;
    }
    if (!estConnu(chemin)) inconnus.push(chemin);
  };
  parcourir(donnees, "");
  return [...new Set(inconnus)].sort();
}

// ------------------------------------------------------------------ Filtres et fonctions (aide)

export const FILTRES = [
  { nom: "montant", syntaxe: "{{ prime.ttc | montant }}", rendu: "11 592 000", note: "Espaces insécables : le nombre ne se coupe jamais en fin de ligne. Les décimales reçues s'écrivent telles quelles (1 809,50)." },
  { nom: "lettres", syntaxe: "{{ prime.ttc | lettres }}", rendu: "onze millions cinq cent quatre-vingt-douze mille francs CFA", note: "Montant entier seulement." },
  { nom: "date", syntaxe: "{{ police.date_effet | date }}", rendu: "01/09/2026", note: "" },
  { nom: "dateheure", syntaxe: "{{ police.date_effet | dateheure }}", rendu: "01/09/2026 à 08h00", note: "La donnée doit contenir une heure." },
  { nom: "pct", syntaxe: "{{ f.taux_couverture | pct }}", rendu: "80 %", note: "Espace insécable avant %." },
  { nom: "case", syntaxe: '{{ (risque.statut == "PROPRIETAIRE") | case }} Propriétaire', rendu: "☒ Propriétaire", note: "Condition OBLIGATOIREMENT entre parenthèses : sans elles, case s'applique au seul texte \"PROPRIETAIRE\" et la case affichée est fausse (le dépôt est refusé)." },
] as const;

/** Filtres de Jinja également permis (« default » est exclu : il masquerait une donnée absente). */
export const FILTRES_JINJA = ["upper", "lower", "capitalize", "title", "trim", "length", "join", "first", "last"] as const;
