import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { EntreeCalcul } from "@/domaine/calcul/calcul";
import { estComposition, type DonneesCalcul } from "@/domaine/calcul/composition";
import { compositionPossible, MESSAGE_AVENANT_GARANTIES, MESSAGE_RENOUVELLEMENT_GARANTIES, MESSAGE_TARIFICATION_PAR_GARANTIES } from "@/domaine/calcul/parametrage";
import type { DateIso } from "@/domaine/calcul/dates";
import { montant } from "@/domaine/calcul/montant";
import { estRegimeTaxe, estTypeContrat, REGIME_PAR_DEFAUT } from "@/domaine/calcul/taxes";
import { estContratDeGroupe } from "@/domaine/cotation/adherents";
import type { Assure, Risque, Souscripteur } from "@/domaine/cotation/saisie";
import { validationContratRequise } from "@/domaine/cotation/validation";
import { donneesDocument, type Facturation, type SourceDocument } from "@/domaine/documents/donnees";
import { peutAgir, peutLire, type CodeAction, type CodeNiveau } from "@/domaine/droits";
import {
  contenuAvoir,
  controlerImputation,
  controlerPaiement,
  controlerRestitution,
  imputationProposee,
  partReglee,
  envoyeARetenu,
  etatPaiements,
  LIBELLE_CANAL,
  LIBELLE_STATUT_FACTURE,
  LIBELLE_TYPE_FACTURE,
  nomFacture,
  periodeRenouvellement,
  problemesEnvoyeA,
  problemesAbandon,
  problemesMotifAvoir,
  type CanalPaiement,
  type ContenuFacture,
  type EnvoyeA,
  type EtatPaiements,
  type SaisiePaiement,
  type SaisieRestitution,
  type StatutFacture,
  type TypeFacture,
} from "@/domaine/facturation/factures";

import { journaliser, type ActeurAudit } from "./audit";
import { contexteProduit, montantsDu } from "./documents";
import { avanceDisponible, encaissementsDe, inclusionImputations, reportsEnAttente, versEncaissements, type ReportEnAttente } from "./encaissements";
import { niveauDuProfil } from "./droits";
import { versIntermediairesDocument } from "./intermediaires";
import { modelesAssocies, versionPublieeEnVigueur } from "./modeles";
import { allouerNumero } from "./numerotation";
import { aujourdhui, construireEntree, executerCalcul, exigerCalculAutomatiqueEnVigueur, resoudreContexte, resoudreVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { figer, produire, produireEnAttente, prochaineVersion, type AssociesFiges, type IssueProduction, type TypeAProduire } from "./production";
import { lireParametresSociete } from "./societe";
import { fermerTachesAutomatiquement } from "./taches-police";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Factures, avoirs, paiements et reçus (CDC §11, §12, session 4b).
 *
 * Cycle d'une facture : BROUILLON (sans numéro) → [À VALIDER] → ÉMISE (numéro FAC attribué dans la transaction de
 * l'émission, PDF produit après) → ANNULÉE (par un avoir, une seule fois). Une facture émise ne se modifie plus : la
 * base le refuse (déclencheur `facture_intangible`). Une correction = un avoir, puis une nouvelle facture (T4).
 *
 * « Oui (sous seuil) » (décision de Thierry du 08/10/2026, H21 fermée) : comme pour les contrats (D22), un profil limité
 * par le seuil (le Gestionnaire production par défaut) n'émet pas une facture dont le TTC dépasse le seuil de la version
 * du produit ; sa demande passe « À valider ». Un profil « Oui » (Technique, Comptabilité) qui n'est pas le demandeur
 * l'émet ensuite, ce qui vaut validation. La Direction Générale (« Lecture ») ne valide pas (H44).
 */

type Tx = Prisma.TransactionClient;
type LigneFacture = Prisma.FactureGetPayload<object>;

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const json = (v: unknown) => v as Prisma.InputJsonValue;
/** Émissions simultanées : elles passent une à une sur la ligne du compteur ; on attend son tour plutôt que d'échouer. */
const ATTENTE = { maxWait: 20_000, timeout: 20_000 };

// ---------------------------------------------------------------- Droits (CDC §4)

async function exiger(acteur: UtilisateurCourant, action: CodeAction, quoi: string): Promise<CodeNiveau> {
  const niveau = await niveauDuProfil(acteur.profil, action);
  if (!peutAgir(niveau)) throw new ErreurAcces(`Droit insuffisant : ${quoi}.`);
  return niveau;
}

/** Lecture des factures : un des trois droits de facturation (émettre une facture, un avoir, enregistrer un paiement). */
async function droitsFacturation(acteur: UtilisateurCourant) {
  const [facture, avoir, paiement] = await Promise.all([
    niveauDuProfil(acteur.profil, "EMETTRE_FACTURE"),
    niveauDuProfil(acteur.profil, "EMETTRE_AVOIR"),
    niveauDuProfil(acteur.profil, "ENREGISTRER_PAIEMENT"),
  ]);
  return { facture, avoir, paiement, lire: peutLire(facture) || peutLire(avoir) || peutLire(paiement) };
}

async function exigerLecture(acteur: UtilisateurCourant) {
  const d = await droitsFacturation(acteur);
  if (!d.lire) throw new ErreurAcces("Droit insuffisant : factures.");
  return d;
}

// ---------------------------------------------------------------- Chargements

export const chargerPolice = (client: Tx, policeId: number) =>
  client.police.findUnique({ where: { id: policeId }, include: { adherents: { orderBy: { numero: "asc" } }, cotation: { select: { produitId: true, versionDateEffet: true, regimeTaxe: true, intermediaires: true } } } });
type PoliceChargee = NonNullable<Awaited<ReturnType<typeof chargerPolice>>>;

/** Verrou de la ligne de la facture jusqu'à la fin de la transaction : deux émissions, deux paiements passent l'un après l'autre. */
export async function verrouiller(tx: Tx, factureId: number): Promise<LigneFacture> {
  await tx.$queryRaw`SELECT id FROM factures WHERE id = ${factureId} FOR UPDATE`;
  const f = await tx.facture.findUnique({ where: { id: factureId } });
  if (!f) throw new ErreurMetier("Facture introuvable.");
  return f;
}

export const contenuDe = (f: { contenu: unknown }) => f.contenu as unknown as ContenuFacture;


const enDoublon = (erreur: unknown) => erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002";

// ---------------------------------------------------------------- Contenu d'une facture

/** « Envoyé à » contrôlé, puis retenu (null s'il est vide ou identique à « Facturé à »). */
function envoyeAControle(saisi: EnvoyeA | null, souscripteur: Souscripteur): EnvoyeA | null {
  const problemes = problemesEnvoyeA(saisi);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  return envoyeARetenu(saisi, { nom: nomFacture(souscripteur), adresse: souscripteur.adresse ?? "" });
}

const echeancesJson = (j: unknown): ContenuFacture["echeances"] => (Array.isArray(j) ? (j as ContenuFacture["echeances"]).map((e) => ({ numero: e.numero, date: e.date, montant: String(e.montant) })) : []);

const listeCourante = (police: PoliceChargee): Assure[] => police.assures as unknown as Assure[];

async function contenuCalcule(
  police: PoliceChargee,
  produitId: number,
  versionDateEffet: Date,
  entree: DonneesCalcul,
  o: { assures: Assure[]; ordresSansPrime: number[]; echeances: ContenuFacture["echeances"]; envoyeA: EnvoyeA | null },
): Promise<ContenuFacture> {
  const contexte = await contexteProduit(produitId, versionDateEffet);
  const m = montantsDu(entree, contexte);
  const groupe = estContratDeGroupe(police.typeContrat);
  return {
    produit: { code: contexte.produit.code, libelle: contexte.produit.libelle, gamme: contexte.produit.gamme, branche: contexte.produit.branche },
    typeContrat: police.typeContrat,
    souscripteur: police.souscripteur as unknown as Souscripteur,
    envoyeA: o.envoyeA,
    assures: o.assures,
    ordresSansPrime: o.ordresSansPrime,
    // Facture de groupe (CDC §11.3) : facture globale, la liste par adhérent est TOUJOURS renvoyée en annexe (H59).
    listesEnAnnexe: groupe ? ["assures"] : [],
    // H48 : date de souscription = date de création de la police (acceptation de la cotation).
    dateSouscription: depuisDate(police.creeLe),
    dateEffet: entree.dateEffet,
    dateEcheance: entree.dateEcheance,
    joursCouverts: m.resultat.joursCouverts,
    formules: m.formules,
    // Produit tarifé par garanties (session 6.2b) : une ligne par garantie ; absent pour une facture à la formule (contenu inchangé).
    ...(m.garanties.length > 0 ? { garanties: m.garanties } : {}),
    totaux: m.totaux,
    taxe: m.taxe,
    echeances: o.echeances,
    entree,
    intermediaires: versIntermediairesDocument(police.cotation.intermediaires),
  };
}

/** Facture annulée que la nouvelle facture remplace (T4) : même police, même type, même période ou même liste. */
async function factureRemplacee(tx: Tx, policeId: number, type: TypeFacture, critere: { dateEffet?: Date; adherentsVersion?: number }): Promise<number | null> {
  const f = await tx.facture.findFirst({
    where: { policeId, type, statut: "ANNULEE", ...(critere.dateEffet ? { dateEffet: critere.dateEffet } : {}), ...(critere.adherentsVersion ? { adherentsVersion: critere.adherentsVersion } : {}) },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  return f?.id ?? null;
}

async function creer(tx: Tx, acteur: UtilisateurCourant, police: PoliceChargee, d: { type: TypeFacture; produitId: number; versionDateEffet: Date; contenu: ContenuFacture; remplaceId: number | null; adherentsVersion?: number | null }, adresseIp: string | null): Promise<number> {
  const f = await tx.facture.create({
    data: {
      type: d.type,
      statut: "BROUILLON",
      policeId: police.id,
      produitId: d.produitId,
      versionDateEffet: d.versionDateEffet,
      remplaceId: d.remplaceId,
      adherentsVersion: d.adherentsVersion ?? null,
      dateEffet: versDate(d.contenu.dateEffet),
      dateEcheance: versDate(d.contenu.dateEcheance),
      contenu: json(d.contenu),
      ttc: d.contenu.totaux.ttc,
      creeParId: acteur.id,
      creePar: acteur.identifiant,
    },
  });
  await journaliser(
    { acteur: auteur(acteur), action: "FACTURE_CREEE", objetType: "facture", objetId: f.id, apres: { type: d.type, police: police.numero, ttc: d.contenu.totaux.ttc, dateEffet: d.contenu.dateEffet, remplace: d.remplaceId }, adresseIp },
    tx,
  );
  return f.id;
}

async function transactionCreation(fn: (tx: Tx) => Promise<number>, doublon: string): Promise<number> {
  try {
    return await obtenirPrisma().$transaction(fn);
  } catch (erreur) {
    if (enDoublon(erreur)) throw new ErreurMetier(doublon);
    throw erreur;
  }
}

// ---------------------------------------------------------------- Affaire nouvelle (CDC §11.3)

/**
 * Facture d'affaire nouvelle d'une police, en brouillon (H48) : après l'émission des conditions particulières, montants
 * de la police (moteur, à l'identique), échéancier de la police. Contrat de groupe : facture globale, assurés de la liste
 * initiale (celle du calcul), renvoyés en annexe.
 */
export async function creerFactureAffaireNouvelle(acteur: UtilisateurCourant, policeId: number, envoyeA: EnvoyeA | null, adresseIp: string | null): Promise<number> {
  await exiger(acteur, "EMETTRE_FACTURE", "émission de facture");
  return transactionCreation(async (tx) => {
    const police = await chargerPolice(tx, policeId);
    if (!police) throw new ErreurMetier("Police introuvable.");
    if (!(await tx.documentEmis.findFirst({ where: { policeId, type: "CP" }, select: { id: true } }))) {
      throw new ErreurMetier("Émettez d'abord les conditions particulières de la police : la facture d'affaire nouvelle les suit (H48).");
    }
    const existante = await tx.facture.findFirst({ where: { policeId, type: "AFFAIRE_NOUVELLE", statut: { notIn: ["ANNULEE", "ABANDONNEE"] } } });
    if (existante) throw new ErreurMetier(`La facture d'affaire nouvelle de cette police existe déjà (${existante.numero ?? "brouillon"}).`);
    const initiale = police.adherents.find((v) => v.motif === "INITIALE");
    const assures = estContratDeGroupe(police.typeContrat) && initiale ? (initiale.adherents as unknown as Assure[]) : listeCourante(police);
    const contenu = await contenuCalcule(police, police.cotation.produitId, police.cotation.versionDateEffet, police.donneesCalcul as unknown as DonneesCalcul, {
      assures,
      ordresSansPrime: [],
      echeances: echeancesJson(police.echeancier),
      envoyeA: envoyeAControle(envoyeA, police.souscripteur as unknown as Souscripteur),
    });
    return creer(
      tx,
      acteur,
      police,
      { type: "AFFAIRE_NOUVELLE", produitId: police.cotation.produitId, versionDateEffet: police.cotation.versionDateEffet, contenu, remplaceId: await factureRemplacee(tx, policeId, "AFFAIRE_NOUVELLE", {}) },
      adresseIp,
    );
  }, "La facture d'affaire nouvelle de cette police existe déjà.");
}

// ---------------------------------------------------------------- Renouvellement (CDC §11.3)

export type SaisieRenouvellement = { lignes: { codeFormule: string; effectif: number }[] | null; nombreTranches: number | null; envoyeA: EnvoyeA | null };

/** Dernière période facturée (affaire nouvelle ou renouvellement non annulé) : le renouvellement la suit. */
async function dernierePeriode(tx: Tx, policeId: number) {
  return tx.facture.findFirst({ where: { policeId, type: { in: ["AFFAIRE_NOUVELLE", "RENOUVELLEMENT"] }, statut: { notIn: ["ANNULEE", "ABANDONNEE"] } }, orderBy: { dateEcheance: "desc" } });
}

/**
 * Montants d'un renouvellement (H50) : du lendemain de l'échéance précédente, pour un an ; TARIF EN VIGUEUR à la nouvelle
 * date d'effet (version du produit et taxe) ; formules et effectifs de la période précédente, modifiables ; accessoires du
 * paramétrage ; aucune prime forcée reprise ; même nombre de tranches, modifiable.
 */
async function calculRenouvellement(tx: Tx, police: PoliceChargee, precedente: LigneFacture, saisie: SaisieRenouvellement) {
  if (!police.typeContrat || !estTypeContrat(police.typeContrat)) throw new ErreurMetier("Police sans type de contrat (antérieure à la session 4.0) : le taux de taxe du renouvellement ne peut pas être choisi.");
  const { dateEffet, dateEcheance } = periodeRenouvellement(depuisDate(precedente.dateEcheance));
  // Régime de taxe de la cotation (session 6.0) ; cotation plus ancienne : le régime proposé pour son type de contrat.
  const regime = police.cotation.regimeTaxe && estRegimeTaxe(police.cotation.regimeTaxe) ? police.cotation.regimeTaxe : REGIME_PAR_DEFAUT[police.typeContrat];
  // Session 6.2b (H90) : le renouvellement d'une police à garanties n'est pas géré (la composition de la nouvelle période non plus), que la période
  // précédente ait été composée ou que le produit soit passé en mode par garanties depuis.
  const precedenteFigee = contenuDe(precedente).entree as DonneesCalcul;
  if (estComposition(precedenteFigee) || compositionPossible((await resoudreVersion(tx, police.produitCode, dateEffet)).version.modeTarification)) {
    throw new ErreurMetier(MESSAGE_RENOUVELLEMENT_GARANTIES);
  }
  const contexte = await resoudreContexte(tx, police.produitCode, dateEffet, dateEffet, regime);
  const avant = precedenteFigee;
  const lignes = saisie.lignes ?? avant.lignes.map((l) => ({ codeFormule: l.code, effectif: l.effectif }));
  if (lignes.length === 0 || lignes.some((l) => !Number.isInteger(l.effectif) || l.effectif < 1)) throw new ErreurMetier("Chaque formule renouvelée a un effectif entier d'au moins 1.");
  const nombreTranches = saisie.nombreTranches ?? Math.max(1, contenuDe(precedente).echeances.length);
  const { entree } = construireEntree(contexte, { dateEffet, dateEcheance, lignes, nombreTranches });
  const { echeancier } = executerCalcul(entree, contexte.version.fractionnement, nombreTranches);
  return {
    produitId: contexte.produit.id,
    versionDateEffet: versDate(contexte.version.dateEffet),
    entree,
    echeances: (echeancier ?? []).map((t) => ({ numero: t.numero, date: t.date, montant: t.montant.toFixed() })),
  };
}

export async function creerFactureRenouvellement(acteur: UtilisateurCourant, policeId: number, saisie: SaisieRenouvellement, adresseIp: string | null): Promise<number> {
  await exiger(acteur, "EMETTRE_FACTURE", "émission de facture");
  return transactionCreation(async (tx) => {
    const police = await chargerPolice(tx, policeId);
    if (!police) throw new ErreurMetier("Police introuvable.");
    const precedente = await dernierePeriode(tx, policeId);
    if (precedente?.type === "RENOUVELLEMENT" && precedente.statut !== "EMISE") {
      throw new ErreurMetier("Un renouvellement de cette police est déjà en cours (brouillon ou à valider) : émettez-le avant de préparer le suivant.");
    }
    if (!precedente || precedente.statut !== "EMISE") throw new ErreurMetier("Le renouvellement suit une facture émise (affaire nouvelle ou renouvellement précédent) : émettez-la d'abord.");
    const calcul = await calculRenouvellement(tx, police, precedente, saisie);
    const contenu = await contenuCalcule(police, calcul.produitId, calcul.versionDateEffet, calcul.entree, {
      assures: listeCourante(police),
      ordresSansPrime: [],
      echeances: calcul.echeances,
      envoyeA: envoyeAControle(saisie.envoyeA, police.souscripteur as unknown as Souscripteur),
    });
    return creer(
      tx,
      acteur,
      police,
      { type: "RENOUVELLEMENT", produitId: calcul.produitId, versionDateEffet: calcul.versionDateEffet, contenu, remplaceId: await factureRemplacee(tx, policeId, "RENOUVELLEMENT", { dateEffet: versDate(calcul.entree.dateEffet) }) },
      adresseIp,
    );
  }, "Un renouvellement existe déjà pour cette période.");
}

// ---------------------------------------------------------------- Avenant d'incorporation (CDC §11.3)

/**
 * Avenant d'incorporation (H51) : prime additionnelle des adhérents d'UNE incorporation, au prorata du jour de leur
 * adhésion à l'échéance de la période facturée qui la contient. Une unité par adhérent incorporé, dans sa formule ; prime
 * unitaire, taxe et arrondi de cette période ; prorata toujours appliqué, sans prime minimale ; pas d'accessoires ;
 * une seule tranche.
 */
export async function creerFactureAvenant(acteur: UtilisateurCourant, policeId: number, adherentsVersion: number, envoyeA: EnvoyeA | null, adresseIp: string | null): Promise<number> {
  await exiger(acteur, "EMETTRE_FACTURE", "émission de facture");
  return transactionCreation(async (tx) => {
    const police = await chargerPolice(tx, policeId);
    if (!police) throw new ErreurMetier("Police introuvable.");
    const version = police.adherents.find((v) => v.numero === adherentsVersion);
    if (!version || version.motif !== "INCORPORATION") throw new ErreurMetier("Choisissez une incorporation d'adhérents de cette police.");
    const date = depuisDate(version.dateEffet);
    const periode = await tx.facture.findFirst({
      where: { policeId, type: { in: ["AFFAIRE_NOUVELLE", "RENOUVELLEMENT"] }, statut: "EMISE", dateEffet: { lte: version.dateEffet }, dateEcheance: { gte: version.dateEffet } },
      orderBy: { dateEffet: "desc" },
    });
    if (!periode) throw new ErreurMetier(`Aucune facture émise ne couvre le ${date} : émettez d'abord la facture de la période où l'incorporation prend effet.`);
    const baseFigee = contenuDe(periode).entree as DonneesCalcul;
    // Session 6.2b (H90) : la prime d'un avenant à garanties n'est pas gérée ; rien n'est calculé en silence.
    if (estComposition(baseFigee)) throw new ErreurMetier(MESSAGE_AVENANT_GARANTIES);
    const base = baseFigee;
    const concernes = new Set(version.concernes as unknown as number[]);
    const incorpores = (version.adherents as unknown as Assure[]).filter((a) => concernes.has(a.ordre));
    if (incorpores.length === 0) throw new ErreurMetier("Cette incorporation n'ajoute aucun adhérent.");
    const parFormule = new Map<string, number>();
    for (const a of incorpores) parFormule.set(a.formule, (parFormule.get(a.formule) ?? 0) + 1);
    const lignes = [...parFormule].map(([code, effectif]) => {
      const ligne = base.lignes.find((l) => l.code === code);
      if (!ligne) throw new ErreurMetier(`La formule « ${code} » n'est pas dans le calcul de la période facturée : avenant impossible sans réponse de la Technique.`);
      return { code, primeUnitaire: ligne.primeUnitaire, effectif, accessoire: { mode: "AUCUN" as const, valeur: "0" } };
    });
    const entree: EntreeCalcul = {
      moteur: base.moteur,
      dateEffet: date,
      dateEcheance: depuisDate(periode.dateEcheance),
      lignes,
      parametres: { prorata: { actif: true, primeMinimale: null }, arrondi: base.parametres.arrondi, taxe: base.parametres.taxe },
    };
    executerCalcul(entree, { repartitionPourcent: null, decalagesMois: null }, 1); // contrôle : refus lisible si le calcul est impossible
    const contenu = await contenuCalcule(police, periode.produitId, periode.versionDateEffet, entree, {
      assures: incorpores,
      ordresSansPrime: [],
      echeances: [],
      envoyeA: envoyeAControle(envoyeA, police.souscripteur as unknown as Souscripteur),
    });
    return creer(
      tx,
      acteur,
      police,
      { type: "AVENANT", produitId: periode.produitId, versionDateEffet: periode.versionDateEffet, contenu, adherentsVersion, remplaceId: await factureRemplacee(tx, policeId, "AVENANT", { adherentsVersion }) },
      adresseIp,
    );
  }, "Cette incorporation est déjà facturée.");
}

// ---------------------------------------------------------------- Abandon d'un brouillon (session 6.2b, H87)

/**
 * Abandonne un brouillon de facture (affaire nouvelle, renouvellement ou avenant), y compris une demande « À valider » : statut
 * « Abandonnée », MOTIF OBLIGATOIRE, journalisé, DÉFINITIF. Aucun numéro n'est consommé (le brouillon n'en a pas : la base l'impose). La place
 * de la facture se libère : on peut préparer une nouvelle facture pour la même période. Même droit que la modification d'un brouillon.
 */
export async function abandonnerFacture(acteur: UtilisateurCourant, factureId: number, motif: string, adresseIp: string | null): Promise<void> {
  await exiger(acteur, "EMETTRE_FACTURE", "émission de facture");
  await obtenirPrisma().$transaction(async (tx) => {
    const f = await verrouiller(tx, factureId);
    const problemes = problemesAbandon(f, motif);
    if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
    const maintenant = new Date();
    await tx.facture.update({ where: { id: f.id }, data: { statut: "ABANDONNEE", abandonneParId: acteur.id, abandonnePar: acteur.identifiant, abandonneLe: maintenant, motifAbandon: motif.trim() } });
    await journaliser(
      {
        acteur: auteur(acteur),
        action: "FACTURE_ABANDONNEE",
        objetType: "facture",
        objetId: f.id,
        avant: { statut: f.statut, type: f.type, ttc: f.ttc.toFixed(), dateEffet: depuisDate(f.dateEffet) },
        apres: { statut: "ABANDONNEE", motif: motif.trim() },
        adresseIp,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------- Modification d'un brouillon

/** Brouillon seulement : « Envoyé à » ; pour un renouvellement, aussi les effectifs et le nombre de tranches (recalcul). */
export async function modifierFacture(acteur: UtilisateurCourant, factureId: number, saisie: SaisieRenouvellement, adresseIp: string | null): Promise<void> {
  await exiger(acteur, "EMETTRE_FACTURE", "émission de facture");
  await obtenirPrisma().$transaction(async (tx) => {
    const f = await verrouiller(tx, factureId);
    if (f.statut === "ABANDONNEE") throw new ErreurMetier("Ce brouillon est abandonné : il ne se modifie plus.");
    if (f.statut !== "BROUILLON") throw new ErreurMetier("Seul un brouillon se modifie. Une facture émise se corrige par un avoir puis une nouvelle facture.");
    const police = (await chargerPolice(tx, f.policeId))!;
    const avant = contenuDe(f);
    const envoyeA = envoyeAControle(saisie.envoyeA, avant.souscripteur);
    let contenu: ContenuFacture = { ...avant, envoyeA };
    let produit = { produitId: f.produitId, versionDateEffet: f.versionDateEffet };
    if (f.type === "RENOUVELLEMENT" && (saisie.lignes || saisie.nombreTranches)) {
      const precedente = await tx.facture.findFirst({
        where: { policeId: f.policeId, type: { in: ["AFFAIRE_NOUVELLE", "RENOUVELLEMENT"] }, statut: "EMISE", dateEcheance: { lt: f.dateEffet } },
        orderBy: { dateEcheance: "desc" },
      });
      if (!precedente) throw new ErreurMetier("Période précédente introuvable.");
      const calcul = await calculRenouvellement(tx, police, precedente, saisie);
      contenu = await contenuCalcule(police, calcul.produitId, calcul.versionDateEffet, calcul.entree, { assures: avant.assures, ordresSansPrime: [], echeances: calcul.echeances, envoyeA });
      produit = { produitId: calcul.produitId, versionDateEffet: calcul.versionDateEffet };
    } else if (saisie.lignes || saisie.nombreTranches) {
      throw new ErreurMetier("Les montants d'une affaire nouvelle ou d'un avenant viennent de la police : seul « Envoyé à » se modifie.");
    }
    await tx.facture.update({ where: { id: f.id }, data: { contenu: json(contenu), ttc: contenu.totaux.ttc, ...produit } });
    await journaliser(
      { acteur: auteur(acteur), action: "FACTURE_MODIFIEE", objetType: "facture", objetId: f.id, avant: { envoyeA: avant.envoyeA, ttc: avant.totaux.ttc }, apres: { envoyeA, ttc: contenu.totaux.ttc }, adresseIp },
      tx,
    );
  });
}

// ---------------------------------------------------------------- Données des documents (facture, avoir, reçu)

type Commun = Awaited<ReturnType<typeof lireParametresSociete>>;

export function donnees(
  type: TypeAProduire,
  numero: string,
  version: number,
  dateEmission: DateIso,
  contenu: ContenuFacture,
  police: { numero: string; risque: unknown },
  commun: Commun,
  facturation: Facturation,
  auteurNom: string,
  url: string,
): Record<string, unknown> {
  const source: SourceDocument = {
    type,
    numero,
    version,
    dateEmission,
    dateValidite: null,
    policeNumero: police.numero,
    produit: contenu.produit,
    cg: null,
    cs: null,
    souscripteur: contenu.souscripteur,
    assures: contenu.assures,
    ordresSansPrime: contenu.ordresSansPrime,
    beneficiaires: null,
    contactsUrgence: null,
    intermediaires: contenu.intermediaires,
    policeMere: null,
    risque: police.risque as Risque,
    dateEffet: contenu.dateEffet,
    dateEcheance: contenu.dateEcheance,
    joursCouverts: contenu.joursCouverts,
    formules: contenu.formules,
    garanties: contenu.garanties,
    totaux: contenu.totaux,
    taxe: contenu.taxe,
    echeances: contenu.echeances,
    forcee: false,
    motifForcage: null,
    societe: commun.societe,
    mentions: commun.document,
    urlVerification: url,
    typeContrat: contenu.typeContrat,
    auteurNom,
    facturation,
  };
  return donneesDocument(source);
}

export function facturation(contenu: ContenuFacture, etat: EtatPaiements, factureOrigine: string | null, paiements: EtatPaiements["paiements"], avance?: string): Facturation {
  return {
    echeances: etat.echeances,
    // Le document ne nomme que les champs du dictionnaire : l'excédent reste dans l'avance (solde.avance).
    paiements: paiements.map((p) => ({ numero: p.numero, date: p.date, montant: p.montant, reference: p.reference, canal: LIBELLE_CANAL[p.canal], payeur: p.payeur, restantDu: p.restantDu })),
    solde: { totalPaye: etat.totalPaye, restantDu: etat.restantDu },
    ...(avance === undefined ? {} : { avance }),
    factureOrigine,
    envoyeA: contenu.envoyeA,
    dateSouscription: contenu.dateSouscription,
  };
}

/**
 * Modèle publié en vigueur pour le type : celui du produit, sinon le modèle commun (sans produit). Choisi AVANT
 * d'attribuer le numéro : sans modèle, l'émission est refusée et aucun numéro n'est consommé.
 */
export async function modeleRetenu(type: TypeAProduire, produitId: number, date: DateIso, niveauRelance: number | null = null): Promise<{ modeleVersionId: number; associes: AssociesFiges }> {
  // Relance : le modèle de SON niveau (H16 : un modèle par niveau), du produit sinon commun.
  const niveau = type === "RELANCE" ? { niveauRelance } : {};
  const retenu = (await versionPublieeEnVigueur({ type, produitId, ...niveau }, date)) ?? (await versionPublieeEnVigueur({ type, produitId: null, ...niveau }, date));
  if (!retenu) {
    const quoi = { FACTURE: "facture", AVOIR: "avoir", RECU: "reçu", AVIS_ECHEANCE: "avis d'échéance", RELANCE: `relance de niveau ${niveauRelance}` }[type];
    throw new ErreurMetier(`Aucun modèle de ${quoi} publié et en vigueur (ni pour le produit, ni commun) : déposez-le et faites-le publier (Modèles Word). Aucun numéro n'a été consommé.`);
  }
  const { ids } = await modelesAssocies(produitId, date, false);
  return { modeleVersionId: retenu.version.id, associes: { ...ids, listesEnAnnexe: [] } };
}

// ---------------------------------------------------------------- Émission d'une facture (CDC §11.4, §4.1)

export type ResultatEmission =
  | { statut: "EMISE"; numero: string; productions: IssueProduction[] }
  | { statut: "A_VALIDER"; ttc: string; seuil: string | null; demandeePar: string };

async function seuilDe(produitId: number, versionDateEffet: Date): Promise<string | null> {
  const v = await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { produitId_dateEffet: { produitId, dateEffet: versionDateEffet } }, select: { seuilValidationTtc: true } });
  return v.seuilValidationTtc ? v.seuilValidationTtc.toFixed() : null;
}

/**
 * Émet une facture (brouillon ou « À valider ») : numéro FAC attribué dans la transaction (ligne du compteur verrouillée,
 * sans trou), facture figée, document à produire figé ; le PDF est produit APRÈS la validation de la transaction. Un
 * profil « Oui (sous seuil) » au-dessus du seuil du produit enregistre une demande « À valider » sans rien émettre.
 */
export async function emettreFacture(acteur: UtilisateurCourant, factureId: number, adresseIp: string | null): Promise<ResultatEmission> {
  const niveau = await exiger(acteur, "EMETTRE_FACTURE", "émission de facture");
  const prisma = obtenirPrisma();
  const lue = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!lue || lue.type === "AVOIR") throw new ErreurMetier("Facture introuvable.");
  if (lue.statut !== "BROUILLON" && lue.statut !== "A_VALIDER") {
    throw new ErreurMetier(`Cette facture est déjà ${LIBELLE_STATUT_FACTURE[lue.statut as StatutFacture].toLowerCase()}${lue.numero ? ` (${lue.numero})` : ""}.`);
  }
  // Session 6.2a : un renouvellement prépare des montants au tarif en vigueur à sa date d'effet ; si ce produit est passé en GARANTIES entre-temps,
  // il ne s'émet plus (ni lui, ni la demande de validation). Affaire nouvelle et avenant viennent de la police, figée avec sa version (T10).
  if (lue.type === "RENOUVELLEMENT") {
    try {
      await exigerCalculAutomatiqueEnVigueur(prisma, lue.produitId, depuisDate(lue.dateEffet));
    } catch (erreur) {
      if (erreur instanceof ErreurMetier && erreur.message === MESSAGE_TARIFICATION_PAR_GARANTIES) {
        throw new ErreurMetier(`${MESSAGE_TARIFICATION_PAR_GARANTIES}. Ce brouillon de renouvellement a été préparé avant le changement de mode du produit : il ne s'émet plus, abandonnez-le (« Abandonner le brouillon »).`);
      }
      throw erreur;
    }
  }

  const ttc = lue.ttc.toFixed();
  const seuil = await seuilDe(lue.produitId, lue.versionDateEffet);
  if (validationContratRequise(niveau, ttc, seuil)) {
    if (lue.statut === "A_VALIDER") throw new ErreurMetier(`Cette facture attend déjà sa validation (demandée par ${lue.demandePar}).`);
    await prisma.$transaction(async (tx) => {
      const f = await verrouiller(tx, factureId);
      if (f.statut !== "BROUILLON") throw new ErreurMetier("Cette facture a changé entre-temps : rechargez la page.");
      await tx.facture.update({ where: { id: f.id }, data: { statut: "A_VALIDER", demandeParId: acteur.id, demandePar: acteur.identifiant, demandeLe: new Date() } });
      await journaliser({ acteur: auteur(acteur), action: "FACTURE_A_VALIDER", objetType: "facture", objetId: f.id, apres: { ttc, seuil }, adresseIp }, tx);
    });
    return { statut: "A_VALIDER", ttc, seuil, demandeePar: acteur.identifiant };
  }
  if (lue.statut === "A_VALIDER" && lue.demandeParId === acteur.id) {
    throw new ErreurMetier("Vous avez demandé la validation de cette facture : un autre valideur doit l'émettre (séparation des tâches).");
  }

  const date = aujourdhui();
  const modele = await modeleRetenu("FACTURE", lue.produitId, date);
  const commun = await lireParametresSociete(date);
  const resultat = await prisma.$transaction(async (tx) => {
    const f = await verrouiller(tx, factureId);
    if (f.statut !== "BROUILLON" && f.statut !== "A_VALIDER") throw new ErreurMetier("Cette facture vient d'être émise par quelqu'un d'autre.");
    const police = (await chargerPolice(tx, f.policeId))!;
    const contenu = contenuDe(f);
    const numero = await allouerNumero(tx, "FAC", date);
    await tx.facture.update({ where: { id: f.id }, data: { statut: "EMISE", numero, dateEmission: versDate(date), emiseParId: acteur.id, emisePar: acteur.identifiant, emiseLe: new Date() } });
    // H47 (09/10/2026) : la facture qui remplace une facture annulée reprend ses paiements, déjà reportés en avance.
    if (f.remplaceId) await imputerReports(tx, acteur, { id: f.id, numero, ttc: contenu.totaux.ttc, remplaceId: f.remplaceId, policeId: police.id }, adresseIp);
    // H66 : la facture d'avenant émise ferme la tâche « Facture d'avenant à émettre » de sa version de la liste.
    if (f.type === "AVENANT") await fermerTachesAutomatiquement(tx, police.id, auteur(acteur), adresseIp);
    const etat = etatPaiements(contenu.totaux.ttc, contenu.echeances, await encaissementsDe(tx, f.id));
    const avance = await avanceDisponible(tx, police.id);
    const idProduction = await figer(tx, {
      type: "FACTURE",
      numero,
      version: 1,
      factureId: f.id,
      produitCode: contenu.produit.code,
      policeNumero: police.numero,
      policeId: police.id,
      cotationId: police.cotationId,
      souscripteur: contenu.souscripteur,
      dateEmission: date,
      parametresDate: depuisDate(f.versionDateEffet),
      modeleVersionId: modele.modeleVersionId,
      associes: { ...modele.associes, listesEnAnnexe: contenu.listesEnAnnexe },
      donnees: (url) => donnees("FACTURE", numero, 1, date, contenu, police, commun, facturation(contenu, etat, null, etat.paiements, avance), acteur.nom, url),
      emisPar: acteur.identifiant,
    });
    await journaliser(
      {
        acteur: auteur(acteur),
        action: "FACTURE_EMISE",
        objetType: "facture",
        objetId: f.id,
        apres: { numero, type: f.type, police: police.numero, ttc: contenu.totaux.ttc, validationDemandeePar: f.statut === "A_VALIDER" ? f.demandePar : null },
        adresseIp,
      },
      tx,
    );
    return { numero, idProduction };
  }, ATTENTE);
  return { statut: "EMISE", numero: resultat.numero, productions: [await produire(acteur, resultat.idProduction, adresseIp)] };
}

// ---------------------------------------------------------------- Avoir (CDC §11.3, §11.5, T4)

/**
 * Avoir d'annulation TOTALE d'une facture émise (H47) : montants de la facture en négatif, `doc.facture_origine`, motif
 * obligatoire. Dans la même transaction : numéro AV, facture d'origine ANNULÉE (une seule fois, conservée), tous ses
 * documents émis marqués « Annulée – avoir AV-… » (page de vérification). Facture payée en partie (réponse de la Technique
 * du 09/10/2026) : chaque somme qui la réglait est REPORTÉE en avance sur la police ; la facture de remplacement la reprend
 * à son émission. Les reçus déjà émis restent valables.
 */
export async function emettreAvoir(acteur: UtilisateurCourant, factureId: number, motif: string, adresseIp: string | null): Promise<{ numero: string; avoirId: number; productions: IssueProduction[] }> {
  await exiger(acteur, "EMETTRE_AVOIR", "émission d'avoir");
  const problemes = problemesMotifAvoir(motif);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const prisma = obtenirPrisma();
  const lue = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!lue || lue.type === "AVOIR") throw new ErreurMetier("Facture introuvable.");
  const date = aujourdhui();
  const modele = await modeleRetenu("AVOIR", lue.produitId, date);
  const commun = await lireParametresSociete(date);
  const resultat = await prisma.$transaction(async (tx) => {
    const f = await verrouiller(tx, factureId);
    if (f.statut !== "EMISE" || !f.numero) throw new ErreurMetier(f.statut === "ANNULEE" ? "Cette facture est déjà annulée par un avoir." : "Seule une facture émise s'annule par un avoir ; un brouillon reste sans suite.");
    const police = (await chargerPolice(tx, f.policeId))!;
    const contenu = contenuAvoir(contenuDe(f));
    const numero = await allouerNumero(tx, "AV", date);
    const maintenant = new Date();
    const avoir = await tx.facture.create({
      data: {
        type: "AVOIR",
        statut: "EMISE",
        numero,
        policeId: f.policeId,
        produitId: f.produitId,
        versionDateEffet: f.versionDateEffet,
        factureOrigineId: f.id,
        dateEffet: f.dateEffet,
        dateEcheance: f.dateEcheance,
        contenu: json(contenu),
        ttc: contenu.totaux.ttc,
        motif: motif.trim(),
        creeParId: acteur.id,
        creePar: acteur.identifiant,
        emiseParId: acteur.id,
        emisePar: acteur.identifiant,
        emiseLe: maintenant,
        dateEmission: versDate(date),
      },
    });
    await tx.facture.update({ where: { id: f.id }, data: { statut: "ANNULEE", annuleeParId: avoir.id, annuleeLe: maintenant } });
    await reporterEncaissements(tx, acteur, { id: f.id, numero: f.numero, policeId: f.policeId }, numero, adresseIp);
    await tx.documentEmis.updateMany({ where: { numero: f.numero, annuleParNumero: null }, data: { annuleParNumero: numero, annuleLe: maintenant } });
    // Avis d'échéance et relances de la facture (session 5b) : annulés avec elle (page de vérification, T12).
    await tx.documentEmis.updateMany({ where: { production: { is: { factureId: f.id, type: { in: ["AVIS_ECHEANCE", "RELANCE"] } } }, annuleParNumero: null }, data: { annuleParNumero: numero, annuleLe: maintenant } });
    const etat = { totalPaye: "0", restantDu: "0", echeances: [], paiements: [] };
    const idProduction = await figer(tx, {
      type: "AVOIR",
      numero,
      version: 1,
      factureId: avoir.id,
      produitCode: contenu.produit.code,
      policeNumero: police.numero,
      policeId: police.id,
      cotationId: police.cotationId,
      souscripteur: contenu.souscripteur,
      dateEmission: date,
      parametresDate: depuisDate(f.versionDateEffet),
      modeleVersionId: modele.modeleVersionId,
      associes: { ...modele.associes, listesEnAnnexe: contenu.listesEnAnnexe },
      donnees: (url) => donnees("AVOIR", numero, 1, date, contenu, police, commun, facturation(contenu, etat, f.numero, []), acteur.nom, url),
      emisPar: acteur.identifiant,
    });
    await journaliser({ acteur: auteur(acteur), action: "AVOIR_EMIS", objetType: "facture", objetId: avoir.id, apres: { numero, factureOrigine: f.numero, ttc: contenu.totaux.ttc, motif: motif.trim() }, adresseIp }, tx);
    await journaliser({ acteur: auteur(acteur), action: "FACTURE_ANNULEE", objetType: "facture", objetId: f.id, avant: { statut: "EMISE" }, apres: { numero: f.numero, avoir: numero }, adresseIp }, tx);
    return { numero, avoirId: avoir.id, idProduction };
  }, ATTENTE);
  return { numero: resultat.numero, avoirId: resultat.avoirId, productions: [await produire(acteur, resultat.idProduction, adresseIp)] };
}

// ---------------------------------------------------------------- Report des sommes d'une facture annulée (H47)

/**
 * Avoir sur une facture payée en partie : chaque somme qui la réglait (part d'un paiement hors excédent, imputation d'avance)
 * devient un REPORT en avance sur la police, dans l'ordre d'enregistrement, avec son paiement d'origine. Journalisé un par un.
 */
async function reporterEncaissements(tx: Tx, acteur: UtilisateurCourant, f: { id: number; numero: string; policeId: number }, numeroAvoir: string, adresseIp: string | null): Promise<void> {
  const [paiements, imputations] = await Promise.all([
    tx.paiement.findMany({ where: { factureId: f.id }, orderBy: { id: "asc" } }),
    tx.mouvementAvance.findMany({ where: { factureId: f.id, type: "IMPUTATION" }, include: { paiement: { select: { numeroRecu: true } } }, orderBy: { id: "asc" } }),
  ]);
  const sommes = [
    ...paiements.map((p) => ({ quand: p.creeLe.getTime(), montant: partReglee({ montant: p.montant.toFixed(), excedent: p.excedent.toFixed() }), date: p.date, paiementId: p.id as number | null, recu: p.numeroRecu as string | null })),
    ...imputations.map((i) => ({ quand: i.creeLe.getTime(), montant: montant(i.montant.toFixed()), date: i.date, paiementId: i.paiementId, recu: i.paiement?.numeroRecu ?? null })),
  ].sort((a, b) => a.quand - b.quand);
  for (const somme of sommes) {
    if (!somme.montant.greaterThan(0)) continue;
    await tx.mouvementAvance.create({ data: { policeId: f.policeId, type: "REPORT", montant: somme.montant.toFixed(), date: somme.date, paiementId: somme.paiementId, factureAnnuleeId: f.id, creeParId: acteur.id, creePar: acteur.identifiant } });
    await journaliser(
      { acteur: auteur(acteur), action: "PAIEMENT_REPORTE", objetType: "facture", objetId: f.id, apres: { factureAnnulee: f.numero, avoir: numeroAvoir, recu: somme.recu, montant: somme.montant.toFixed(), date: depuisDate(somme.date), vers: "avance de la police, pour la facture de remplacement" }, adresseIp },
      tx,
    );
  }
}

/**
 * Émission de la facture qui remplace une facture annulée : les sommes reportées de celle-ci lui sont imputées, dans l'ordre,
 * au plus son TTC et au plus l'avance encore disponible. L'excédent éventuel reste en avance (H33).
 */
async function imputerReports(tx: Tx, acteur: UtilisateurCourant, f: { id: number; numero: string; ttc: string; remplaceId: number; policeId: number }, adresseIp: string | null): Promise<void> {
  const reports = await tx.mouvementAvance.findMany({ where: { type: "REPORT", factureAnnuleeId: f.remplaceId }, include: { paiement: { select: { numeroRecu: true } } }, orderBy: { id: "asc" } });
  if (reports.length === 0) return;
  const annulee = await tx.facture.findUnique({ where: { id: f.remplaceId }, select: { numero: true } });
  let reste = montant(f.ttc);
  let disponible = montant(await avanceDisponible(tx, f.policeId));
  for (const r of reports) {
    const candidats = [montant(r.montant.toFixed()), reste, disponible];
    const m = candidats.reduce((a, b) => (b.lessThan(a) ? b : a));
    if (!m.greaterThan(0)) break;
    await tx.mouvementAvance.create({ data: { policeId: f.policeId, type: "IMPUTATION", montant: m.toFixed(), date: r.date, paiementId: r.paiementId, factureId: f.id, reportId: r.id, creeParId: acteur.id, creePar: acteur.identifiant } });
    await journaliser(
      { acteur: auteur(acteur), action: "AVANCE_IMPUTEE", objetType: "facture", objetId: f.id, apres: { facture: f.numero, origine: "REPORT", factureAnnulee: annulee?.numero ?? null, recu: r.paiement?.numeroRecu ?? null, montant: m.toFixed() }, adresseIp },
      tx,
    );
    reste = reste.minus(m);
    disponible = disponible.minus(m);
  }
}

// ---------------------------------------------------------------- Paiements et reçus (CDC §12)

/**
 * Enregistre un paiement (ajout seul) : contrôles du domaine (montant > 0 par l'analyseur unique, facture émise non
 * annulée), numéro REC attribué dans la transaction, reçu figé, et nouvelle version de la facture (même numéro, version + 1,
 * échéances payées dans l'ordre, restant dû à jour) figée avec le MÊME modèle que la version 1. Trop-perçu accepté (H33,
 * 09/10/2026) : la part au-delà du restant dû est l'excédent du paiement, crédité en avance sur la police (reçu : solde.avance).
 */
export async function enregistrerPaiement(
  acteur: UtilisateurCourant,
  factureId: number,
  saisie: SaisiePaiement,
  adresseIp: string | null,
): Promise<{ numeroRecu: string; restantDu: string; excedent: string; avance: string; productions: IssueProduction[] }> {
  await exiger(acteur, "ENREGISTRER_PAIEMENT", "enregistrement de paiement");
  const prisma = obtenirPrisma();
  const lue = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!lue) throw new ErreurMetier("Facture introuvable.");
  const date = aujourdhui();
  const modeleRecu = await modeleRetenu("RECU", lue.produitId, date).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
  const commun = await lireParametresSociete(date);
  const resultat = await prisma.$transaction(async (tx) => {
    const f = await verrouiller(tx, factureId);
    const contenu = contenuDe(f);
    const avant = await encaissementsDe(tx, factureId);
    const etatAvant = etatPaiements(contenu.totaux.ttc, contenu.echeances, avant);
    const controle = controlerPaiement(saisie, { statut: f.statut as StatutFacture, type: f.type as TypeFacture, numero: f.numero, restantDu: etatAvant.restantDu }, date);
    if (controle.problemes.length > 0 || !controle.montant) throw new ErreurMetier(controle.problemes.join(" "));
    if (!f.numero) throw new ErreurMetier("Facture sans numéro.");
    // Sans modèle de reçu, refus APRÈS les contrôles du paiement et AVANT le numéro REC : rien n'est consommé.
    if (modeleRecu instanceof Error) throw modeleRecu;
    const v1 = await tx.documentAProduire.findUnique({ where: { numero_version: { numero: f.numero, version: 1 } } });
    if (!v1) throw new ErreurMetier(`Version 1 de la facture ${f.numero} introuvable.`);
    const police = (await chargerPolice(tx, f.policeId))!;

    const numeroRecu = await allouerNumero(tx, "REC", date);
    const payeur = saisie.payeur.trim() || nomFacture(contenu.souscripteur); // H54 : par défaut, « Facturé à »
    const paiement = await tx.paiement.create({
      data: { factureId, numeroRecu, date: versDate(saisie.date), montant: controle.montant, excedent: controle.excedent, canal: saisie.canal, reference: saisie.reference.trim(), payeur, creeParId: acteur.id, creePar: acteur.identifiant },
    });
    if (montant(controle.excedent).greaterThan(0)) {
      await tx.mouvementAvance.create({ data: { policeId: police.id, type: "EXCEDENT", montant: controle.excedent, date: versDate(saisie.date), paiementId: paiement.id, creeParId: acteur.id, creePar: acteur.identifiant } });
      await journaliser(
        { acteur: auteur(acteur), action: "AVANCE_CREDITEE", objetType: "police", objetId: police.id, apres: { police: police.numero, origine: "TROP_PERCU", facture: f.numero, recu: numeroRecu, montant: controle.excedent }, adresseIp },
        tx,
      );
    }
    const avance = await avanceDisponible(tx, police.id);
    const tous = [...avant, { numero: numeroRecu, date: saisie.date, montant: controle.montant, excedent: controle.excedent, reference: saisie.reference.trim(), canal: saisie.canal as CanalPaiement, payeur }];
    const etat = etatPaiements(contenu.totaux.ttc, contenu.echeances, tous);
    const commun4 = { produitCode: contenu.produit.code, policeNumero: police.numero, policeId: police.id, cotationId: police.cotationId, souscripteur: contenu.souscripteur, dateEmission: date, parametresDate: depuisDate(f.versionDateEffet), emisPar: acteur.identifiant };

    // Reçu : CE paiement, le solde après lui, la facture réglée (doc.facture_origine).
    const cePaiement = etat.paiements.slice(-1);
    const idRecu = await figer(tx, {
      ...commun4,
      type: "RECU",
      numero: numeroRecu,
      version: 1,
      factureId,
      paiementId: paiement.id,
      modeleVersionId: modeleRecu.modeleVersionId,
      associes: modeleRecu.associes,
      donnees: (url) => donnees("RECU", numeroRecu, 1, date, contenu, police, commun, facturation(contenu, etat, f.numero, cePaiement, avance), acteur.nom, url),
    });
    // Facture rééditée : même numéro, version + 1, mêmes modèles que la version 1, paiements et restant dû à jour.
    const version = await prochaineVersion(tx, f.numero);
    const numeroFacture = f.numero;
    const idFacture = await figer(tx, {
      ...commun4,
      type: "FACTURE",
      numero: numeroFacture,
      version,
      factureId,
      paiementId: paiement.id,
      dateEmission: depuisDate(v1.dateEmission),
      modeleVersionId: v1.modeleVersionId,
      associes: v1.versionsAssociees as unknown as AssociesFiges,
      donnees: (url) => donnees("FACTURE", numeroFacture, version, depuisDate(v1.dateEmission), contenu, police, commun, facturation(contenu, etat, null, etat.paiements, avance), acteur.nom, url),
    });
    await journaliser(
      {
        acteur: auteur(acteur),
        action: "PAIEMENT_ENREGISTRE",
        objetType: "facture",
        objetId: factureId,
        apres: { facture: f.numero, recu: numeroRecu, montant: controle.montant, excedent: controle.excedent, canal: saisie.canal, date: saisie.date, restantDu: etat.restantDu, versionFacture: version },
        adresseIp,
      },
      tx,
    );
    return { numeroRecu, restantDu: etat.restantDu, excedent: controle.excedent, avance, ids: [idRecu, idFacture] };
  }, ATTENTE);
  const productions: IssueProduction[] = [];
  for (const id of resultat.ids) productions.push(await produire(acteur, id, adresseIp));
  return { numeroRecu: resultat.numeroRecu, restantDu: resultat.restantDu, excedent: resultat.excedent, avance: resultat.avance, productions };
}

// ---------------------------------------------------------------- Avance sur police (H33, session 6.0)

/**
 * Impute l'avance de la police sur une facture émise et en cours, au plus son restant dû, après confirmation de l'utilisateur
 * (proposée à l'émission ou au paiement de la facture suivante). Pas de reçu (aucune somme nouvelle) ; la facture est rééditée
 * (même numéro, version + 1, mêmes modèles que la version 1) avec l'imputation dans ses paiements.
 */
export async function imputerAvance(acteur: UtilisateurCourant, factureId: number, saisi: string, adresseIp: string | null): Promise<{ restantDu: string; avance: string; productions: IssueProduction[] }> {
  await exiger(acteur, "ENREGISTRER_PAIEMENT", "imputation d'une avance");
  const prisma = obtenirPrisma();
  const date = aujourdhui();
  const commun = await lireParametresSociete(date);
  const resultat = await prisma.$transaction(async (tx) => {
    const f = await verrouiller(tx, factureId);
    await tx.$queryRaw`SELECT id FROM polices WHERE id = ${f.policeId} FOR UPDATE`;
    const contenu = contenuDe(f);
    const avant = await encaissementsDe(tx, factureId);
    const etatAvant = etatPaiements(contenu.totaux.ttc, contenu.echeances, avant);
    const disponible = await avanceDisponible(tx, f.policeId);
    const controle = controlerImputation(saisi, disponible, { statut: f.statut as StatutFacture, type: f.type as TypeFacture, restantDu: etatAvant.restantDu });
    if (controle.problemes.length > 0 || !controle.montant || !f.numero) throw new ErreurMetier(controle.problemes.join(" "));
    const v1 = await tx.documentAProduire.findUnique({ where: { numero_version: { numero: f.numero, version: 1 } } });
    if (!v1) throw new ErreurMetier(`Version 1 de la facture ${f.numero} introuvable.`);
    const police = (await chargerPolice(tx, f.policeId))!;
    await tx.mouvementAvance.create({ data: { policeId: f.policeId, type: "IMPUTATION", montant: controle.montant, date: versDate(date), factureId, creeParId: acteur.id, creePar: acteur.identifiant } });
    const encaisses = await encaissementsDe(tx, factureId);
    const etat = etatPaiements(contenu.totaux.ttc, contenu.echeances, encaisses);
    const avance = await avanceDisponible(tx, f.policeId);
    const version = await prochaineVersion(tx, f.numero);
    const numeroFacture = f.numero;
    const idFacture = await figer(tx, {
      type: "FACTURE",
      numero: numeroFacture,
      version,
      factureId,
      produitCode: contenu.produit.code,
      policeNumero: police.numero,
      policeId: police.id,
      cotationId: police.cotationId,
      souscripteur: contenu.souscripteur,
      dateEmission: depuisDate(v1.dateEmission),
      parametresDate: depuisDate(f.versionDateEffet),
      modeleVersionId: v1.modeleVersionId,
      associes: v1.versionsAssociees as unknown as AssociesFiges,
      donnees: (url) => donnees("FACTURE", numeroFacture, version, depuisDate(v1.dateEmission), contenu, police, commun, facturation(contenu, etat, null, etat.paiements, avance), acteur.nom, url),
      emisPar: acteur.identifiant,
    });
    await journaliser(
      { acteur: auteur(acteur), action: "AVANCE_IMPUTEE", objetType: "facture", objetId: factureId, apres: { facture: f.numero, origine: "AVANCE", montant: controle.montant, restantDu: etat.restantDu, avanceRestante: avance, versionFacture: version }, adresseIp },
      tx,
    );
    return { restantDu: etat.restantDu, avance, idFacture };
  }, ATTENTE);
  return { restantDu: resultat.restantDu, avance: resultat.avance, productions: [await produire(acteur, resultat.idFacture, adresseIp)] };
}

/** Restitue tout ou partie de l'avance d'une police : date, montant, canal, référence. Pas de nouveau document (H74). */
export async function restituerAvance(acteur: UtilisateurCourant, policeId: number, saisie: SaisieRestitution, adresseIp: string | null): Promise<{ avance: string }> {
  await exiger(acteur, "ENREGISTRER_PAIEMENT", "restitution d'une avance");
  return obtenirPrisma().$transaction(async (tx) => {
    const police = await tx.police.findUnique({ where: { id: policeId }, select: { id: true, numero: true } });
    if (!police) throw new ErreurMetier("Police introuvable.");
    await tx.$queryRaw`SELECT id FROM polices WHERE id = ${policeId} FOR UPDATE`;
    const disponible = await avanceDisponible(tx, policeId);
    const controle = controlerRestitution(saisie, disponible, aujourdhui());
    if (controle.problemes.length > 0 || !controle.montant) throw new ErreurMetier(controle.problemes.join(" "));
    await tx.mouvementAvance.create({
      data: { policeId, type: "RESTITUTION", montant: controle.montant, date: versDate(saisie.date), canal: saisie.canal, reference: saisie.reference.trim(), creeParId: acteur.id, creePar: acteur.identifiant },
    });
    const avance = await avanceDisponible(tx, policeId);
    await journaliser(
      { acteur: auteur(acteur), action: "AVANCE_RESTITUEE", objetType: "police", objetId: policeId, apres: { police: police.numero, montant: controle.montant, date: saisie.date, canal: saisie.canal, reference: saisie.reference.trim(), avanceRestante: avance }, adresseIp },
      tx,
    );
    return { avance };
  });
}

export const LIBELLE_MOUVEMENT_AVANCE: Record<string, string> = {
  EXCEDENT: "Trop-perçu",
  REPORT: "Report (facture annulée)",
  IMPUTATION: "Imputation sur facture",
  RESTITUTION: "Restitution",
};

export type AvanceDePolice = {
  disponible: string;
  /** Sommes reportées d'une facture annulée, dont la facture de remplacement n'est pas encore émise (H73) : à afficher en avertissement. */
  reportsEnAttente: ReportEnAttente[];
  mouvements: { id: number; type: string; libelle: string; credit: boolean; date: DateIso; montant: string; facture: string | null; recu: string | null; canal: string | null; reference: string | null; par: string }[];
};

/** Avance d'une police et ses mouvements, du plus ancien au plus récent (fiche de la police). */
export async function avanceDePolice(acteur: UtilisateurCourant, policeId: number): Promise<AvanceDePolice> {
  await exigerLecture(acteur);
  const prisma = obtenirPrisma();
  const lignes = await prisma.mouvementAvance.findMany({
    where: { policeId },
    include: { paiement: { select: { numeroRecu: true } }, facture: { select: { numero: true } }, factureAnnulee: { select: { numero: true } } },
    orderBy: { id: "asc" },
  });
  return {
    disponible: await avanceDisponible(prisma, policeId),
    reportsEnAttente: await reportsEnAttente(prisma, policeId),
    mouvements: lignes.map((m) => ({
      id: m.id,
      type: m.type,
      libelle: LIBELLE_MOUVEMENT_AVANCE[m.type] ?? m.type,
      credit: m.type === "EXCEDENT" || m.type === "REPORT",
      date: depuisDate(m.date),
      montant: m.montant.toFixed(),
      facture: m.facture?.numero ?? m.factureAnnulee?.numero ?? null,
      recu: m.paiement?.numeroRecu ?? null,
      canal: m.canal ? LIBELLE_CANAL[m.canal as CanalPaiement] : null,
      reference: m.reference,
      par: m.creePar,
    })),
  };
}

// ---------------------------------------------------------------- PDF en attente (CDC §11.4)

/** Relance, à l'identique, la production des PDF en attente d'une facture (et de ses reçus) ou d'un avoir. */
export async function relancerPdf(acteur: UtilisateurCourant, factureId: number, adresseIp: string | null): Promise<IssueProduction[]> {
  const d = await exigerLecture(acteur);
  if (!peutAgir(d.facture) && !peutAgir(d.avoir) && !peutAgir(d.paiement)) throw new ErreurAcces("Droit insuffisant : factures.");
  return produireEnAttente(acteur, { factureIds: [factureId] }, adresseIp);
}

// ---------------------------------------------------------------- Lecture

export type LigneFactureLue = {
  id: number;
  type: TypeFacture;
  libelleType: string;
  statut: StatutFacture;
  libelleStatut: string;
  numero: string | null;
  policeId: number;
  policeNumero: string;
  cotationId: number;
  produitCode: string;
  souscripteur: string;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  dateEmission: DateIso | null;
  ttc: string;
  restantDu: string | null;
  pdfEnAttente: number;
};

export type DocumentFacture = { numero: string; version: number; type: string; statut: "EN_ATTENTE" | "PRODUIT"; documentId: number | null; tentatives: number; derniereErreur: string | null };

export type FactureLue = LigneFactureLue & {
  contenu: ContenuFacture;
  motif: string | null;
  factureOrigine: { id: number; numero: string | null } | null;
  avoir: { id: number; numero: string | null } | null;
  remplace: { id: number; numero: string | null } | null;
  remplacante: { id: number; numero: string | null; statut: string } | null;
  creePar: string;
  creeLe: Date;
  demandePar: string | null;
  demandeLe: Date | null;
  emisePar: string | null;
  emiseLe: Date | null;
  seuil: string | null;
  etat: EtatPaiements | null;
  documents: DocumentFacture[];
  /** Avance disponible de la police (H33), imputation proposée sur cette facture (0 : rien à proposer), et sommes reportées encore en attente de leur facture de remplacement (H73). */
  avance: { disponible: string; proposee: string; reportsEnAttente: ReportEnAttente[] };
  /** Facture annulée : sommes reportées en avance sur la police (H47). */
  reports: { recu: string | null; date: DateIso; montant: string }[];
  /** Brouillon abandonné (session 6.2b, H87) : qui, quand, pourquoi. */
  abandon: { par: string; le: Date; motif: string } | null;
  actions: { abandonner: boolean; modifier: boolean; emettre: boolean; emettreSousSeuil: boolean; avoir: boolean; payer: boolean; imputer: boolean; relancer: boolean };
};

const inclusion = {
  police: { select: { numero: true, cotationId: true, souscripteur: true } },
  produit: { select: { code: true } },
  paiements: { orderBy: { id: "asc" as const } },
  imputations: inclusionImputations,
  aProduire: { orderBy: [{ numero: "asc" as const }, { version: "asc" as const }] },
};
type FactureComplete = Prisma.FactureGetPayload<{ include: typeof inclusion }>;

function ligne(f: FactureComplete): LigneFactureLue & { etat: EtatPaiements | null } {
  const contenu = contenuDe(f);
  const etat = f.type !== "AVOIR" && (f.statut === "EMISE" || f.statut === "ANNULEE") ? etatPaiements(contenu.totaux.ttc, contenu.echeances, versEncaissements(f.paiements, f.imputations)) : null;
  return {
    id: f.id,
    type: f.type as TypeFacture,
    libelleType: LIBELLE_TYPE_FACTURE[f.type as TypeFacture],
    statut: f.statut as StatutFacture,
    libelleStatut: LIBELLE_STATUT_FACTURE[f.statut as StatutFacture],
    numero: f.numero,
    policeId: f.policeId,
    policeNumero: f.police.numero,
    cotationId: f.police.cotationId,
    produitCode: f.produit.code,
    souscripteur: nomFacture(f.police.souscripteur as unknown as Souscripteur),
    dateEffet: depuisDate(f.dateEffet),
    dateEcheance: depuisDate(f.dateEcheance),
    dateEmission: f.dateEmission ? depuisDate(f.dateEmission) : null,
    ttc: f.ttc.toFixed(),
    restantDu: etat?.restantDu ?? null,
    pdfEnAttente: f.aProduire.filter((p) => p.statut === "EN_ATTENTE").length,
    etat,
  };
}

function sansEtat(f: FactureComplete): LigneFactureLue {
  const l: Partial<ReturnType<typeof ligne>> = ligne(f);
  delete l.etat;
  return l as LigneFactureLue;
}

export type FiltresFactures = { statut?: string; numero?: string; police?: string };

export async function listerFactures(acteur: UtilisateurCourant, filtres: FiltresFactures = {}): Promise<LigneFactureLue[]> {
  await exigerLecture(acteur);
  const lignes = await obtenirPrisma().facture.findMany({
    where: {
      ...(filtres.statut ? { statut: filtres.statut } : {}),
      ...(filtres.numero ? { numero: { contains: filtres.numero.trim(), mode: "insensitive" } } : {}),
      ...(filtres.police ? { police: { numero: { contains: filtres.police.trim(), mode: "insensitive" } } } : {}),
    },
    include: inclusion,
    orderBy: [{ id: "desc" }],
    take: 200,
  });
  return lignes.map(sansEtat);
}

export async function lireFacture(acteur: UtilisateurCourant, id: number): Promise<FactureLue | null> {
  const d = await exigerLecture(acteur);
  const prisma = obtenirPrisma();
  const f = await prisma.facture.findUnique({ where: { id }, include: inclusion });
  if (!f) return null;
  const base = ligne(f);
  const lien = (x: { id: number; numero: string | null } | null) => (x ? { id: x.id, numero: x.numero } : null);
  const [origine, avoir, remplace, remplacante] = await Promise.all([
    f.factureOrigineId ? prisma.facture.findUnique({ where: { id: f.factureOrigineId }, select: { id: true, numero: true } }) : null,
    f.annuleeParId ? prisma.facture.findUnique({ where: { id: f.annuleeParId }, select: { id: true, numero: true } }) : null,
    f.remplaceId ? prisma.facture.findUnique({ where: { id: f.remplaceId }, select: { id: true, numero: true } }) : null,
    prisma.facture.findFirst({ where: { remplaceId: f.id }, select: { id: true, numero: true, statut: true }, orderBy: { id: "desc" } }),
  ]);
  const seuil = f.type === "AVOIR" ? null : await seuilDe(f.produitId, f.versionDateEffet);
  const disponible = await avanceDisponible(prisma, f.policeId);
  const proposee = base.etat && f.statut === "EMISE" && f.type !== "AVOIR" ? imputationProposee(disponible, base.etat.restantDu) : "0";
  const reports = await prisma.mouvementAvance.findMany({ where: { type: "REPORT", factureAnnuleeId: f.id }, include: { paiement: { select: { numeroRecu: true } } }, orderBy: { id: "asc" } });
  const ouverte = f.statut === "BROUILLON" || f.statut === "A_VALIDER";
  const sousSeuil = ouverte && validationContratRequise(d.facture, f.ttc.toFixed(), seuil);
  return {
    ...base,
    contenu: contenuDe(f),
    motif: f.motif,
    factureOrigine: lien(origine),
    avoir: lien(avoir),
    remplace: lien(remplace),
    remplacante: remplacante ? { id: remplacante.id, numero: remplacante.numero, statut: LIBELLE_STATUT_FACTURE[remplacante.statut as StatutFacture] } : null,
    creePar: f.creePar,
    creeLe: f.creeLe,
    demandePar: f.demandePar,
    demandeLe: f.demandeLe,
    emisePar: f.emisePar,
    emiseLe: f.emiseLe,
    seuil,
    documents: f.aProduire.map((p) => ({ numero: p.numero, version: p.version, type: p.type, statut: p.statut as DocumentFacture["statut"], documentId: p.documentId, tentatives: p.tentatives, derniereErreur: p.derniereErreur })),
    avance: { disponible, proposee, reportsEnAttente: await reportsEnAttente(prisma, f.policeId) },
    reports: reports.map((r) => ({ recu: r.paiement?.numeroRecu ?? null, date: depuisDate(r.date), montant: r.montant.toFixed() })),
    abandon: f.statut === "ABANDONNEE" && f.abandonnePar && f.abandonneLe && f.motifAbandon ? { par: f.abandonnePar, le: f.abandonneLe, motif: f.motifAbandon } : null,
    actions: {
      // Un brouillon ou une demande « À valider » s'abandonne (H87) ; jamais un avoir ni une facture émise.
      abandonner: ouverte && f.type !== "AVOIR" && peutAgir(d.facture),
      modifier: f.statut === "BROUILLON" && peutAgir(d.facture),
      // Le demandeur d'une validation ne l'émet pas lui-même ; une demande « À valider » ne se refait pas.
      emettre: ouverte && peutAgir(d.facture) && !(f.statut === "A_VALIDER" && (sousSeuil || f.demandeParId === acteur.id)),
      emettreSousSeuil: sousSeuil && f.statut === "BROUILLON",
      // H47 (09/10/2026) : une facture payée en partie s'annule aussi ; ses sommes sont reportées.
      avoir: f.type !== "AVOIR" && f.statut === "EMISE" && peutAgir(d.avoir),
      payer: f.type !== "AVOIR" && f.statut === "EMISE" && peutAgir(d.paiement) && base.etat !== null && montant(base.etat.restantDu).greaterThan(0),
      imputer: montant(proposee).greaterThan(0) && peutAgir(d.paiement),
      relancer: base.pdfEnAttente > 0,
    },
  };
}

export type FacturesDePolice = {
  police: { id: number; numero: string; cotationId: number; typeContrat: string | null; dateEffet: DateIso; dateEcheance: DateIso; souscripteur: string; cpEmises: boolean };
  factures: LigneFactureLue[];
  possibles: { affaireNouvelle: boolean; renouvellement: { dateEffet: DateIso; dateEcheance: DateIso } | null; avenants: { numero: number; dateEffet: DateIso; adherents: number }[] };
  /** Avance de la police (H33, H47) : solde créditeur et mouvements. */
  avance: AvanceDePolice;
  droits: { creer: boolean; restituer: boolean };
};

/** Factures d'une police et factures qu'on peut encore y créer (écran de la cotation acceptée). */
export async function facturesDePolice(acteur: UtilisateurCourant, cotationId: number): Promise<FacturesDePolice | null> {
  const d = await exigerLecture(acteur);
  const prisma = obtenirPrisma();
  const police = await prisma.police.findUnique({ where: { cotationId }, include: { adherents: { orderBy: { numero: "asc" } } } });
  if (!police) return null;
  const toutes = await prisma.facture.findMany({ where: { policeId: police.id }, include: inclusion, orderBy: [{ id: "asc" }] });
  const cpEmises = (await prisma.documentEmis.count({ where: { policeId: police.id, type: "CP" } })) > 0;
  const vivantes = toutes.filter((f) => f.statut !== "ANNULEE" && f.statut !== "ABANDONNEE");
  const derniere = vivantes.filter((f) => f.type === "AFFAIRE_NOUVELLE" || f.type === "RENOUVELLEMENT").sort((a, b) => b.dateEcheance.getTime() - a.dateEcheance.getTime())[0];
  const facturees = new Set(vivantes.filter((f) => f.type === "AVENANT").map((f) => f.adherentsVersion));
  return {
    police: {
      id: police.id,
      numero: police.numero,
      cotationId,
      typeContrat: police.typeContrat,
      dateEffet: depuisDate(police.dateEffet),
      dateEcheance: depuisDate(police.dateEcheance),
      souscripteur: nomFacture(police.souscripteur as unknown as Souscripteur),
      cpEmises,
    },
    factures: toutes.map(sansEtat),
    possibles: {
      affaireNouvelle: cpEmises && !vivantes.some((f) => f.type === "AFFAIRE_NOUVELLE"),
      renouvellement: derniere && derniere.statut === "EMISE" ? periodeRenouvellement(depuisDate(derniere.dateEcheance)) : null,
      avenants: police.adherents
        .filter((v) => v.motif === "INCORPORATION" && !facturees.has(v.numero))
        .map((v) => ({ numero: v.numero, dateEffet: depuisDate(v.dateEffet), adherents: (v.concernes as unknown as number[]).length })),
    },
    avance: await avanceDePolice(acteur, police.id),
    droits: { creer: peutAgir(d.facture), restituer: peutAgir(d.paiement) },
  };
}
