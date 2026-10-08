import type { DateIso } from "../calcul/dates";
import { montant } from "../calcul/montant";
import type { Assure, Beneficiaire, ContactUrgence, Risque, Souscripteur } from "../cotation/saisie";
import { appliquerFacultatifs, champsInconnus, NON_FOURNI, type NonFourni } from "./dictionnaire";
import { libelleDuree } from "./duree";
import type { TypeDocument } from "./emission";
import type { MentionsDocument, Societe } from "./societe";

/**
 * Jeu de données d'un document (cotation, CP), dans les SEULS noms du dictionnaire (CDC §6.3).
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
  /** Prime d'un assuré de cette formule (d'une famille pour une formule « Famille »), calculée par le moteur : `primeParUnite`. */
  primeParAssure: string;
  nette: string;
  accessoires: string;
  taxe: string;
  ttc: string;
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
  risque: Risque;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  joursCouverts: number;
  formules: FormuleSource[];
  totaux: { nette: string; accessoires: string; taxe: string; ttc: string };
  taxe: { tauxPourcent: string; assiette: string };
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
  const baseTaxe = s.taxe.assiette === "NETTE" ? montant(s.totaux.nette) : montant(s.totaux.nette).plus(montant(s.totaux.accessoires));
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
    intermediaires: NON_FOURNI,
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
      formule: ou(a.formule),
      prime: certificat ? NON_FOURNI : primeDeLAssure(a, s.formules, s.ordresSansPrime), // H36 : pas de prime sur le certificat
    })),
    // null : jamais fournis (d'avant la 4a) → absents ; [] : saisis et laissés vides → liste vide (D19).
    beneficiaires:
      s.beneficiaires === null
        ? NON_FOURNI
        : s.beneficiaires.map((b) => ({ ordre: b.ordre, nom_prenoms: b.nom_prenoms, lien: ou(b.lien), contact: ou(b.contact), quote_part: b.quote_part })),
    contacts_urgence: s.contactsUrgence === null ? NON_FOURNI : s.contactsUrgence.map((u) => ({ nom_prenoms: u.nom_prenoms, contact: u.contact })),
    risque: s.risque,
    police: {
      numero: s.policeNumero,
      reference: NON_FOURNI,
      date_souscription: s.type === "COTATION" ? null : s.dateEmission,
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
    })),
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
    echeances: certificat ? NON_FOURNI : s.echeances.map((e) => ({ numero: e.numero, date: e.date, montant: e.montant, statut: "À payer" })),
    paiements: [],
    solde: certificat ? NON_FOURNI : { total_paye: "0", restant_du: s.totaux.ttc },
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
      facture_origine: null,
      auteur_nom: s.auteurNom,
    },
  };
  const { donnees: finales } = appliquerFacultatifs(donnees);
  const inconnus = champsInconnus(finales);
  if (inconnus.length > 0) throw new Error(`Données hors dictionnaire : ${inconnus.join(", ")}`);
  return finales;
}
