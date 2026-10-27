import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { calculerBareme, descripteurSaisie, risqueDuBareme, saisieDepuisFormulaire, versComposition, type DescripteurSaisie, type Saisie as SaisieBareme } from "@/domaine/bareme";
import { type ResultatCalcul } from "@/domaine/calcul/calcul";
import {
  LONGUEUR_MAX_MOTIF_COMPOSITION,
  LONGUEUR_MIN_MOTIF_COMPOSITION,
  estComposition,
  estCompositionBareme,
  estNonComposee,
  VERSION_COMPOSITION,
  type BaremeFige,
  type EntreeComposition,
  problemesLignesDePrime,
  recalculer,
  saisieDesLignes,
  type DonneesCalcul,
  type LigneComposee,
  type LigneDePrime,
} from "@/domaine/calcul/composition";
import { compositionPossible, MESSAGE_BROUILLON_A_FORMULES, MESSAGE_BROUILLON_A_FORMULES_BAREME, MESSAGE_TARIFICATION_AU_BAREME, problemesLibellesGaranties, type GarantieParametree } from "@/domaine/calcul/parametrage";
import { problemesDateEffetCotation, type DateIso } from "@/domaine/calcul/dates";
import type { Tranche } from "@/domaine/calcul/echeancier";
import { ErreurCalcul, montant } from "@/domaine/calcul/montant";
import { estContratDeGroupe } from "@/domaine/cotation/adherents";
import {
  problemesAssures,
  problemesBeneficiaires,
  problemesContactsUrgence,
  problemesLignes,
  problemesRisque,
  problemesSouscripteur,
  type Assure,
  type Beneficiaire,
  type ContactUrgence,
  type Risque,
  type Souscripteur,
  type SouscripteurComplements,
} from "@/domaine/cotation/saisie";
import {
  dateFinValidite,
  estStatut,
  filigraneDe,
  peutAccepter,
  peutEtreRenvoyee,
  peutEtreValidee,
  peutModifier,
  peutRefuser,
  statutEffectif,
  type StatutCotation,
} from "@/domaine/cotation/statuts";
import {
  detecterForcages,
  problemesForcage,
  raisonsDeValidation,
  valideurAutorise,
  type RaisonValidation,
} from "@/domaine/cotation/validation";
import { normaliserNumeroPolice, problemesNumeroPolice } from "@/domaine/cotation/police";
import { estRegimeTaxe, estTypeContrat, REGIME_PAR_DEFAUT, type RegimeTaxe, type TypeContrat } from "@/domaine/calcul/taxes";
import { peutAgir, peutLire, peutValider } from "@/domaine/droits";
import type { IntermediaireDocument } from "@/domaine/intermediaires";

import { journaliser, type ActeurAudit } from "./audit";
import { lireBaremePublie, parametresDeCalcul } from "./bareme";
import { versSouscripteur } from "./clients";
import { niveauDuProfil } from "./droits";
import { allouerNumero } from "./numerotation";
import {
  aujourdhui,
  construireComposition,
  construireEntree,
  executerCalcul,
  exigerModeCoherent,
  exigerModeCoherentEnVigueur,
  figerLesTaux,
  MESSAGE_NON_COMPOSEE,
  resoudreContexte,
  resoudreContexteBareme,
  resoudreContexteComposition,
  resoudreVersion,
  type LigneDemande,
  type VersionProduit,
} from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ecrireIntermediaires, resoudreIntermediaires, versIntermediairesDocument } from "./intermediaires";
import { lireFormatNumeroPolice, lireSeuilValidationGlobal } from "./societe";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------- Types

export type SaisieCotation = {
  codeProduit: string;
  clientId: number | null;
  /** police.type_contrat (documents). Texte lu dans le formulaire, contrôlé ici. */
  typeContrat: TypeContrat | string;
  /**
   * Régime de taxe (session 6.0, H29 fermée) : INDIVIDUEL ou GROUPE ; il choisit le taux. Obligatoire : le formulaire le
   * propose selon le type de contrat et l'envoie toujours ; absent (appel sans formulaire), c'est ce régime proposé.
   */
  regimeTaxe?: RegimeTaxe | string;
  souscripteur: Souscripteur;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  nombreTranches: number;
  lignes: LigneDemande[];
  /**
   * Produit en mode GARANTIES (session 6.2b) : lignes de prime composées par la Technique. Absent : aucune ligne à la création
   * (la prime reste « à composer »), lignes inchangées à la modification d'un brouillon. Seule l'action « Composer une prime » les
   * écrit. Toujours absent pour un produit à la formule.
   */
  composition?: LigneDePrime[];
  /**
   * Produit au barème (B6a, D51) : saisie du Commercial pour le moteur du barème (`bareme`, déjà typée), ou champs bruts du formulaire
   * (`baremeBrut`, convertis ici d'après le barème publié). Absente à la modification d'un brouillon : la saisie enregistrée est reprise.
   * Toujours absente pour un produit à la formule ou par garanties. Aucun montant ne vient de la saisie : tout vient du barème.
   */
  bareme?: SaisieBareme;
  baremeBrut?: { champs: Record<string, string[]>; souscrit: string[]; effectif?: string };
  motifForcage: string | null;
  assures: Assure[];
  /**
   * Bénéficiaires et contacts d'urgence (session 4a). `null` : jamais fournis (brouillon d'avant la 4a),
   * à conserver tel quel ; `[]` : saisis et laissés vides. Les formulaires envoient toujours un tableau.
   */
  beneficiaires: Beneficiaire[] | null;
  contactsUrgence: ContactUrgence[] | null;
  risque: Risque;
  /**
   * Codes des intermédiaires (0 à 2, session 6.0, H71 fermée), dans l'ordre de la saisie. Absent : aucun à la création,
   * inchangés à la modification d'un brouillon. Le formulaire les envoie toujours.
   */
  intermediaires?: string[];
};

/** Ce qu'on peut compléter à l'acceptation, quand on connaît enfin le souscripteur complet et ses bénéficiaires. */
export type ComplementsContrat = {
  /** Compléments du souscripteur (§6.3.2) : fusionnés sur le souscripteur de la cotation. */
  souscripteur: SouscripteurComplements;
  beneficiaires: Beneficiaire[];
  contactsUrgence: ContactUrgence[];
};

/**
 * Ligne stockée : le tarif ET la prime retenue, pour que le forçage reste visible ; la valeur des
 * accessoires du paramétrage ET celle saisie dans la cotation (H1). Les deux champs d'accessoires
 * sont absents d'une cotation antérieure à la session 4.0.
 */
type LigneStockee = { code: string; effectif: number; primeTarif: string; primeForcee: string | null; accessoireTarif?: string; accessoireSaisi?: string | null };

/** Montants arrondis, en texte, stockés avec la cotation (consultation et listes sans recalcul). */
type ResultatStocke = {
  joursCouverts: number;
  lignes: { code: string; effectif: number; nette: string; accessoires: string; taxe: string; ttc: string; ttcParUnite: string }[];
  fraisFractionnement: { accessoires: string; taxe: string; ttc: string } | null;
  totaux: { nette: string; accessoires: string; taxe: string; ttc: string };
};

function serialiser(r: ResultatCalcul): ResultatStocke {
  const t = (m: { toFixed(): string }) => m.toFixed();
  return {
    joursCouverts: r.joursCouverts,
    lignes: r.lignes.map((l) => ({
      code: l.code,
      effectif: l.effectif,
      nette: t(l.arrondi.nette),
      accessoires: t(l.arrondi.accessoires),
      taxe: t(l.arrondi.taxe),
      ttc: t(l.arrondi.ttc),
      ttcParUnite: t(l.ttcParUnite),
    })),
    fraisFractionnement: r.fraisFractionnement
      ? { accessoires: t(r.fraisFractionnement.arrondi.accessoires), taxe: t(r.fraisFractionnement.arrondi.taxe), ttc: t(r.fraisFractionnement.arrondi.ttc) }
      : null,
    totaux: { nette: t(r.totaux.arrondi.nette), accessoires: t(r.totaux.arrondi.accessoires), taxe: t(r.totaux.arrondi.taxe), ttc: t(r.totaux.arrondi.ttc) },
  };
}

const tranchesVersJson = (t: Tranche[] | null) => (t ? t.map((x) => ({ numero: x.numero, date: x.date, montant: x.montant.toFixed() })) : null);
const jsonVersTranches = (j: unknown): Tranche[] | null =>
  Array.isArray(j) ? (j as { numero: number; date: string; montant: string }[]).map((x) => ({ numero: x.numero, date: x.date, montant: montant(x.montant) })) : null;

// ---------------------------------------------------------------- Droits

async function exigerAgir(acteur: UtilisateurCourant): Promise<void> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, "CREER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : création de cotation.");
  }
}

async function exigerLecture(acteur: UtilisateurCourant): Promise<void> {
  if (!peutLire(await niveauDuProfil(acteur.profil, "CREER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : consultation des cotations.");
  }
}

// ---------------------------------------------------------------- Calcul d'une saisie

type Calcul = {
  versionDateEffet: DateIso;
  validiteMois: number;
  seuil: string | null;
  fractionnement: VersionProduit["fractionnement"];
  produitId: number;
  entree: DonneesCalcul;
  resultat: ResultatCalcul;
  echeancier: Tranche[] | null;
  lignesStockees: LigneStockee[];
  raisons: RaisonValidation[];
  souscripteur: Souscripteur;
  typeContrat: TypeContrat;
  regimeTaxe: RegimeTaxe;
  forcages: ReturnType<typeof detecterForcages>;
  /** Champs du barème résolus pour les balises `risque.<code>` (B6b) : s'ajoutent à ceux de la saisie, qu'ils remplacent s'ils portent le même nom. */
  risque?: Risque;
};

/**
 * Valide la saisie puis calcule avec les paramètres en vigueur à `dateDocument` : tout montant vient
 * du moteur, jamais de la saisie. Un forçage exige le droit « Demande » ou « Valide » ET un motif.
 */
async function calculerSaisie(tx: Tx, acteur: UtilisateurCourant, saisie: SaisieCotation, dateDocument: DateIso): Promise<Calcul> {
  const typeContrat = saisie.typeContrat;
  if (!estTypeContrat(typeContrat)) {
    throw new ErreurMetier("Choisissez le type de contrat (individuel, famille, groupe ou groupe ouvert) : il détermine le taux de taxe.");
  }
  const regimeTaxe = saisie.regimeTaxe ?? REGIME_PAR_DEFAUT[typeContrat];
  if (!estRegimeTaxe(regimeTaxe)) {
    throw new ErreurMetier("Choisissez le régime de taxe (individuel ou groupe) : il détermine le taux de taxe.");
  }
  // Le mode de la version en vigueur choisit la voie : calcul automatique (FORMULE) ou composition par la Technique (GARANTIES, 6.2b).
  const modeVersion = (await resoudreVersion(tx, saisie.codeProduit, dateDocument)).version.modeTarification;
  if (modeVersion === "BAREME") return calculerAuBareme(tx, saisie, dateDocument, typeContrat, regimeTaxe);
  if (saisie.bareme !== undefined || saisie.baremeBrut !== undefined) throw new ErreurMetier("Ce produit ne se tarife pas au barème : aucune saisie de barème n'est attendue.");
  const parGaranties = compositionPossible(modeVersion);
  if (parGaranties) return calculerComposition(tx, saisie, dateDocument, typeContrat, regimeTaxe);
  if ((saisie.composition ?? []).length > 0) throw new ErreurMetier("Ce produit se tarifie à la formule : la prime se calcule, elle ne se compose pas.");
  const contexte = await resoudreContexte(tx, saisie.codeProduit, dateDocument, saisie.dateEffet, regimeTaxe);
  const { version } = contexte;

  const souscripteur = await souscripteurDe(tx, saisie);
  const problemes = [
    ...problemesSouscripteur(souscripteur, dateDocument),
    ...problemesLignes(saisie.lignes, version.cotation.formulesMax),
    ...problemesAssures(saisie.assures, version.formules.map((f) => f.code), dateDocument),
    ...problemesBeneficiaires(saisie.beneficiaires ?? []),
    ...problemesContactsUrgence(saisie.contactsUrgence ?? []),
    ...problemesRisque(saisie.risque),
  ];
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

  const { entree, primesTarif, accessoiresTarif } = construireEntree(contexte, {
    dateEffet: saisie.dateEffet,
    dateEcheance: saisie.dateEcheance,
    lignes: saisie.lignes,
    nombreTranches: saisie.nombreTranches,
  });
  const forcages = detecterForcages(saisie.lignes.map((l) => ({ code: l.codeFormule, primeTarif: primesTarif[l.codeFormule], primeForcee: l.primeForcee ?? null })));
  const problemesDeForcage = problemesForcage(forcages, saisie.motifForcage);
  if (problemesDeForcage.length > 0) throw new ErreurMetier(problemesDeForcage.join(" "));
  if (forcages.length > 0 && !peutLire(await niveauDuProfil(acteur.profil, "FORCER_PRIME"))) {
    throw new ErreurAcces("Droit insuffisant : forçage de prime.");
  }

  const { resultat, echeancier } = executerCalcul(entree, version.fractionnement, saisie.nombreTranches);
  const seuilValidation = await lireSeuilValidationGlobal(saisie.dateEffet);
  return {
    versionDateEffet: version.dateEffet,
    validiteMois: version.cotation.validiteMois,
    seuil: seuilValidation,
    fractionnement: version.fractionnement,
    produitId: contexte.produit.id,
    entree,
    resultat,
    echeancier,
    lignesStockees: saisie.lignes.map((l) => ({
      code: l.codeFormule,
      effectif: l.effectif,
      primeTarif: primesTarif[l.codeFormule],
      primeForcee: forcages.some((f) => f.code === l.codeFormule) ? (l.primeForcee ?? null) : null,
      accessoireTarif: accessoiresTarif[l.codeFormule],
      // Une valeur saisie égale au paramétrage n'est pas une modification.
      accessoireSaisi: l.accessoireValeur != null && !montant(l.accessoireValeur).eq(montant(accessoiresTarif[l.codeFormule])) ? montant(l.accessoireValeur).toFixed() : null,
    })),
    raisons: raisonsDeValidation({ forcages, ttc: resultat.totaux.arrondi.ttc, seuil: seuilValidation }),
    souscripteur,
    typeContrat,
    regimeTaxe,
    forcages,
  };
}

/** Refus du barème (dont le message de la Technique, E4) : le premier message en titre, les autres dessous. */
const refusBareme = (refus: { message: string }[]) => new ErreurMetier(refus[0]?.message ?? "Le barème refuse cette saisie.", refus.slice(1).map((r) => r.message));

type CalculBareme = { contexte: Awaited<ReturnType<typeof resoudreContexteBareme>>; entree: EntreeComposition & { origine: "BAREME"; bareme: BaremeFige }; risque: Risque };

/**
 * Calcule la prime d'une saisie au barème PUBLIÉ de la version en vigueur à `dateDocument` : le moteur du barème rend les lignes de prime, le
 * taux de taxe de chaque catégorie est résolu à la date d'effet, et le tout est figé avec l'empreinte du barème et la saisie
 * (composition d'origine BAREME). `composer()` fera la taxe, l'arrondi et le TTC. Un refus du barème (contrôle E4, valeur absente d'une table,
 * champ obligatoire…) est une `ErreurMetier` qui porte le message de la Technique.
 */
async function lignesAuBareme(
  tx: Tx,
  demande: { codeProduit: string; dateDocument: DateIso; dateEffet: DateIso; dateEcheance: DateIso; regimeTaxe: RegimeTaxe; nombreTranches: number; bareme?: SaisieBareme; baremeBrut?: SaisieCotation["baremeBrut"] },
): Promise<CalculBareme> {
  const contexte = await resoudreContexteBareme(tx, demande.codeProduit, demande.dateDocument);
  const { version } = contexte;
  const { bareme, empreinte } = await lireBaremePublie(tx, version.id);
  const saisie = demande.bareme ?? (demande.baremeBrut ? saisieDepuisFormulaire(bareme, demande.baremeBrut) : undefined);
  if (!saisie) throw new ErreurMetier("Renseignez les champs du barème : la prime ne peut pas être calculée sans eux.");
  if (!Number.isInteger(demande.nombreTranches) || demande.nombreTranches < 1 || demande.nombreTranches > version.fractionnement.tranchesMax) {
    throw new ErreurMetier(`Ce produit autorise de 1 à ${version.fractionnement.tranchesMax} tranche(s).`);
  }
  if (demande.nombreTranches > 1 && !montant(version.fractionnement.frais).isZero()) {
    throw new ErreurMetier("Les frais de fractionnement de cette version ne s'ajoutent pas à une prime calculée au barème : demandez à la Technique une version sans frais.");
  }
  const parametres = await parametresDeCalcul(tx, version, bareme, demande.regimeTaxe, demande.dateEffet, demande.dateEcheance);
  let calcul;
  try {
    calcul = calculerBareme(bareme, saisie, parametres);
  } catch (erreur) {
    if (erreur instanceof ErreurCalcul) throw new ErreurMetier(erreur.message);
    throw erreur;
  }
  if (!calcul.ok) throw refusBareme(calcul.refus);
  const lignes: LigneComposee[] = versComposition(calcul.lignes, parametres).lignes;
  const entree: CalculBareme["entree"] = {
    type: "COMPOSITION",
    version: VERSION_COMPOSITION,
    dateEffet: demande.dateEffet,
    dateEcheance: demande.dateEcheance,
    arrondi: version.arrondi,
    lignes,
    origine: "BAREME",
    bareme: { versionId: version.id, empreinte, saisie },
  };
  return { contexte, entree, risque: risqueDuBareme(bareme, saisie) };
}

/**
 * Voie du barème (produit en mode BAREME, B6a). Pas de formule, pas de forçage (B7), PAS de secours par composition manuelle (réponse de la
 * Technique à Q3 : refus sans exception, H133) : un risque que le barème refuse ne s'assure pas.
 */
async function calculerAuBareme(tx: Tx, saisie: SaisieCotation, dateDocument: DateIso, typeContrat: TypeContrat, regimeTaxe: RegimeTaxe): Promise<Calcul> {
  if ((saisie.composition ?? []).length > 0) throw new ErreurMetier(MESSAGE_TARIFICATION_AU_BAREME);
  if (saisie.lignes.length > 0) throw new ErreurMetier(MESSAGE_BROUILLON_A_FORMULES_BAREME);
  const souscripteur = await souscripteurDe(tx, saisie);
  const problemes = [
    ...problemesSouscripteur(souscripteur, dateDocument),
    ...problemesAssures(saisie.assures, [], dateDocument),
    ...problemesBeneficiaires(saisie.beneficiaires ?? []),
    ...problemesContactsUrgence(saisie.contactsUrgence ?? []),
    ...problemesRisque(saisie.risque),
  ];
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const { contexte, entree, risque } = await lignesAuBareme(tx, {
    codeProduit: saisie.codeProduit,
    dateDocument,
    dateEffet: saisie.dateEffet,
    dateEcheance: saisie.dateEcheance,
    regimeTaxe,
    nombreTranches: saisie.nombreTranches,
    bareme: saisie.bareme,
    baremeBrut: saisie.baremeBrut,
  });
  const { version } = contexte;
  const { resultat, echeancier } = executerCalcul(entree, version.fractionnement, saisie.nombreTranches);
  const seuilValidation = await lireSeuilValidationGlobal(saisie.dateEffet);
  return {
    versionDateEffet: version.dateEffet,
    validiteMois: version.cotation.validiteMois,
    seuil: seuilValidation,
    fractionnement: version.fractionnement,
    produitId: contexte.produit.id,
    entree,
    resultat,
    echeancier,
    lignesStockees: [],
    raisons: raisonsDeValidation({ forcages: [], ttc: resultat.totaux.arrondi.ttc, seuil: seuilValidation }),
    souscripteur,
    typeContrat,
    regimeTaxe,
    forcages: [],
    risque,
  };
}

/** Résultat du bouton « Calculer » : lignes de composition arrondies et totaux, rien n'est enregistré. */
export type ResultatCalculBareme = {
  empreinte: string;
  lignes: { libelle: string; branche: string; montantGaranti: string | null; nette: string; accessoires: string; taxe: string; ttc: string }[];
  totaux: { nette: string; accessoires: string; taxe: string; ttc: string };
};

/**
 * Bouton « Calculer » de l'écran de cotation au barème : mêmes règles que l'enregistrement (c'est le même calcul), sans rien écrire.
 * Le résultat d'un calcul n'est jamais lu par l'enregistrement : le serveur recalcule toujours depuis la saisie.
 */
export async function calculerCotationBareme(
  acteur: UtilisateurCourant,
  demande: { codeProduit: string; typeContrat: string; regimeTaxe: string; dateEffet: DateIso; dateEcheance: DateIso; nombreTranches: number; baremeBrut: NonNullable<SaisieCotation["baremeBrut"]> },
): Promise<ResultatCalculBareme> {
  await exigerAgir(acteur);
  const problemesDateEffet = problemesDateEffetCotation(demande.dateEffet);
  if (problemesDateEffet.length > 0) throw new ErreurMetier(problemesDateEffet.join(" "));
  const regime = estRegimeTaxe(demande.regimeTaxe) ? demande.regimeTaxe : estTypeContrat(demande.typeContrat) ? REGIME_PAR_DEFAUT[demande.typeContrat] : undefined;
  if (regime === undefined) throw new ErreurMetier("Choisissez le type de contrat et le régime de taxe avant de calculer : ils déterminent le taux de taxe.");
  return obtenirPrisma().$transaction(async (tx) => {
    const { entree } = await lignesAuBareme(tx, { ...demande, dateDocument: aujourdhui(), regimeTaxe: regime });
    let resultat: ResultatCalcul;
    try {
      resultat = executerCalcul(entree, { repartitionPourcent: null, decalagesMois: null }, 1).resultat;
    } catch (erreur) {
      if (erreur instanceof ErreurCalcul) throw new ErreurMetier(erreur.message);
      throw erreur;
    }
    const t = (m: { toFixed(): string }) => m.toFixed();
    const a = resultat.totaux.arrondi;
    return {
      empreinte: entree.bareme.empreinte,
      lignes: resultat.lignes.map((l, i) => ({
        libelle: entree.lignes[i].libelle,
        branche: entree.lignes[i].branche,
        montantGaranti: entree.lignes[i].montantGaranti ?? null,
        nette: t(l.arrondi.nette),
        accessoires: t(l.arrondi.accessoires),
        taxe: t(l.arrondi.taxe),
        ttc: t(l.arrondi.ttc),
      })),
      totaux: { nette: t(a.nette), accessoires: t(a.accessoires), taxe: t(a.taxe), ttc: t(a.ttc) },
    };
  });
}

/**
 * Descripteur de l'écran de cotation d'un produit au barème : blocs, champs et choix de souscription du barème PUBLIÉ de la version en
 * vigueur aujourd'hui (jamais de taux ni de table : le Commercial ne voit pas le tarif).
 */
export async function lireDescripteurBareme(acteur: UtilisateurCourant, codeProduit: string): Promise<{ descripteur: DescripteurSaisie; empreinte: string }> {
  await exigerAgir(acteur);
  const { version } = await resoudreContexteBareme(obtenirPrisma(), codeProduit, aujourdhui());
  const { bareme, empreinte } = await lireBaremePublie(obtenirPrisma(), version.id);
  return { descripteur: descripteurSaisie(bareme), empreinte };
}

/** Souscripteur de la cotation : celui du client choisi (copie) ou celui saisi. */
async function souscripteurDe(tx: Tx, saisie: SaisieCotation): Promise<Souscripteur> {
  if (saisie.clientId === null) return saisie.souscripteur;
  const client = await tx.client.findUnique({ where: { id: saisie.clientId } });
  if (!client) throw new ErreurMetier("Client introuvable.");
  return versSouscripteur(client);
}

/**
 * Voie de la composition manuelle (produit en mode GARANTIES, session 6.2b). Aucune formule, aucun forçage : les lignes de prime sont
 * celles de la Technique, aux taux de leur branche (résolus ici, à la date d'effet, et figés). Sans ligne, la cotation est « à composer » :
 * des montants nuls, jamais émissibles (le contrôle est dans `soumettre` et `emettre`).
 */
async function calculerComposition(tx: Tx, saisie: SaisieCotation, dateDocument: DateIso, typeContrat: TypeContrat, regimeTaxe: RegimeTaxe): Promise<Calcul> {
  const contexte = await resoudreContexteComposition(tx, saisie.codeProduit, dateDocument);
  const { version } = contexte;
  const souscripteur = await souscripteurDe(tx, saisie);
  const lignesSaisies: LigneDePrime[] = (saisie.composition ?? []).map((l) => {
    const g = (version.garanties ?? []).find((x) => x.libelle.trim().toLowerCase() === l.libelle.trim().toLowerCase());
    const montantGaranti = l.montantGaranti !== undefined ? l.montantGaranti : g?.montantGaranti;
    const accessoires = l.accessoires !== undefined && l.accessoires.trim() !== "" ? l.accessoires : (g?.accessoires ?? "0");
    return {
      ...l,
      ...(montantGaranti !== undefined ? { montantGaranti } : {}),
      accessoires,
    };
  });
  const problemes = [
    ...problemesSouscripteur(souscripteur, dateDocument),
    ...(saisie.lignes.length > 0 ? [MESSAGE_BROUILLON_A_FORMULES] : []),
    ...problemesAssures(saisie.assures, [], dateDocument),
    ...problemesBeneficiaires(saisie.beneficiaires ?? []),
    ...problemesContactsUrgence(saisie.contactsUrgence ?? []),
    ...problemesRisque(saisie.risque),
    ...problemesLignesDePrime(lignesSaisies, { exiger: false }),
    ...problemesLibellesGaranties(version, lignesSaisies.map((l) => l.libelle)),
  ];
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

  const lignes: LigneComposee[] = await figerLesTaux(tx, lignesSaisies, regimeTaxe, saisie.dateEffet);
  const entree = construireComposition(contexte, { dateEffet: saisie.dateEffet, dateEcheance: saisie.dateEcheance, lignes, nombreTranches: saisie.nombreTranches });
  const { resultat, echeancier } = executerCalcul(entree, version.fractionnement, lignes.length > 0 ? saisie.nombreTranches : 1);
  const seuilValidation = await lireSeuilValidationGlobal(saisie.dateEffet);
  return {
    versionDateEffet: version.dateEffet,
    validiteMois: version.cotation.validiteMois,
    seuil: seuilValidation,
    fractionnement: version.fractionnement,
    produitId: contexte.produit.id,
    entree,
    resultat,
    echeancier,
    lignesStockees: [],
    // Les seuils de validation s'appliquent au TTC de la composition ; il n'y a pas de tarif, donc pas de forçage.
    raisons: raisonsDeValidation({ forcages: [], ttc: resultat.totaux.arrondi.ttc, seuil: seuilValidation }),
    souscripteur,
    typeContrat,
    regimeTaxe,
    forcages: [],
  };
}

/** Valeur des accessoires effectivement retenue pour une ligne stockée (saisie, sinon paramétrage). */
const accessoireRetenu = (l: LigneStockee): string | null => l.accessoireSaisi ?? l.accessoireTarif ?? null;

/**
 * H1 (D18) : chaque modification des accessoires est journalisée, avant/après. À la création, « avant »
 * est la valeur du paramétrage ; ensuite, la valeur retenue jusque-là.
 */
async function journaliserAccessoires(tx: Tx, acteur: UtilisateurCourant, id: number, avant: LigneStockee[] | null, apres: LigneStockee[], adresseIp: string | null): Promise<void> {
  const changements = apres
    .map((l) => {
      const precedente = avant?.find((x) => x.code === l.code);
      const valeurAvant = precedente ? accessoireRetenu(precedente) : (l.accessoireTarif ?? null);
      return { code: l.code, avant: valeurAvant, apres: accessoireRetenu(l), parametrage: l.accessoireTarif ?? null };
    })
    .filter((c) => c.avant !== c.apres && !(c.avant !== null && c.apres !== null && montant(c.avant).eq(montant(c.apres))));
  if (changements.length === 0) return;
  await journaliser(
    {
      acteur: auteur(acteur),
      action: "ACCESSOIRES_MODIFIES",
      objetType: "cotation",
      objetId: id,
      avant: Object.fromEntries(changements.map((c) => [c.code, c.avant])),
      apres: Object.fromEntries(changements.map((c) => [c.code, c.apres])),
      adresseIp,
    },
    tx,
  );
}

/** TTC à journaliser : une prime « à composer » n'a pas de TTC (jamais un « 0 » qui passerait pour un montant). */
const ttcAJournaliser = (c: Calcul): string | null => (estNonComposee(c.entree) ? null : c.resultat.totaux.arrondi.ttc.toFixed());

/** Colonne JSON facultative : « jamais fournie » s'écrit NULL en base, « saisie vide » s'écrit []. */
const listeOuNull = (liste: unknown[] | null) => (liste === null ? Prisma.DbNull : (liste as unknown as Prisma.InputJsonValue));

function donneesAEcrire(saisie: SaisieCotation, c: Calcul) {
  return {
    produitId: c.produitId,
    versionDateEffet: versDate(c.versionDateEffet),
    clientId: saisie.clientId,
    typeContrat: c.typeContrat,
    regimeTaxe: c.regimeTaxe,
    souscripteur: c.souscripteur as unknown as Prisma.InputJsonValue,
    dateEffet: versDate(saisie.dateEffet),
    dateEcheance: versDate(saisie.dateEcheance),
    nombreTranches: saisie.nombreTranches,
    lignes: c.lignesStockees as unknown as Prisma.InputJsonValue,
    motifForcage: c.forcages.length > 0 ? (saisie.motifForcage ?? "").trim() : null,
    assures: saisie.assures as unknown as Prisma.InputJsonValue,
    beneficiaires: listeOuNull(saisie.beneficiaires),
    contactsUrgence: listeOuNull(saisie.contactsUrgence),
    risque: { ...saisie.risque, ...c.risque } as unknown as Prisma.InputJsonValue,
    donneesCalcul: c.entree as unknown as Prisma.InputJsonValue,
    resultat: serialiser(c.resultat) as unknown as Prisma.InputJsonValue,
    // Une prime « à composer » n'a pas de TTC (jamais un 0 affiché comme un montant).
    ttcTotal: estNonComposee(c.entree) ? null : c.resultat.totaux.arrondi.ttc.toFixed(),
    // Explicite : `undefined` voudrait dire « ne pas toucher » et laisserait l'échéancier d'une saisie précédente quand on repasse à une tranche.
    echeancier: c.echeancier ? (tranchesVersJson(c.echeancier) as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    raisonsValidation: c.raisons as unknown as Prisma.InputJsonValue,
  };
}

// ---------------------------------------------------------------- Brouillon

export async function creerBrouillon(acteur: UtilisateurCourant, saisie: SaisieCotation, adresseIp: string | null): Promise<number> {
  await exigerAgir(acteur);
  const problemesDateEffet = problemesDateEffetCotation(saisie.dateEffet);
  if (problemesDateEffet.length > 0) throw new ErreurMetier(problemesDateEffet.join(" "));
  return obtenirPrisma().$transaction(async (tx) => {
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    const intermediaires = await resoudreIntermediaires(tx, saisie.intermediaires ?? []);
    const cree = await tx.cotation.create({
      data: { ...donneesAEcrire(saisie, c), statut: "BROUILLON", auteurId: acteur.id, auteurIdentifiant: acteur.identifiant, contributeurs: [acteur.id] },
    });
    await ecrireIntermediaires(tx, cree.id, intermediaires);
    await journaliser(
      {
        acteur: auteur(acteur),
        action: "COTATION_CREEE",
        objetType: "cotation",
        objetId: cree.id,
        apres: { produit: saisie.codeProduit, typeContrat: c.typeContrat, regimeTaxe: c.regimeTaxe, intermediaires: intermediaires.map((i) => i.code), ttc: ttcAJournaliser(c) },
        adresseIp,
      },
      tx,
    );
    await journaliserAccessoires(tx, acteur, cree.id, null, c.lignesStockees, adresseIp);
    return cree.id;
  });
}

/**
 * Verrou de la ligne de la cotation jusqu'à la fin de la transaction : modification, composition, soumission, validation et renvoi
 * en brouillon passent l'un après l'autre (sinon une soumission pourrait écrire par-dessus une composition faite entre-temps).
 */
async function verrouillerCotation(tx: Tx, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM cotations WHERE id = ${id} FOR UPDATE`;
}

/**
 * H9 (D18) : tout utilisateur qui a le droit de créer (donc de modifier) une cotation peut modifier ou
 * soumettre un brouillon, pas seulement son auteur. Le droit est contrôlé par l'appelant (exigerAgir).
 */
async function chargerPourModification(tx: Tx, id: number) {
  await verrouillerCotation(tx, id);
  const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
  if (!cotation) throw new ErreurMetier("Cotation introuvable.");
  if (!peutModifier(cotation.statut as StatutCotation)) {
    throw new ErreurMetier("Cette cotation n'est plus un brouillon : elle est figée.");
  }
  return cotation;
}

/**
 * Modifie un brouillon. Renvoie `compositionVidee` : vrai quand la modification a vidé la composition de la prime (H98, décision de Thierry
 * après la 6.2b) : un changement de PÉRIODE, de RÉGIME DE TAXE ou de TYPE DE CONTRAT d'un brouillon composé le fait revenir à « À composer »
 * (les montants saisis valaient pour les conditions d'origine, sans prorata). L'ancienne composition, avec son auteur et son motif, est gardée
 * au journal (`COTATION_COMPOSITION_VIDEE`). Un changement du nombre de tranches garde la composition (seul l'échéancier change).
 */
export async function modifierBrouillon(acteur: UtilisateurCourant, id: number, saisie: SaisieCotation, adresseIp: string | null): Promise<{ compositionVidee: boolean }> {
  await exigerAgir(acteur);
  const problemesDateEffet = problemesDateEffetCotation(saisie.dateEffet);
  if (problemesDateEffet.length > 0) throw new ErreurMetier(problemesDateEffet.join(" "));
  return obtenirPrisma().$transaction(async (tx) => {
    const avant = await chargerPourModification(tx, id);
    if (avant.produit.code !== saisie.codeProduit) throw new ErreurMetier("Le produit d'une cotation ne se change pas : créez une nouvelle cotation.");
    // Qui modifie un brouillon composé (souscripteur, dates, assurés…) ne touche pas à la composition : ses lignes sont reprises telles quelles,
    // leurs taux sont résolus de nouveau à la (nouvelle) date d'effet. Seule l'action « Composer une prime » change les lignes.
    const anciennes = avant.donneesCalcul as unknown as DonneesCalcul | null;
    // Un brouillon préparé avec des formules ne se convertit pas en brouillon « à composer » (H89) : l'écran de modification d'un produit passé
    // « par garanties » n'envoie plus de formule, donc ce n'est pas le contenu de la saisie qui le trahit, mais la nature de l'enregistré.
    const modeEnVigueur = (await resoudreVersion(tx, saisie.codeProduit, aujourdhui())).version.modeTarification;
    if (anciennes && !estComposition(anciennes) && compositionPossible(modeEnVigueur)) throw new ErreurMetier(MESSAGE_BROUILLON_A_FORMULES);
    if (anciennes && !estComposition(anciennes) && modeEnVigueur === "BAREME") throw new ErreurMetier(MESSAGE_BROUILLON_A_FORMULES_BAREME);
    // H98 : qu'est-ce qui change, parmi ce dont dépendent les montants composés ?
    const raisonsDeVidage: string[] = [];
    // Une composition d'origine BAREME n'est jamais « vidée » : elle est recalculée du barème à chaque enregistrement (période, régime, saisie).
    const deBareme = anciennes !== null && estCompositionBareme(anciennes);
    if (anciennes && estComposition(anciennes) && !deBareme && anciennes.lignes.length > 0) {
      const regimeApres = saisie.regimeTaxe ?? (estTypeContrat(saisie.typeContrat) ? REGIME_PAR_DEFAUT[saisie.typeContrat] : undefined);
      if (depuisDate(avant.dateEffet) !== saisie.dateEffet || depuisDate(avant.dateEcheance) !== saisie.dateEcheance) raisonsDeVidage.push("la période");
      if (avant.typeContrat !== saisie.typeContrat) raisonsDeVidage.push("le type de contrat");
      if (avant.regimeTaxe !== null && regimeApres !== undefined && regimeApres !== avant.regimeTaxe) raisonsDeVidage.push("le régime de taxe");
    }
    const compositionVidee = raisonsDeVidage.length > 0;
    if (compositionVidee) saisie = { ...saisie, composition: [] };
    else if (deBareme) {
      if (saisie.bareme === undefined && saisie.baremeBrut === undefined) saisie = { ...saisie, bareme: anciennes.bareme.saisie };
    } else if (saisie.composition === undefined && anciennes && estComposition(anciennes)) saisie = { ...saisie, composition: saisieDesLignes(anciennes.lignes) };
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    const intermediairesAvant = (await tx.cotationIntermediaire.findMany({ where: { cotationId: id }, orderBy: { ordre: "asc" } })).map((i) => i.code);
    const intermediaires = saisie.intermediaires === undefined ? null : await resoudreIntermediaires(tx, saisie.intermediaires, intermediairesAvant);
    // Qui a modifié un brouillon ne pourra pas le valider (séparation des tâches renforcée, H9).
    const contributeurs = avant.contributeurs.includes(acteur.id) ? avant.contributeurs : [...avant.contributeurs, acteur.id];
    await tx.cotation.update({
      where: { id },
      data: { ...donneesAEcrire(saisie, c), contributeurs, ...(compositionVidee ? { compositionParId: null, compositionPar: null, compositionLe: null, compositionMotif: null } : {}) },
    });
    if (intermediaires !== null) await ecrireIntermediaires(tx, id, intermediaires);
    if (compositionVidee && anciennes && estComposition(anciennes)) {
      await journaliser(
        {
          acteur: auteur(acteur),
          action: "COTATION_COMPOSITION_VIDEE",
          objetType: "cotation",
          objetId: id,
          avant: { lignes: anciennes.lignes, ttc: avant.ttcTotal?.toFixed() ?? null, composePar: avant.compositionPar, composeLe: avant.compositionLe?.toISOString() ?? null, motif: avant.compositionMotif },
          apres: { raison: raisonsDeVidage.join(", "), retour: "À composer" },
          adresseIp,
        },
        tx,
      );
    }
    await journaliser(
      {
        acteur: auteur(acteur),
        action: "COTATION_MODIFIEE",
        objetType: "cotation",
        objetId: id,
        avant: {
          ttc: avant.ttcTotal?.toFixed() ?? null,
          typeContrat: avant.typeContrat,
          regimeTaxe: avant.regimeTaxe,
          // La période et le nombre de tranches comptent pour une prime composée (aucun prorata : les montants sont ceux de la période, H93).
          dateEffet: depuisDate(avant.dateEffet),
          dateEcheance: depuisDate(avant.dateEcheance),
          nombreTranches: avant.nombreTranches,
          intermediaires: intermediairesAvant,
        },
        apres: {
          ttc: ttcAJournaliser(c),
          typeContrat: c.typeContrat,
          regimeTaxe: c.regimeTaxe,
          dateEffet: saisie.dateEffet,
          dateEcheance: saisie.dateEcheance,
          nombreTranches: saisie.nombreTranches,
          intermediaires: intermediaires === null ? intermediairesAvant : intermediaires.map((i) => i.code),
          auteurDuBrouillon: avant.auteurIdentifiant,
        },
        adresseIp,
      },
      tx,
    );
    await journaliserAccessoires(tx, acteur, id, avant.lignes as unknown as LigneStockee[], c.lignesStockees, adresseIp);
    return { compositionVidee };
  });
}

/** Reconstitue la saisie d'une cotation enregistrée (soumission, composition) : ce qui est stocké, rien d'autre. */
function saisieDepuisCotation(cotation: Prisma.CotationGetPayload<{ include: { produit: true } }>): SaisieCotation {
  const lignes = cotation.lignes as unknown as LigneStockee[];
  const donnees = cotation.donneesCalcul as unknown as DonneesCalcul | null;
  return {
    codeProduit: cotation.produit.code,
    clientId: cotation.clientId,
    typeContrat: cotation.typeContrat as TypeContrat,
    // Le régime de taxe enregistré ; une cotation d'avant la session 6.0 n'en a pas : le régime proposé pour son type de contrat.
    regimeTaxe: cotation.regimeTaxe ?? undefined,
    souscripteur: cotation.souscripteur as unknown as Souscripteur,
    dateEffet: depuisDate(cotation.dateEffet),
    dateEcheance: depuisDate(cotation.dateEcheance),
    nombreTranches: cotation.nombreTranches,
    lignes: lignes.map((l) => ({ codeFormule: l.code, effectif: l.effectif, primeForcee: l.primeForcee, accessoireValeur: l.accessoireSaisi ?? null })),
    composition: donnees && estComposition(donnees) && !estCompositionBareme(donnees) ? saisieDesLignes(donnees.lignes) : undefined,
    ...(donnees && estCompositionBareme(donnees) ? { bareme: donnees.bareme.saisie } : {}),
    motifForcage: cotation.motifForcage,
    assures: cotation.assures as unknown as Assure[],
    beneficiaires: (cotation.beneficiaires as unknown as Beneficiaire[] | null) ?? null,
    contactsUrgence: (cotation.contactsUrgence as unknown as ContactUrgence[] | null) ?? null,
    risque: cotation.risque as unknown as Risque,
  };
}

// ---------------------------------------------------------------- Composition manuelle de la prime (session 6.2b)

/**
 * La Technique compose la prime d'un brouillon de produit tarifé par garanties : une ligne par garantie souscrite (libellé, branche
 * fiscale, prime nette, accessoires). Le module résout le taux de taxe de chaque ligne (branche, régime de taxe de la cotation, date d'effet :
 * même résolution que le calcul automatique), calcule la taxe, arrondit selon la règle du produit et totalise.
 *
 * Droit « Composer une prime » (Technique : Oui). MOTIF OBLIGATOIRE ; composition journalisée avant / après. Qui compose est ajouté aux
 * contributeurs du brouillon : il ne pourra pas valider cette cotation (T13, H9). Brouillon seulement : une cotation « À valider » se renvoie
 * d'abord en brouillon. Remplace entièrement les lignes précédentes.
 */
export async function composerLaPrime(acteur: UtilisateurCourant, id: number, lignes: LigneDePrime[], motif: string, adresseIp: string | null): Promise<{ ttc: string }> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, "COMPOSER_PRIME"))) {
    throw new ErreurAcces("Droit insuffisant : composition de la prime.");
  }
  const motifPropre = motif.trim();
  if (motifPropre.length < LONGUEUR_MIN_MOTIF_COMPOSITION) throw new ErreurMetier(`Le motif de la composition est obligatoire (${LONGUEUR_MIN_MOTIF_COMPOSITION} caractères au moins).`);
  if (motifPropre.length > LONGUEUR_MAX_MOTIF_COMPOSITION) throw new ErreurMetier(`Le motif de la composition est trop long (${LONGUEUR_MAX_MOTIF_COMPOSITION} caractères au plus).`);
  if (lignes.length === 0) throw new ErreurMetier("Saisissez au moins une ligne de prime.");

  return obtenirPrisma().$transaction(async (tx) => {
    const avant = await chargerPourModification(tx, id);
    if (avant.typeContrat === null) {
      throw new ErreurMetier("Ce brouillon date d'avant le choix du type de contrat : modifiez-le pour indiquer le type de contrat, puis composez la prime.");
    }
    const anciennes = avant.donneesCalcul as unknown as DonneesCalcul | null;
    const saisie: SaisieCotation = { ...saisieDepuisCotation(avant), composition: lignes };
    // refuse un produit qui n'est pas en mode GARANTIES (la prime d'une formule ne se compose pas)
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    if (!estComposition(c.entree)) throw new ErreurMetier("Ce produit se tarifie à la formule : la prime se calcule, elle ne se compose pas.");
    const contributeurs = avant.contributeurs.includes(acteur.id) ? avant.contributeurs : [...avant.contributeurs, acteur.id];
    const maintenant = new Date();
    await tx.cotation.update({
      where: { id },
      data: { ...donneesAEcrire(saisie, c), contributeurs, compositionParId: acteur.id, compositionPar: acteur.identifiant, compositionLe: maintenant, compositionMotif: motifPropre },
    });
    const ttc = c.resultat.totaux.arrondi.ttc.toFixed();
    await journaliser(
      {
        acteur: auteur(acteur),
        action: "COTATION_COMPOSEE",
        objetType: "cotation",
        objetId: id,
        avant: { lignes: anciennes && estComposition(anciennes) ? anciennes.lignes : [], ttc: avant.ttcTotal?.toFixed() ?? null, composePar: avant.compositionPar, motif: avant.compositionMotif },
        apres: { lignes: (c.entree as { lignes: LigneComposee[] }).lignes, ttc, motif: motifPropre, contributeurs: contributeurs.length },
        adresseIp,
      },
      tx,
    );
    return { ttc };
  });
}

// ---------------------------------------------------------------- Émission

type CotationChargee = Prisma.CotationGetPayload<{ include: { produit: true } }>;

/** Attribue le numéro et fige la cotation. Appelée dans la transaction de la soumission ou de la validation. */
async function emettre(tx: Tx, acteur: UtilisateurCourant, cotation: CotationChargee, adresseIp: string | null, valideur: UtilisateurCourant | null): Promise<string> {
  const aujourdhuiIso = aujourdhui();
  const version = await tx.produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId: cotation.produitId, dateEffet: cotation.versionDateEffet } },
  });
  // Sessions 6.2a et 6.2b : la nature du calcul figé (automatique ou composition) doit correspondre au mode de la version. Deux contrôles :
  // la version figée de la cotation (ceinture) et la version EN VIGUEUR aujourd'hui (une cotation « À valider » d'avant une bascule de mode
  // ne s'émet plus). Une composition vide (prime « à composer ») ne s'émet jamais.
  const donnees = cotation.donneesCalcul as unknown as DonneesCalcul;
  exigerModeCoherent(version.modeTarification, donnees);
  await exigerModeCoherentEnVigueur(tx, cotation.produitId, aujourdhuiIso, donnees);
  const numero = await allouerNumero(tx, "COT", aujourdhuiIso);
  await tx.cotation.update({
    where: { id: cotation.id },
    data: {
      statut: "EMISE",
      numero,
      dateEtablissement: versDate(aujourdhuiIso),
      dateValidite: versDate(dateFinValidite(aujourdhuiIso, version.validiteMois)),
      emiseLe: new Date(),
      ...(valideur ? { valideParId: valideur.id, valideLe: new Date() } : {}),
    },
  });
  await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_EMIS", objetType: "cotation", objetId: cotation.id, apres: { numero, validiteJusquau: dateFinValidite(aujourdhuiIso, version.validiteMois) }, adresseIp }, tx);
  return numero;
}

/**
 * Soumet un brouillon : il est recalculé avec les paramètres du jour, puis passe « À valider » si une prime
 * est forcée ou si le TTC dépasse le seuil du produit, sinon il est émis tout de suite (CDC §9.1, §4.1).
 */
export async function soumettre(acteur: UtilisateurCourant, id: number, adresseIp: string | null): Promise<{ statut: "A_VALIDER" | "EMISE"; numero: string | null }> {
  await exigerAgir(acteur);
  return obtenirPrisma().$transaction(async (tx) => {
    const cotation = await chargerPourModification(tx, id);
    // Recalcul avec les paramètres du jour, à partir de ce qui est enregistré.
    if (cotation.typeContrat === null) {
      throw new ErreurMetier("Ce brouillon date d'avant le choix du type de contrat : modifiez-le pour indiquer le type de contrat, puis soumettez-le.");
    }
    const saisie = saisieDepuisCotation(cotation);
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    // Session 6.2b : une prime « à composer » ne se soumet pas (rien n'est écrit : la transaction est annulée).
    if (estNonComposee(c.entree)) throw new ErreurMetier(MESSAGE_NON_COMPOSEE);
    await tx.cotation.update({ where: { id }, data: donneesAEcrire(saisie, c) });

    if (c.raisons.length > 0) {
      await tx.cotation.update({ where: { id }, data: { statut: "A_VALIDER" } });
      await journaliser({ acteur: auteur(acteur), action: "COTATION_SOUMISE", objetType: "cotation", objetId: id, apres: { raisons: c.raisons, ttc: c.resultat.totaux.arrondi.ttc.toFixed() }, adresseIp }, tx);
      if (c.forcages.length > 0) {
        await journaliser(
          {
            acteur: auteur(acteur),
            action: "PRIME_FORCEE",
            objetType: "cotation",
            objetId: id,
            avant: Object.fromEntries(c.forcages.map((f) => [f.code, f.primeTarif.toFixed()])),
            apres: { ...Object.fromEntries(c.forcages.map((f) => [f.code, f.primeForcee.toFixed()])), motif: saisie.motifForcage },
            adresseIp,
          },
          tx,
        );
      }
      return { statut: "A_VALIDER" as const, numero: null };
    }
    // Recharger : le recalcul a pu changer la version du produit (donc la durée de validité).
    const recalculee = await tx.cotation.findUniqueOrThrow({ where: { id }, include: { produit: true } });
    const numero = await emettre(tx, acteur, recalculee, adresseIp, null);
    return { statut: "EMISE" as const, numero };
  });
}

/**
 * Valide une cotation « À valider » et l'émet. Droit « Valider une cotation » (H7, D18 : profil
 * Technique par défaut, paramétrable). Le valideur ne peut JAMAIS être quelqu'un qui a créé OU modifié
 * la cotation (CDC §4.1, T13 ; séparation renforcée par H9).
 */
export async function valider(acteur: UtilisateurCourant, id: number, adresseIp: string | null): Promise<string> {
  if (!peutValider(await niveauDuProfil(acteur.profil, "VALIDER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : validation de cotation.");
  }
  return obtenirPrisma().$transaction(async (tx) => {
    await verrouillerCotation(tx, id);
    const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
    if (!cotation) throw new ErreurMetier("Cotation introuvable.");
    if (!peutEtreValidee(cotation.statut as StatutCotation)) throw new ErreurMetier("Cette cotation n'est pas à valider.");
    if (!valideurAutorise(cotation.auteurId, acteur.id)) {
      throw new ErreurMetier("Vous ne pouvez pas valider votre propre cotation : un autre valideur doit la valider (séparation des tâches).");
    }
    if (cotation.contributeurs.includes(acteur.id)) {
      throw new ErreurMetier("Vous avez modifié cette cotation : un autre valideur doit la valider (séparation des tâches).");
    }
    await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_VALIDE", objetType: "cotation", objetId: id, apres: { raisons: cotation.raisonsValidation as unknown as string[] }, adresseIp }, tx);
    return emettre(tx, acteur, cotation, adresseIp, acteur);
  });
}

/**
 * Renvoie une cotation « À valider » en brouillon : par son auteur, ou par un valideur qui la refuse
 * (H12, D18), avec un motif obligatoire, journalisé. Le statut « Refusée » reste réservé au refus du client.
 */
export async function renvoyerEnBrouillon(acteur: UtilisateurCourant, id: number, commentaire: string, adresseIp: string | null): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await verrouillerCotation(tx, id);
    const cotation = await tx.cotation.findUnique({ where: { id } });
    if (!cotation) throw new ErreurMetier("Cotation introuvable.");
    if (!peutEtreRenvoyee(cotation.statut as StatutCotation)) throw new ErreurMetier("Cette cotation n'est pas à valider.");
    const estAuteur = cotation.auteurId === acteur.id;
    if (!estAuteur && !peutValider(await niveauDuProfil(acteur.profil, "VALIDER_COTATION"))) {
      throw new ErreurAcces("Droit insuffisant : seul l'auteur ou un valideur peut renvoyer cette cotation en brouillon.");
    }
    if (!estAuteur && commentaire.trim().length < 3) throw new ErreurMetier("Le motif du renvoi en brouillon est obligatoire (3 caractères au moins).");
    await tx.cotation.update({ where: { id }, data: { statut: "BROUILLON" } });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_RENVOYEE", objetType: "cotation", objetId: id, apres: { commentaire: commentaire.trim() }, adresseIp }, tx);
  });
}

// ---------------------------------------------------------------- Expiration, acceptation, refus

/**
 * Passe en « Expirée » les cotations émises dont la validité est dépassée (CDC §9.3). Le statut réel est de
 * toute façon calculé à la volée (statutEffectif) : cette mise à jour garde la base à jour.
 */
export async function expirerCotations(aujourdhuiIso: DateIso = aujourdhui()): Promise<number> {
  return obtenirPrisma().$transaction(async (tx) => {
    const aExpirer = await tx.cotation.findMany({
      where: { statut: "EMISE", dateValidite: { lt: versDate(aujourdhuiIso) } },
      select: { id: true, numero: true },
    });
    for (const c of aExpirer) {
      await tx.cotation.update({ where: { id: c.id }, data: { statut: "EXPIREE" } });
      await journaliser({ acteur: null, action: "COTATION_EXPIREE", objetType: "cotation", objetId: c.id, apres: { numero: c.numero }, adresseIp: null }, tx);
    }
    return aExpirer.length;
  });
}

async function chargerEmise(tx: Tx, id: number) {
  const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
  if (!cotation) throw new ErreurMetier("Cotation introuvable.");
  const statut = statutEffectif(cotation.statut as StatutCotation, cotation.dateValidite ? depuisDate(cotation.dateValidite) : null, aujourdhui());
  return { cotation, statut };
}

/**
 * Le client accepte : il retient une ou plusieurs formules ; le module crée la police avec la formule retenue,
 * les assurés et l'échéancier (CDC §9.4). Impossible si la cotation est expirée (T11). Le numéro de police
 * est attribué par SIM et SAISI ici (H10, D18) : jamais généré ; unique ; format paramétré contrôlé (H31).
 *
 * Session 4a : le souscripteur, les assurés, les bénéficiaires, les contacts d'urgence et l'échéancier de la
 * cotation passent dans la police sans ressaisie. `complements` permet de compléter, à ce moment (celui de la
 * souscription), ce qui n'était pas connu à la cotation ; absent, les données de la cotation sont reprises telles quelles.
 * Pour un contrat de groupe, la liste des assurés devient la version 1 (initiale) des adhérents.
 */
export async function accepter(
  acteur: UtilisateurCourant,
  id: number,
  codesRetenus: string[],
  numeroSaisi: string,
  adresseIp: string | null,
  complements?: ComplementsContrat,
): Promise<{ numeroPolice: string }> {
  await exigerAgir(acteur);
  const numeroPolice = normaliserNumeroPolice(numeroSaisi);
  const problemesNumero = problemesNumeroPolice(numeroPolice, await lireFormatNumeroPolice());
  if (problemesNumero.length > 0) throw new ErreurMetier(problemesNumero.join(" "));
  await expirerCotations();
  try {
    return await accepterDansTransaction(acteur, id, codesRetenus, numeroPolice, adresseIp, complements);
  } catch (erreur) {
    // Filet de sécurité de l'unicité (deux saisies simultanées du même numéro) : contrainte unique en base.
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier(`Le numéro de police « ${numeroPolice} » est déjà utilisé.`);
    }
    throw erreur;
  }
}

async function accepterDansTransaction(
  acteur: UtilisateurCourant,
  id: number,
  codesRetenus: string[],
  numeroPolice: string,
  adresseIp: string | null,
  complements: ComplementsContrat | undefined,
): Promise<{ numeroPolice: string }> {
  return obtenirPrisma().$transaction(async (tx) => {
    const { cotation, statut } = await chargerEmise(tx, id);
    if (statut === "EXPIREE") throw new ErreurMetier("Cette cotation est expirée : elle ne peut plus être acceptée ni transformée en police.");
    if (!peutAccepter(statut)) throw new ErreurMetier("Seule une cotation émise peut être acceptée.");

    const entree = cotation.donneesCalcul as unknown as DonneesCalcul;
    // Une cotation composée (session 6.2b) s'accepte en entier : il n'y a pas de formules entre lesquelles choisir, la composition est reprise
    // telle quelle dans la police (T10). Une cotation à la formule garde le choix des formules retenues.
    let entreeRetenue: DonneesCalcul;
    if (estComposition(entree)) {
      if (entree.lignes.length === 0) throw new ErreurMetier(MESSAGE_NON_COMPOSEE);
      entreeRetenue = entree;
      codesRetenus = [];
    } else {
      const retenues = entree.lignes.filter((l) => codesRetenus.includes(l.code));
      if (retenues.length === 0 || retenues.length !== new Set(codesRetenus).size) {
        throw new ErreurMetier("Choisissez au moins une formule parmi celles de la cotation.");
      }
      entreeRetenue = { ...entree, lignes: retenues };
    }

    // Recalcul sur les seules formules retenues, avec les paramètres FIGÉS de la cotation.
    const version = await tx.produitVersion.findUniqueOrThrow({ where: { produitId_dateEffet: { produitId: cotation.produitId, dateEffet: cotation.versionDateEffet } } });
    const { resultat, echeancier } = executerCalcul(
      entreeRetenue,
      { repartitionPourcent: (version.fractionnementRepartition as string[] | null) ?? null, decalagesMois: (version.fractionnementDecalagesMois as number[] | null) ?? null },
      cotation.nombreTranches,
    );

    if (await tx.police.findUnique({ where: { numero: numeroPolice }, select: { id: true } })) {
      throw new ErreurMetier(`Le numéro de police « ${numeroPolice} » est déjà utilisé.`);
    }

    // Données reprises de la cotation, éventuellement complétées à la souscription.
    const souscripteur: Souscripteur = { ...(cotation.souscripteur as unknown as Souscripteur), ...(complements?.souscripteur ?? {}) };
    const beneficiaires = complements ? complements.beneficiaires : ((cotation.beneficiaires as unknown as Beneficiaire[] | null) ?? null);
    const contactsUrgence = complements ? complements.contactsUrgence : ((cotation.contactsUrgence as unknown as ContactUrgence[] | null) ?? null);
    if (complements) {
      const problemes = [...problemesSouscripteur(souscripteur, aujourdhui()), ...problemesBeneficiaires(beneficiaires ?? []), ...problemesContactsUrgence(contactsUrgence ?? [])];
      if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
    }

    const police = await tx.police.create({
      data: {
        numero: numeroPolice,
        typeContrat: cotation.typeContrat,
        cotationId: cotation.id,
        produitCode: cotation.produit.code,
        souscripteur: souscripteur as unknown as Prisma.InputJsonValue,
        assures: cotation.assures as Prisma.InputJsonValue,
        beneficiaires: listeOuNull(beneficiaires),
        contactsUrgence: listeOuNull(contactsUrgence),
        risque: cotation.risque as Prisma.InputJsonValue,
        formulesRetenues: codesRetenus as unknown as Prisma.InputJsonValue,
        donneesCalcul: entreeRetenue as unknown as Prisma.InputJsonValue,
        resultat: serialiser(resultat) as unknown as Prisma.InputJsonValue,
        ttcTotal: resultat.totaux.arrondi.ttc.toFixed(),
        echeancier: (tranchesVersJson(echeancier) ?? []) as unknown as Prisma.InputJsonValue,
        dateEffet: cotation.dateEffet,
        dateEcheance: cotation.dateEcheance,
        creePar: acteur.identifiant,
      },
    });
    if (estContratDeGroupe(cotation.typeContrat)) {
      // Version 1 de la liste des adhérents : celle de la cotation acceptée, à la date d'effet de la police.
      await tx.adherentsVersion.create({
        data: { policeId: police.id, numero: 1, motif: "INITIALE", dateEffet: cotation.dateEffet, adherents: cotation.assures as Prisma.InputJsonValue, concernes: [], creePar: acteur.identifiant },
      });
    }
    await tx.cotation.update({ where: { id }, data: { statut: "ACCEPTEE", formulesRetenues: codesRetenus as unknown as Prisma.InputJsonValue, accepteeLe: new Date() } });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_ACCEPTEE", objetType: "cotation", objetId: id, apres: { formules: codesRetenus, numeroPolice }, adresseIp }, tx);
    await journaliser({ acteur: auteur(acteur), action: "POLICE_CREEE", objetType: "police", objetId: numeroPolice, apres: { cotation: cotation.numero, ttc: resultat.totaux.arrondi.ttc.toFixed(), complementsSaisis: complements !== undefined, beneficiaires: beneficiaires?.length ?? null, contactsUrgence: contactsUrgence?.length ?? null }, adresseIp }, tx);
    return { numeroPolice };
  });
}

/** Refus du client : le motif est obligatoire et vient de la liste paramétrable (CDC §9.3). */
export async function refuser(acteur: UtilisateurCourant, id: number, motifCode: string, commentaire: string, adresseIp: string | null): Promise<void> {
  await exigerAgir(acteur);
  await expirerCotations();
  await obtenirPrisma().$transaction(async (tx) => {
    const { cotation, statut } = await chargerEmise(tx, id);
    if (!peutRefuser(statut)) throw new ErreurMetier("Seule une cotation émise et encore valide peut être refusée.");
    const motif = await tx.motifRefus.findUnique({ where: { code: motifCode } });
    if (!motif || !motif.actif) throw new ErreurMetier("Le motif de refus est obligatoire : choisissez-en un dans la liste.");
    await tx.cotation.update({ where: { id }, data: { statut: "REFUSEE", motifRefusCode: motif.code, refusCommentaire: commentaire.trim() || null } });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_REFUSEE", objetType: "cotation", objetId: cotation.id, apres: { motif: motif.code, commentaire: commentaire.trim() || null }, adresseIp }, tx);
  });
}

// ---------------------------------------------------------------- Lecture

export type LigneCotation = {
  id: number;
  numero: string | null;
  statut: StatutCotation;
  produit: string;
  souscripteur: string;
  ttc: string | null;
  /** Produit par garanties dont la prime n'est pas encore composée (6.2b) : la Technique repère ainsi les brouillons à traiter. */
  aComposer: boolean;
  auteur: string;
  dateValidite: DateIso | null;
  creeLe: Date;
};

const nomSouscripteur = (s: Souscripteur) => (s.type === "MORALE" ? s.raison_sociale : `${s.nom} ${s.prenoms}`.trim());

export async function listerCotations(acteur: UtilisateurCourant, filtre: { statut?: string } = {}): Promise<LigneCotation[]> {
  await exigerLecture(acteur);
  await expirerCotations();
  const lignes = await obtenirPrisma().cotation.findMany({
    where: filtre.statut && estStatut(filtre.statut) ? { statut: filtre.statut } : {},
    include: { produit: { select: { code: true } } },
    orderBy: { id: "desc" },
    take: 200,
  });
  return lignes.map((c) => ({
    id: c.id,
    numero: c.numero,
    statut: c.statut as StatutCotation,
    produit: c.produit.code,
    souscripteur: nomSouscripteur(c.souscripteur as unknown as Souscripteur),
    ttc: c.ttcTotal?.toFixed(0) ?? null,
    aComposer: c.donneesCalcul !== null && estNonComposee(c.donneesCalcul as unknown as DonneesCalcul),
    auteur: c.auteurIdentifiant,
    dateValidite: c.dateValidite ? depuisDate(c.dateValidite) : null,
    creeLe: c.creeLe,
  }));
}

export type DetailCotation = {
  id: number;
  numero: string | null;
  statut: StatutCotation;
  /** Statut tenant compte de l'expiration à la date du jour. */
  statutEffectif: StatutCotation;
  filigrane: string | null;
  produit: { code: string; libelle: string };
  versionDateEffet: DateIso;
  typeContrat: TypeContrat | null;
  /** null : cotation d'avant la session 6.0 (le taux venait alors du type de contrat). */
  regimeTaxe: RegimeTaxe | null;
  souscripteur: Souscripteur;
  clientId: number | null;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  dateEtablissement: DateIso | null;
  dateValidite: DateIso | null;
  nombreTranches: number;
  lignes: LigneStockee[];
  libelles: Record<string, string>;
  motifForcage: string | null;
  assures: Assure[];
  /** null : jamais fournis (cotation d'avant la 4a). */
  beneficiaires: Beneficiaire[] | null;
  contactsUrgence: ContactUrgence[] | null;
  risque: Risque;
  raisonsValidation: RaisonValidation[];
  /** Recalculé à partir des paramètres figés : identique à ce qui a été émis. */
  resultat: ResultatCalcul;
  echeancier: Tranche[] | null;
  auteurId: number;
  auteurIdentifiant: string;
  /** Qui a créé ou modifié le brouillon (H9) : aucun ne peut valider. */
  contributeurs: number[];
  formulesRetenues: string[] | null;
  motifRefusCode: string | null;
  refusCommentaire: string | null;
  numeroPolice: string | null;
  /** Intermédiaires choisis (copie faite au choix), dans l'ordre. */
  intermediaires: IntermediaireDocument[];
  /** Mode de tarification de la version figée sur la cotation (session 6.2b). */
  modeTarification: string;
  /** Composition manuelle de la prime (produit en mode GARANTIES) ; null pour une cotation à la formule. */
  composition: CompositionLue | null;
  /** Garanties paramétrées du produit (suggestions de libellé) et saisie libre autorisée ou non. */
  garantiesDuProduit: GarantieParametree[];
  garantiesSaisieLibre: boolean;
  /** Brouillon préparé avec des formules alors que le produit se tarife désormais par garanties : il ne se modifie ni ne se soumet (H89), on le recrée. */
  brouillonAFormulesSousGaranties: boolean;
};

/** Lignes de prime d'une cotation composée, avec le taux résolu et figé de chacune ; `lignes` vide : la prime est « à composer ». */
export type CompositionLue = { lignes: LigneComposee[]; composePar: string | null; composeLe: Date | null; motif: string | null; bareme: BaremeFige | null };

function lireComposition(c: { donneesCalcul: unknown; compositionPar: string | null; compositionLe: Date | null; compositionMotif: string | null }): CompositionLue | null {
  const donnees = c.donneesCalcul as DonneesCalcul | null;
  if (!donnees || !estComposition(donnees)) return null;
  return { lignes: donnees.lignes, composePar: c.compositionPar, composeLe: c.compositionLe, motif: c.compositionMotif, bareme: estCompositionBareme(donnees) ? donnees.bareme : null };
}

export async function lireCotation(acteur: UtilisateurCourant, id: number): Promise<DetailCotation | null> {
  await exigerLecture(acteur);
  await expirerCotations();
  const c = await obtenirPrisma().cotation.findUnique({
    where: { id },
    include: { produit: true, police: { select: { numero: true } }, intermediaires: true },
  });
  if (!c) return null;
  const version = await obtenirPrisma().produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId: c.produitId, dateEffet: c.versionDateEffet } },
    include: { formules: true },
  });
  const statut = c.statut as StatutCotation;
  const dateValidite = c.dateValidite ? depuisDate(c.dateValidite) : null;
  const effectif = statutEffectif(statut, dateValidite, aujourdhui());
  // Un brouillon à formules n'est un cas à part que si le produit est, AUJOURD'HUI, tarifé par garanties (la version figée sur le brouillon, elle, est ancienne).
  const donneesCalcul = c.donneesCalcul as unknown as DonneesCalcul | null;
  const versionEnVigueur = peutModifier(statut) && donneesCalcul !== null && !estComposition(donneesCalcul) ? await resoudreVersion(obtenirPrisma(), c.produit.code, aujourdhui()).catch(() => null) : null;
  return {
    id: c.id,
    numero: c.numero,
    statut,
    statutEffectif: effectif,
    filigrane: filigraneDe(effectif),
    produit: { code: c.produit.code, libelle: c.produit.libelle },
    versionDateEffet: depuisDate(c.versionDateEffet),
    typeContrat: (c.typeContrat as TypeContrat | null) ?? null,
    regimeTaxe: (c.regimeTaxe as RegimeTaxe | null) ?? null,
    souscripteur: c.souscripteur as unknown as Souscripteur,
    clientId: c.clientId,
    dateEffet: depuisDate(c.dateEffet),
    dateEcheance: depuisDate(c.dateEcheance),
    dateEtablissement: c.dateEtablissement ? depuisDate(c.dateEtablissement) : null,
    dateValidite,
    nombreTranches: c.nombreTranches,
    lignes: c.lignes as unknown as LigneStockee[],
    libelles: Object.fromEntries(version.formules.map((f) => [f.code, f.libelle])),
    motifForcage: c.motifForcage,
    assures: c.assures as unknown as Assure[],
    beneficiaires: (c.beneficiaires as unknown as Beneficiaire[] | null) ?? null,
    contactsUrgence: (c.contactsUrgence as unknown as ContactUrgence[] | null) ?? null,
    risque: c.risque as unknown as Risque,
    raisonsValidation: c.raisonsValidation as unknown as RaisonValidation[],
    resultat: recalculer(c.donneesCalcul as unknown as DonneesCalcul),
    modeTarification: version.modeTarification,
    composition: lireComposition(c),
    garantiesDuProduit: (version.garanties as GarantieParametree[] | null) ?? [],
    garantiesSaisieLibre: version.garantiesSaisieLibre,
    brouillonAFormulesSousGaranties: versionEnVigueur !== null && (compositionPossible(versionEnVigueur.version.modeTarification) || versionEnVigueur.version.modeTarification === "BAREME"),
    echeancier: jsonVersTranches(c.echeancier),
    auteurId: c.auteurId,
    auteurIdentifiant: c.auteurIdentifiant,
    contributeurs: c.contributeurs,
    formulesRetenues: (c.formulesRetenues as unknown as string[] | null) ?? null,
    motifRefusCode: c.motifRefusCode,
    refusCommentaire: c.refusCommentaire,
    numeroPolice: c.police?.numero ?? null,
    intermediaires: versIntermediairesDocument(c.intermediaires),
  };
}
