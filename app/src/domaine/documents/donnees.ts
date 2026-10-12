import type { DateIso } from "../calcul/dates";
import { montant } from "../calcul/montant";
import type { Assure, Beneficiaire, ContactUrgence, Risque, Souscripteur } from "../cotation/saisie";
import type { StatutEcheance } from "../facturation/echeances";
import type { IntermediaireDocument } from "../intermediaires";
import { appliquerFacultatifs, champsInconnus, NON_FOURNI, type NonFourni } from "./dictionnaire";
import { libelleDuree } from "./duree";
import type { TypeDocument } from "./emission";
import type { MentionsDocument, Societe } from "./societe";

/**
 * Jeu de données d'un document (cotation, CP, certificat, facture, avoir, reçu), dans les SEULS noms du dictionnaire (CDC §6.3).
 * Les montants viennent du moteur de calcul, déjà arrondis, en texte : rien n'est calculé ici, sauf
 * l'assiette de la taxe (somme de deux montants du moteur).
 *
 * Option b de H19 (D19) : une valeur connue mais vide vaut null et s'écrit vide. Une donnée que
 * l'application NE FOURNIT PAS (profession du souscripteur, bénéficiaires…) est marquée NON_FOURNI : elle
 * est rendue vide si le dictionnaire la déclare facultative, sinon elle est ABSENTE et un modèle qui
 * l'utilise ne se génère pas (le générateur nomme le champ).
 */

export type FormuleSource = {
  code: string;
  libelle: string;
  tauxCouverture: string | null;
  effectif: number;
  primeUnitaire: string;
  /**
   * Prime d'un assuré de cette formule (d'une famille pour une formule « Famille »), calculée par le moteur : TTC d'une unité
   * (`ttcParUnite`, H45 : 96 000 pour le Solo de T1, 260 000 pour la Famille).
   */
  primeParAssure: string;
  nette: string;
  accessoires: string;
  taxe: string;
  ttc: string;
};

/**
 * Une garantie souscrite d'un produit tarifé par garanties (session 6.2b, `garanties_souscrites[]`) : une ligne de prime composée par la
 * Technique, avec SON taux de taxe (résolu à la composition, figé) et ses montants arrondis par le module.
 */
export type GarantieSource = {
  libelle: string;
  branche: string;
  nette: string;
  accessoires: string;
  tauxTaxe: string;
  taxe: string;
  ttc: string;
  /** Assiette de la taxe de la ligne (nette + accessoires, ou nette seule selon la taxe de sa branche). */
  baseTaxe: string;
};

export type SourceDocument = {
  type: TypeDocument;
  numero: string;
  version: number;
  dateEmission: DateIso;
  dateValidite: DateIso | null;
  policeNumero: string | null;
  produit: { code: string; libelle: string; gamme: string; branche: string };
  cg: { libelle: string; visa: string; date: DateIso | null } | null;
  cs: { libelle: string; visa: string } | null;
  souscripteur: Souscripteur;
  assures: Assure[];
  /** Ordres des assurés dont la prime n'est pas dans le calcul de la police (adhérents incorporés après la liste initiale) : prime vide. */
  ordresSansPrime: number[];
  /** null : jamais fournis (cotation ou police d'avant la 4a) ; [] : saisis et laissés vides. */
  beneficiaires: Beneficiaire[] | null;
  contactsUrgence: ContactUrgence[] | null;
  /** Certificat d'adhésion : numéro de la police mère (police.police_mere) ; null pour un autre document. */
  policeMere: string | null;
  /** Intermédiaires de la cotation (0 à 2, session 6.0) ; absent : document qui ne les connaît pas (liste vide, D19). */
  intermediaires?: IntermediaireDocument[];
  risque: Risque;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  joursCouverts: number;
  formules: FormuleSource[];
  /** Produit en mode GARANTIES (session 6.2b) : une ligne par garantie souscrite. Absent ou vide : produit à la formule. */
  garanties?: GarantieSource[];
  /** `baseTaxe` : assiette totale de la taxe quand elle n'est pas déduite de l'assiette unique (composition, plusieurs assiettes possibles). */
  totaux: { nette: string; accessoires: string; taxe: string; ttc: string; baseTaxe?: string };
  /** `tauxPourcent` null : plusieurs taux de taxe dans le même document (composition par garanties) ; `prime.taux_taxe` est alors vide. */
  taxe: { tauxPourcent: string | null; assiette: string };
  echeances: { numero: number; date: DateIso; montant: string }[];
  forcee: boolean;
  motifForcage: string | null;
  societe: Societe;
  mentions: MentionsDocument;
  urlVerification: string | null;
  /** police.type_contrat ; null pour une cotation antérieure à la session 4.0. */
  typeContrat: string | null;
  /** doc.auteur_nom (D20) : nom de l'utilisateur qui a créé la cotation. */
  auteurNom: string;
  /**
   * Facture, avoir, reçu (session 4b, CDC §11, §12) : échéances avec leur statut Payé / Non payé, paiements, solde,
   * facture d'origine, « Envoyé à », date de souscription de la police. Absent pour les autres documents.
   */
  facturation?: Facturation;
};

export type Facturation = {
  /** Échéances de la facture : statut « Payé » / « Partiellement payé » / « Non payé », part payée et restant (session 6.1). */
  echeances: { numero: number; date: DateIso; montant: string; paye: string; restant: string; statut: StatutEcheance }[];
  paiements: { numero: string; date: DateIso; montant: string; reference: string; canal: string; payeur: string; restantDu: string }[];
  solde: { totalPaye: string; restantDu: string };
  /** solde.avance (D28) : avance disponible de la police au moment du document ; absent pour un avoir. */
  avance?: string;
  /** doc.facture_origine : facture annulée (avoir) ou réglée (reçu) ; null pour une facture. */
  factureOrigine: string | null;
  envoyeA: { nom: string; adresse: string } | null;
  dateSouscription: DateIso;
  /**
   * Avis d'échéance et relance (session 5b, D25) : l'échéance appelée et, pour une relance, son niveau. Absent pour
   * les autres documents : `echeance_appelee.*` et `relance.*` y sont non fournis.
   */
  appel?: {
    echeance: { numero: number; date: DateIso; montant: string; restantDu: string };
    relance: { niveau: number; libelle: string; joursRetard: number } | null;
  };
};

/**
 * Prime d'un assuré (`assures[].prime`) : celle que le moteur a calculée pour SA formule. Aucun calcul ici. Vide (null) quand
 * l'assuré n'a pas de formule, que sa formule n'est pas dans le calcul, ou qu'il a été incorporé après la liste initiale.
 */
export function primeDeLAssure(a: Pick<Assure, "ordre" | "formule">, formules: readonly Pick<FormuleSource, "code" | "primeParAssure">[], ordresSansPrime: readonly number[]): string | null {
  if (ordresSansPrime.includes(a.ordre)) return null;
  return formules.find((f) => f.code === a.formule)?.primeParAssure ?? null;
}

const ou = <T,>(v: T | undefined | null): T | null => (v === undefined || v === "" ? null : v) as T | null;
/** Champ du souscripteur : non fourni s'il n'existe pas dans la saisie, vide s'il est saisi vide. */
const fourni = <T,>(v: T | undefined | null): T | null | NonFourni => (v === undefined ? NON_FOURNI : ou(v));

export function donneesDocument(s: SourceDocument): Record<string, unknown> {
  const sous = s.souscripteur;
  // Certificat d'adhésion (§10.2) : pas de prime, d'échéancier ni de solde (H36) ; ils sont non fournis, donc
  // absents, et un modèle de certificat qui les utilise ne se génère pas (le générateur nomme le champ).
  const certificat = s.type === "CERTIFICAT";
  const assiette = (t: { nette: string; accessoires: string }) => (s.taxe.assiette === "NETTE" ? montant(t.nette) : montant(t.nette).plus(montant(t.accessoires)));
  const baseTaxe = s.totaux.baseTaxe !== undefined ? montant(s.totaux.baseTaxe) : assiette(s.totaux);
  const fa = s.facturation;
  const donnees = {
    societe: s.societe,
    produit: {
      ...s.produit,
      cg_libelle: s.cg?.libelle ?? null,
      cg_visa: s.cg?.visa ?? null,
      cg_date: s.cg?.date ?? null,
      cs_libelle: s.cs?.libelle ?? null,
      cs_visa: s.cs?.visa ?? null,
    },
    intermediaires: s.intermediaires ? s.intermediaires.map((i) => ({ nom: i.nom, code: i.code, role: i.role })) : NON_FOURNI,
    souscripteur: {
      type: sous.type,
      nom: ou(sous.nom),
      prenoms: ou(sous.prenoms),
      raison_sociale: ou(sous.raison_sociale),
      num_identification: fourni(sous.num_identification),
      date_naissance: fourni(sous.date_naissance),
      lieu_naissance: fourni(sous.lieu_naissance),
      profession: fourni(sous.profession),
      activite: fourni(sous.activite),
      employeur: fourni(sous.employeur),
      adresse: ou(sous.adresse),
      bp: fourni(sous.bp),
      localite: fourni(sous.localite),
      sous_prefecture: fourni(sous.sous_prefecture),
      telephone: ou(sous.telephone),
      whatsapp: fourni(sous.whatsapp),
      mobile_money: fourni(sous.mobile_money),
      email: ou(sous.email),
      situation_matrimoniale: fourni(sous.situation_matrimoniale),
      nb_enfants: fourni(sous.nb_enfants),
      groupe_sanguin: fourni(sous.groupe_sanguin),
    },
    assures: s.assures.map((a) => ({
      ordre: a.ordre,
      nom_prenoms: a.nom_prenoms,
      date_naissance: ou(a.date_naissance),
      sexe: ou(a.sexe),
      lien: ou(a.lien),
      num_identification: ou(a.num_identification ?? ""),
      formule: ou(a.formule),
      prime: certificat ? NON_FOURNI : primeDeLAssure(a, s.formules, s.ordresSansPrime), // H36 : pas de prime sur le certificat
    })),
    // null : jamais fournis (d'avant la 4a) → absents ; [] : saisis et laissés vides → liste vide (D19).
    beneficiaires:
      s.beneficiaires === null
        ? NON_FOURNI
        : s.beneficiaires.map((b) => ({ ordre: b.ordre, nom_prenoms: b.nom_prenoms, lien: ou(b.lien), contact: ou(b.contact), quote_part: b.quote_part })),
    contacts_urgence: s.contactsUrgence === null ? NON_FOURNI : s.contactsUrgence.map((u) => ({ nom_prenoms: u.nom_prenoms, contact: u.contact })),
    // « Envoyé à » (D23) : null, donc bloc masqué, s'il n'est pas saisi ou s'il est identique à « Facturé à ».
    envoye_a: fa?.envoyeA ? { nom: fa.envoyeA.nom, adresse: fa.envoyeA.adresse } : null,
    risque: s.risque,
    police: {
      numero: s.policeNumero,
      // La référence de la police est son numéro (réponse de la Technique, D27 ; H46 fermée).
      reference: s.policeNumero,
      date_souscription: fa ? fa.dateSouscription : s.type === "COTATION" ? null : s.dateEmission,
      date_effet: s.dateEffet,
      date_echeance: s.dateEcheance,
      duree_jours: s.joursCouverts,
      duree_libelle: libelleDuree(s.dateEffet, s.dateEcheance),
      type_contrat: s.typeContrat ?? NON_FOURNI,
      police_mere: s.policeMere ?? NON_FOURNI,
      nantissement: NON_FOURNI,
    },
    formules: s.formules.map((f) => ({
      code: f.code,
      libelle: f.libelle,
      taux_couverture: f.tauxCouverture,
      effectif: certificat ? NON_FOURNI : f.effectif,
      prime_unitaire: certificat ? NON_FOURNI : f.primeUnitaire,
      prime_nette: certificat ? NON_FOURNI : f.nette,
      accessoires: certificat ? NON_FOURNI : f.accessoires,
      taxe: certificat ? NON_FOURNI : f.taxe,
      ttc: certificat ? NON_FOURNI : f.ttc,
      base_taxe: certificat ? NON_FOURNI : assiette(f).toFixed(),
    })),
    // Une ligne par garantie souscrite (session 6.2b) ; liste vide pour un produit à la formule (champ facultatif).
    garanties_souscrites: certificat
      ? NON_FOURNI
      : (s.garanties ?? []).map((g) => ({ libelle: g.libelle, branche: g.branche, prime_nette: g.nette, accessoires: g.accessoires, taux_taxe: g.tauxTaxe, taxe: g.taxe, ttc: g.ttc })),
    prime: certificat
      ? NON_FOURNI
      : {
          nette: s.totaux.nette,
          accessoires: s.totaux.accessoires,
          base_taxe: baseTaxe.toFixed(),
          taux_taxe: s.taxe.tauxPourcent,
          taxe: s.totaux.taxe,
          ttc: s.totaux.ttc,
          forcee: s.forcee,
          motif_forcage: s.motifForcage,
        },
    echeances: certificat
      ? NON_FOURNI
      : fa
        ? fa.echeances.map((e) => ({ numero: e.numero, date: e.date, montant: e.montant, statut: e.statut, paye: e.paye, restant: e.restant }))
        : s.echeances.map((e) => ({ numero: e.numero, date: e.date, montant: e.montant, statut: "À payer", paye: "0", restant: e.montant })),
    paiements: (fa?.paiements ?? []).map((p) => ({ numero: p.numero, date: p.date, montant: p.montant, reference: p.reference, canal: p.canal, restant_du: p.restantDu, payeur: p.payeur })),
    solde: certificat
      ? NON_FOURNI
      : fa
        ? { total_paye: fa.solde.totalPaye, restant_du: fa.solde.restantDu, avance: fa.avance ?? NON_FOURNI }
        : { total_paye: "0", restant_du: s.totaux.ttc, avance: NON_FOURNI },
    echeance_appelee: fa?.appel
      ? { numero: fa.appel.echeance.numero, date: fa.appel.echeance.date, montant: fa.appel.echeance.montant, restant_du: fa.appel.echeance.restantDu }
      : NON_FOURNI,
    relance: fa?.appel?.relance ? { niveau: fa.appel.relance.niveau, libelle: fa.appel.relance.libelle, jours_retard: fa.appel.relance.joursRetard } : NON_FOURNI,
    doc: {
      type: s.type,
      numero: s.numero,
      version: `v${s.version}`,
      date_emission: s.dateEmission,
      lieu_emission: s.mentions.lieu_emission,
      date_validite: s.dateValidite,
      signataire_nom: ou(s.mentions.signataire_nom),
      signataire_fonction: ou(s.mentions.signataire_fonction),
      url_verification: s.urlVerification,
      // Un document ne peut pas contenir sa propre empreinte : elle est sur la page de vérification (H20).
      empreinte: NON_FOURNI,
      facture_origine: fa?.factureOrigine ?? null,
      auteur_nom: s.auteurNom,
    },
  };
  const { donnees: finales } = appliquerFacultatifs(donnees);
  const inconnus = champsInconnus(finales);
  if (inconnus.length > 0) throw new Error(`Données hors dictionnaire : ${inconnus.join(", ")}`);
  return finales;
}
