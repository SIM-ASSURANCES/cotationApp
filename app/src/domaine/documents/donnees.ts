import type { DateIso } from "../calcul/dates";
import { montant } from "../calcul/montant";
import type { Assure, Risque, Souscripteur } from "../cotation/saisie";
import { champsInconnus } from "./dictionnaire";
import type { TypeDocument } from "./emission";
import type { MentionsDocument, Societe } from "./societe";

/**
 * Jeu de données d'un document (cotation, CP), dans les SEULS noms du dictionnaire (CDC §6.3).
 * Les montants viennent du moteur de calcul, déjà arrondis, en texte : rien n'est calculé ici, sauf
 * l'assiette de la taxe (somme de deux montants du moteur).
 *
 * Tous les noms du dictionnaire sont présents : une valeur que l'application ne connaît pas (profession
 * du souscripteur, intermédiaires, nantissement…) vaut null et s'écrit vide (hypothèse H19). Un nom
 * ABSENT, lui, ferait échouer la fusion : il signale une erreur de programmation.
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
};

const ou = <T,>(v: T | undefined | null): T | null => (v === undefined || v === "" ? null : v) as T | null;

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
    intermediaires: [],
    souscripteur: {
      type: sous.type,
      nom: ou(sous.nom),
      prenoms: ou(sous.prenoms),
      raison_sociale: ou(sous.raison_sociale),
      num_identification: ou(sous.num_identification),
      date_naissance: ou(sous.date_naissance),
      lieu_naissance: ou(sous.lieu_naissance),
      profession: ou(sous.profession),
      activite: ou(sous.activite),
      employeur: ou(sous.employeur),
      adresse: ou(sous.adresse),
      bp: ou(sous.bp),
      localite: ou(sous.localite),
      sous_prefecture: ou(sous.sous_prefecture),
      telephone: ou(sous.telephone),
      whatsapp: ou(sous.whatsapp),
      mobile_money: ou(sous.mobile_money),
      email: ou(sous.email),
      situation_matrimoniale: ou(sous.situation_matrimoniale),
      nb_enfants: null,
      groupe_sanguin: ou(sous.groupe_sanguin),
    },
    assures: s.assures.map((a) => ({
      ordre: a.ordre,
      nom_prenoms: a.nom_prenoms,
      date_naissance: ou(a.date_naissance),
      sexe: ou(a.sexe),
      lien: ou(a.lien),
      formule: ou(a.formule),
      prime: null, // le moteur calcule par formule, pas par assuré
    })),
    beneficiaires: [],
    contacts_urgence: [],
    risque: s.risque,
    police: {
      numero: s.policeNumero,
      reference: null,
      date_souscription: s.type === "COTATION" ? null : s.dateEmission,
      date_effet: s.dateEffet,
      date_echeance: s.dateEcheance,
      duree_jours: s.joursCouverts,
      duree_libelle: `${s.joursCouverts} jours`,
      type_contrat: null,
      police_mere: null,
      nantissement: null,
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
      empreinte: null,
      facture_origine: null,
    },
  };
  const inconnus = champsInconnus(donnees);
  if (inconnus.length > 0) throw new Error(`Données hors dictionnaire : ${inconnus.join(", ")}`);
  return donnees;
}
