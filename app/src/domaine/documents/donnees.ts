import type { DateIso } from "../calcul/dates";
import { montant } from "../calcul/montant";
import type { Assure, Risque, Souscripteur } from "../cotation/saisie";
import { appliquerFacultatifs, champsInconnus, NON_FOURNI, type NonFourni } from "./dictionnaire";
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

const ou = <T,>(v: T | undefined | null): T | null => (v === undefined || v === "" ? null : v) as T | null;
/** Champ du souscripteur : non fourni s'il n'existe pas dans la saisie, vide s'il est saisi vide. */
const fourni = <T,>(v: T | undefined | null): T | null | NonFourni => (v === undefined ? NON_FOURNI : ou(v));

export function donneesDocument(s: SourceDocument): Record<string, unknown> {
  const sous = s.souscripteur as Souscripteur & Record<string, string | undefined>;
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
      prime: NON_FOURNI, // le moteur calcule par formule, pas par assuré
    })),
    beneficiaires: NON_FOURNI,
    contacts_urgence: NON_FOURNI,
    risque: s.risque,
    police: {
      numero: s.policeNumero,
      reference: NON_FOURNI,
      date_souscription: s.type === "COTATION" ? null : s.dateEmission,
      date_effet: s.dateEffet,
      date_echeance: s.dateEcheance,
      duree_jours: s.joursCouverts,
      duree_libelle: `${s.joursCouverts} jours`,
      type_contrat: s.typeContrat ?? NON_FOURNI,
      police_mere: NON_FOURNI,
      nantissement: NON_FOURNI,
    },
    formules: s.formules.map((f) => ({
      code: f.code,
      libelle: f.libelle,
      taux_couverture: f.tauxCouverture,
      effectif: f.effectif,
      prime_unitaire: f.primeUnitaire,
      prime_nette: f.nette,
      accessoires: f.accessoires,
      taxe: f.taxe,
      ttc: f.ttc,
    })),
    prime: {
      nette: s.totaux.nette,
      accessoires: s.totaux.accessoires,
      base_taxe: baseTaxe.toFixed(),
      taux_taxe: s.taxe.tauxPourcent,
      taxe: s.totaux.taxe,
      ttc: s.totaux.ttc,
      forcee: s.forcee,
      motif_forcage: s.motifForcage,
    },
    echeances: s.echeances.map((e) => ({ numero: e.numero, date: e.date, montant: e.montant, statut: "À payer" })),
    paiements: [],
    solde: { total_paye: "0", restant_du: s.totaux.ttc },
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
