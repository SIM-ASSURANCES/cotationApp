import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { peutAgir, peutLire } from "@/domaine/droits";
import {
  avisDu,
  echeancesDe,
  factureAppelable,
  joursDeRetard,
  PARAMETRES_RELANCE_DEFAUT,
  problemesParametresRelance,
  relanceDue,
  type EcheanceDue,
  type NiveauRelance,
  type ParametresRelance,
} from "@/domaine/facturation/echeances";
import { etatPaiements, nomFacture, type ContenuFacture } from "@/domaine/facturation/factures";

import { dejaJournalise, journaliser, type ActeurAudit } from "./audit";
import { niveauDuProfil } from "./droits";
import { chargerPolice, contenuDe, donnees, facturation, modeleRetenu, paiementsDe, verrouiller } from "./factures";
import { allouerNumero } from "./numerotation";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { figer, produire, type IssueProduction } from "./production";
import { ajouterParametre, lireParametresSociete, valeurEnVigueur } from "./societe";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { versUtilisateurCourant } from "./utilisateurs";

/**
 * Avis d'échéance et relances (CDC §12, session 5b, D25).
 *
 * - Paramètres par produit (délai J-x de l'avis, niveaux de relance J+x), historisés dans la table `parametres`
 *   (clé `relances.<PRODUIT>`) : une nouvelle valeur s'ajoute avec sa date d'effet, jamais dans le passé.
 * - Liste du jour : recalculée à chaque lecture depuis les factures émises, les paiements et les documents déjà produits.
 * - Génération individuelle ou par lot (file de tâches) : tout est RE-VÉRIFIÉ au moment de la génération, dans la
 *   transaction qui attribue le numéro (facture verrouillée) : une échéance payée, ou dont la facture est annulée par un
 *   avoir, ne produit plus rien. Un seul avis par échéance, une seule relance par (échéance, niveau) : garanti par la
 *   base (index uniques partiels de `documents_a_produire`).
 * - Aucun envoi automatique (e-mail, SMS, WhatsApp) : hors périmètre (CDC §2.4). Les PDF se téléchargent.
 */

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });

export type TypeAppel = "AVIS_ECHEANCE" | "RELANCE";

// ---------------------------------------------------------------- Droits (H21 : avis et relances ← « Émettre une facture »)

async function exiger(acteur: UtilisateurCourant, ecriture: boolean): Promise<void> {
  const niveau = await niveauDuProfil(acteur.profil, "EMETTRE_FACTURE");
  if (!(ecriture ? peutAgir(niveau) : peutLire(niveau))) throw new ErreurAcces("Droit insuffisant : avis d'échéance et relances.");
}

async function exigerParametrage(acteur: UtilisateurCourant, ecriture: boolean): Promise<void> {
  const niveau = await niveauDuProfil(acteur.profil, "PARAMETRER_PRODUITS");
  if (!(ecriture ? peutAgir(niveau) : peutLire(niveau))) throw new ErreurAcces("Droit insuffisant : paramétrage des produits.");
}

// ---------------------------------------------------------------- Paramètres par produit (historisés)

export const cleParametresRelance = (produitCode: string) => `relances.${produitCode}`;

function lire(valeur: string | null): ParametresRelance {
  if (!valeur) return PARAMETRES_RELANCE_DEFAUT;
  return JSON.parse(valeur) as ParametresRelance;
}

/** Paramètres en vigueur à une date pour un produit (défaut du CDC sans paramétrage : J-15 ; J+7, J+15, J+30). */
export async function lireParametresRelance(produitCode: string, date: DateIso): Promise<ParametresRelance> {
  return lire(await valeurEnVigueur(cleParametresRelance(produitCode), date));
}

export type ParametresRelanceLus = {
  produitCode: string;
  enVigueur: ParametresRelance;
  parDefaut: boolean;
  historique: { valeur: ParametresRelance; dateEffet: DateIso; creePar: string; creeLe: Date }[];
};

export async function consulterParametresRelance(acteur: UtilisateurCourant, produitCode: string): Promise<ParametresRelanceLus | null> {
  await exigerParametrage(acteur, false);
  if (!(await obtenirPrisma().produit.findUnique({ where: { code: produitCode }, select: { id: true } }))) return null;
  const lignes = await obtenirPrisma().parametre.findMany({ where: { cle: cleParametresRelance(produitCode) }, orderBy: { dateEffet: "desc" } });
  const valeur = await valeurEnVigueur(cleParametresRelance(produitCode), aujourdhui());
  return {
    produitCode,
    enVigueur: lire(valeur),
    parDefaut: valeur === null,
    historique: lignes.map((l) => ({ valeur: lire(l.valeur), dateEffet: depuisDate(l.dateEffet), creePar: l.creePar, creeLe: l.creeLe })),
  };
}

/** Nouveaux paramètres d'un produit, à une date d'effet jamais rétroactive : historisés et journalisés (avant, après). */
export async function enregistrerParametresRelance(acteur: UtilisateurCourant, produitCode: string, p: ParametresRelance, dateEffet: DateIso, adresseIp: string | null): Promise<void> {
  await exigerParametrage(acteur, true);
  if (!(await obtenirPrisma().produit.findUnique({ where: { code: produitCode }, select: { id: true } }))) throw new ErreurMetier("Produit inconnu.");
  const propre: ParametresRelance = { delaiAvisJours: p.delaiAvisJours, niveaux: p.niveaux.map((n) => ({ niveau: n.niveau, jours: n.jours, libelle: n.libelle.trim() })) };
  const problemes = problemesParametresRelance(propre);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const avant = await lireParametresRelance(produitCode, dateEffet);
  await ajouterParametre(acteur, cleParametresRelance(produitCode), JSON.stringify(propre), dateEffet, { parametresRelance: produitCode, avant, apres: propre, dateEffet } as unknown as Prisma.InputJsonValue, adresseIp);
}

// ---------------------------------------------------------------- Liste du jour

export type ElementListe = {
  type: TypeAppel;
  factureId: number;
  factureNumero: string;
  policeNumero: string;
  cotationId: number;
  produitCode: string;
  souscripteur: string;
  echeance: EcheanceDue;
  /** Relance : niveau à produire. */
  niveau: NiveauRelance | null;
  /** Jours depuis la date de l'échéance (négatif : à échoir). */
  joursRetard: number;
};

export type ListeDuJour = { date: DateIso; avis: ElementListe[]; relances: ElementListe[] };

/** Factures qui appellent des paiements, avec leurs paiements et ce qui a déjà été produit pour leurs échéances. */
async function facturesAppelables(filtre: Prisma.FactureWhereInput = {}) {
  const prisma = obtenirPrisma();
  const factures = await prisma.facture.findMany({
    where: { ...filtre, statut: "EMISE", type: { not: "AVOIR" } },
    include: { police: { select: { numero: true, cotationId: true } }, produit: { select: { code: true } }, paiements: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const produits = await prisma.documentAProduire.findMany({
    where: { factureId: { in: factures.map((f) => f.id) }, type: { in: ["AVIS_ECHEANCE", "RELANCE"] }, version: 1 },
    select: { factureId: true, type: true, echeanceNumero: true, niveauRelance: true },
  });
  return { factures, produits };
}

/** Échéances d'une facture et leur couverture : contenu figé + total payé (dans l'ordre, H49 ; terme unique, H67). */
function echeancesDeLaFacture(f: { statut: string; type: string; contenu: unknown; ttc: { toFixed(): string } }, paiements: { montant: { toFixed(): string } }[]): EcheanceDue[] {
  const contenu = f.contenu as unknown as ContenuFacture;
  const etat = etatPaiements(f.ttc.toFixed(), contenu.echeances, paiements.map((p, i) => ({ numero: String(i), date: "", montant: p.montant.toFixed(), reference: "", canal: "ESPECES", payeur: "" })));
  return echeancesDe({ statut: f.statut, type: f.type, dateEffet: contenu.dateEffet, ttc: f.ttc.toFixed(), echeances: contenu.echeances }, etat.totalPaye);
}

/**
 * Liste des avis et des relances à produire à une date (par défaut aujourd'hui) : échéances non payées des factures
 * émises et non annulées, selon les paramètres du produit EN VIGUEUR à cette date, moins ce qui est déjà produit.
 */
export async function listeDuJour(acteur: UtilisateurCourant, date: DateIso = aujourdhui()): Promise<ListeDuJour> {
  await exiger(acteur, false);
  return calculerListe(date);
}

async function calculerListe(date: DateIso): Promise<ListeDuJour> {
  if (!dateValide(date)) throw new ErreurMetier("Date de la liste invalide (AAAA-MM-JJ).");
  const { factures, produits } = await facturesAppelables();
  const parametres = new Map<string, ParametresRelance>();
  const liste: ListeDuJour = { date, avis: [], relances: [] };
  for (const f of factures) {
    if (!factureAppelable(f) || !f.numero) continue;
    const code = f.produit.code;
    if (!parametres.has(code)) parametres.set(code, await lireParametresRelance(code, date));
    const p = parametres.get(code)!;
    const contenu = f.contenu as unknown as ContenuFacture;
    const base = { factureId: f.id, factureNumero: f.numero, policeNumero: f.police.numero, cotationId: f.police.cotationId, produitCode: code, souscripteur: nomFacture(contenu.souscripteur) };
    for (const e of echeancesDeLaFacture(f, f.paiements)) {
      const deja = produits.filter((d) => d.factureId === f.id && d.echeanceNumero === e.numero);
      if (avisDu(e, p, date, deja.some((d) => d.type === "AVIS_ECHEANCE"))) liste.avis.push({ ...base, type: "AVIS_ECHEANCE", echeance: e, niveau: null, joursRetard: joursDeRetard(e, date) });
      const niveau = relanceDue(e, p, date, deja.filter((d) => d.type === "RELANCE").map((d) => d.niveauRelance ?? 0));
      if (niveau) liste.relances.push({ ...base, type: "RELANCE", echeance: e, niveau, joursRetard: joursDeRetard(e, date) });
    }
  }
  const ordre = (a: ElementListe, b: ElementListe) => a.echeance.date.localeCompare(b.echeance.date) || a.factureNumero.localeCompare(b.factureNumero) || a.echeance.numero - b.echeance.numero;
  liste.avis.sort(ordre);
  liste.relances.sort(ordre);
  return liste;
}

/**
 * Tâche quotidienne (file « quotidien », chaque matin) : établit la liste du jour et la consigne au journal (nombre
 * d'avis et de relances à produire). Elle ne produit AUCUN document : la génération reste une décision de l'utilisateur
 * (individuelle ou par lot), comme les pièces d'un import (H64, H69). Une seule trace par jour, même rejouée.
 */
export async function etablirListeDuJour(date: DateIso = aujourdhui()): Promise<{ avis: number; relances: number; dejaEtablie: boolean }> {
  const objetId = `liste ${date}`;
  const deja = await dejaJournalise("LISTE_ECHEANCES_ETABLIE", "echeances", objetId);
  const liste = await calculerListe(date);
  if (!deja) {
    await journaliser({ acteur: null, action: "LISTE_ECHEANCES_ETABLIE", objetType: "echeances", objetId, apres: { date, avis: liste.avis.length, relances: liste.relances.length }, adresseIp: null });
  }
  return { avis: liste.avis.length, relances: liste.relances.length, dejaEtablie: deja };
}

// ---------------------------------------------------------------- Génération d'un avis ou d'une relance

export type Appel = { type: TypeAppel; factureId: number; echeanceNumero: number; niveau: number | null };

export type ResultatAppel =
  | { statut: "PRODUIT"; numero: string; production: IssueProduction }
  | { statut: "DEJA_PRODUIT"; numero: string }
  | { statut: "SANS_OBJET"; message: string };

const LIBELLE_APPEL: Record<TypeAppel, string> = { AVIS_ECHEANCE: "avis d'échéance", RELANCE: "relance" };

/** Document déjà produit pour cette échéance (et ce niveau) : un seul, toujours (index uniques de la base). */
const dejaProduit = (client: Prisma.TransactionClient, a: Appel) =>
  client.documentAProduire.findFirst({ where: { factureId: a.factureId, type: a.type, echeanceNumero: a.echeanceNumero, niveauRelance: a.type === "RELANCE" ? a.niveau : null, version: 1 }, select: { numero: true } });

/**
 * Génère UN avis ou UNE relance (individuel, ou un élément d'un lot). Tout est vérifié au moment de la génération, sur
 * la facture verrouillée : facture émise et non annulée, échéance existante et non payée, niveau atteint (relance) ou
 * fenêtre J-x (avis), rien de déjà produit. Sinon : « déjà produit » ou « sans objet », sans consommer de numéro.
 */
export async function genererAppel(acteur: UtilisateurCourant, a: Appel, adresseIp: string | null, date: DateIso = aujourdhui()): Promise<ResultatAppel> {
  await exiger(acteur, true);
  const prisma = obtenirPrisma();
  const lue = await prisma.facture.findUnique({ where: { id: a.factureId }, include: { produit: { select: { code: true } } } });
  if (!lue || lue.type === "AVOIR") throw new ErreurMetier("Facture introuvable.");
  if (a.type === "RELANCE" && !(Number.isInteger(a.niveau) && (a.niveau ?? 0) >= 1)) throw new ErreurMetier("Niveau de relance invalide.");
  const p = await lireParametresRelance(lue.produit.code, date);
  const niveau = a.type === "RELANCE" ? p.niveaux.find((n) => n.niveau === a.niveau) : undefined;
  if (a.type === "RELANCE" && !niveau) return { statut: "SANS_OBJET", message: `Le niveau ${a.niveau} n'existe pas dans les relances du produit ${lue.produit.code}.` };
  // Modèle choisi AVANT le numéro : sans modèle publié, rien n'est consommé.
  const modele = await modeleRetenu(a.type, lue.produitId, date, a.type === "RELANCE" ? a.niveau : null);
  const commun = await lireParametresSociete(date);

  try {
    const r = await prisma.$transaction(
      async (tx): Promise<ResultatAppel | { statut: "FIGE"; numero: string; idProduction: number }> => {
        const f = await verrouiller(tx, a.factureId);
        const existant = await dejaProduit(tx, a);
        if (existant) return { statut: "DEJA_PRODUIT", numero: existant.numero };
        if (f.statut === "ANNULEE") return { statut: "SANS_OBJET", message: `La facture ${f.numero} est annulée par un avoir : plus d'avis ni de relance.` };
        if (!factureAppelable(f) || !f.numero) return { statut: "SANS_OBJET", message: "Seule une facture émise appelle des paiements." };
        const paiements = await tx.paiement.findMany({ where: { factureId: f.id }, orderBy: { id: "asc" } });
        const e = echeancesDeLaFacture(f, paiements).find((x) => x.numero === a.echeanceNumero);
        if (!e) throw new ErreurMetier(`La facture ${f.numero} n'a pas d'échéance n° ${a.echeanceNumero}.`);
        if (e.payee) return { statut: "SANS_OBJET", message: `L'échéance n° ${e.numero} de la facture ${f.numero} est payée : plus d'avis ni de relance.` };
        if (a.type === "AVIS_ECHEANCE" && !avisDu(e, p, date, false)) {
          return { statut: "SANS_OBJET", message: date > e.date ? `L'échéance du ${e.date} est passée : c'est le temps des relances.` : `L'avis de l'échéance du ${e.date} se produit à partir de J-${p.delaiAvisJours}.` };
        }
        if (a.type === "RELANCE" && joursDeRetard(e, date) < niveau!.jours) {
          return { statut: "SANS_OBJET", message: `Relance de niveau ${niveau!.niveau} à partir de J+${niveau!.jours} (échéance du ${e.date}).` };
        }

        const police = (await chargerPolice(tx, f.policeId))!;
        const contenu = contenuDe(f);
        const etat = etatPaiements(contenu.totaux.ttc, contenu.echeances, paiementsDe(paiements));
        const numero = await allouerNumero(tx, a.type === "AVIS_ECHEANCE" ? "AVE" : "REL", date);
        const appel = { echeance: { numero: e.numero, date: e.date, montant: e.montant, restantDu: e.restant }, relance: niveau ? { niveau: niveau.niveau, libelle: niveau.libelle, joursRetard: joursDeRetard(e, date) } : null };
        const idProduction = await figer(tx, {
          type: a.type,
          numero,
          version: 1,
          factureId: f.id,
          echeanceNumero: e.numero,
          niveauRelance: niveau?.niveau ?? null,
          produitCode: contenu.produit.code,
          policeNumero: police.numero,
          policeId: police.id,
          cotationId: police.cotationId,
          souscripteur: contenu.souscripteur,
          dateEmission: date,
          parametresDate: depuisDate(f.versionDateEffet),
          modeleVersionId: modele.modeleVersionId,
          associes: { ...modele.associes, listesEnAnnexe: contenu.listesEnAnnexe },
          donnees: (url) => donnees(a.type, numero, 1, date, contenu, police, commun, { ...facturation(contenu, etat, f.numero, etat.paiements), appel }, acteur.nom, url),
          emisPar: acteur.identifiant,
        });
        return { statut: "FIGE", numero, idProduction };
      },
      { maxWait: 20_000, timeout: 20_000 },
    );
    if (r.statut !== "FIGE") return r;
    return { statut: "PRODUIT", numero: r.numero, production: await produire(acteur, r.idProduction, adresseIp) };
  } catch (erreur) {
    // Deux générations simultanées du même avis : la base n'en garde qu'un (index unique) ; l'autre le retrouve.
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      const existant = await dejaProduit(prisma, a);
      if (existant) return { statut: "DEJA_PRODUIT", numero: existant.numero };
    }
    throw erreur;
  }
}

export { LIBELLE_APPEL };

// ---------------------------------------------------------------- Génération par lot (file de tâches)

export type LotEcheancesLu = {
  id: number;
  statut: string;
  dateListe: DateIso;
  creePar: string;
  creeLe: Date;
  debut: Date | null;
  fin: Date | null;
  total: number;
  faits: number;
  parStatut: Record<string, number>;
  elements: { type: TypeAppel; factureId: number; echeanceNumero: number; niveau: number | null; statut: string; numero: string | null; message: string | null }[];
};

/**
 * Crée un lot à partir d'une sélection de la liste du jour, puis le confie à la file de tâches. Renvoie false si la file
 * n'a pas pu être jointe (le lot sera traité au retour du travailleur).
 */
export async function creerLotEcheances(acteur: UtilisateurCourant, selection: Appel[], adresseIp: string | null, date: DateIso = aujourdhui()): Promise<{ lotId: number; enFile: boolean }> {
  await exiger(acteur, true);
  if (selection.length === 0) throw new ErreurMetier("Cochez au moins un avis ou une relance.");
  if (selection.length > 2000) throw new ErreurMetier("2 000 documents au plus par lot.");
  const uniques = [...new Map(selection.map((s) => [`${s.type}|${s.factureId}|${s.echeanceNumero}|${s.niveau ?? 0}`, s])).values()];
  const lot = await obtenirPrisma().$transaction(async (tx) => {
    const l = await tx.lotEcheances.create({ data: { statut: "EN_COURS", dateListe: versDate(date), creeParId: acteur.id, creePar: acteur.identifiant } });
    await tx.elementLotEcheances.createMany({ data: uniques.map((s) => ({ lotId: l.id, type: s.type, factureId: s.factureId, echeanceNumero: s.echeanceNumero, niveauRelance: s.type === "RELANCE" ? s.niveau : null })) });
    await journaliser({ acteur: auteur(acteur), action: "LOT_ECHEANCES_CREE", objetType: "lot_echeances", objetId: l.id, apres: { date, avis: uniques.filter((s) => s.type === "AVIS_ECHEANCE").length, relances: uniques.filter((s) => s.type === "RELANCE").length }, adresseIp }, tx);
    return l;
  });
  return { lotId: lot.id, enFile: await confierALaFile(lot.id) };
}

async function confierALaFile(lotId: number): Promise<boolean> {
  try {
    const { enfilerLotEcheances } = await import("./taches");
    await enfilerLotEcheances(lotId);
    return true;
  } catch (erreur) {
    console.error(`[echeances] lot ${lotId} non confié à la file de tâches : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    return false;
  }
}

/**
 * Traitement d'un lot par le travailleur, au nom de son créateur et à la date de la liste : chaque élément encore « à
 * faire » (ou en échec) est généré, re-vérifié au moment de la génération. Rejouable : un élément déjà traité ne l'est pas
 * deux fois, et la base refuse un second avis pour la même échéance.
 */
export async function traiterLotEcheances(lotId: number): Promise<void> {
  const prisma = obtenirPrisma();
  const lot = await prisma.lotEcheances.findUnique({ where: { id: lotId } });
  if (!lot || lot.statut !== "EN_COURS") return;
  const acteur = versUtilisateurCourant(await prisma.utilisateur.findUniqueOrThrow({ where: { id: lot.creeParId }, include: { profil: true } }));
  if (!lot.debut) await prisma.lotEcheances.update({ where: { id: lotId }, data: { debut: new Date() } });
  const aFaire = await prisma.elementLotEcheances.findMany({ where: { lotId, statut: { in: ["A_FAIRE", "ECHEC"] } }, orderBy: { id: "asc" } });
  // La date de la liste fait foi tant que c'est le jour même ; un lot repris un autre jour est vérifié à la date du jour.
  const date = aujourdhui();
  for (const el of aFaire) {
    try {
      const r = await genererAppel(acteur, { type: el.type as TypeAppel, factureId: el.factureId, echeanceNumero: el.echeanceNumero, niveau: el.niveauRelance }, null, date);
      const echec = r.statut === "PRODUIT" && !r.production.ok;
      await prisma.elementLotEcheances.update({
        where: { id: el.id },
        data: { statut: r.statut, numero: r.statut === "SANS_OBJET" ? null : r.numero, message: r.statut === "SANS_OBJET" ? r.message : echec && !r.production.ok ? `PDF en attente : ${r.production.erreur}`.slice(0, 1000) : null },
      });
    } catch (erreur) {
      await prisma.elementLotEcheances.update({ where: { id: el.id }, data: { statut: "ECHEC", message: (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 1000) } });
    }
  }
  const lus = await prisma.elementLotEcheances.groupBy({ by: ["statut"], where: { lotId }, _count: { _all: true } });
  const parStatut = Object.fromEntries(lus.map((l) => [l.statut, l._count._all]));
  await prisma.$transaction(async (tx) => {
    await tx.lotEcheances.update({ where: { id: lotId }, data: { statut: "TERMINE", fin: new Date() } });
    await journaliser({ acteur: auteur(acteur), action: "LOT_ECHEANCES_TERMINE", objetType: "lot_echeances", objetId: lotId, apres: parStatut, adresseIp: null }, tx);
  });
}

export async function lotsEcheancesEnCours(): Promise<number[]> {
  return (await obtenirPrisma().lotEcheances.findMany({ where: { statut: "EN_COURS" }, select: { id: true } })).map((l) => l.id);
}

export async function lireLotEcheances(acteur: UtilisateurCourant, lotId: number): Promise<LotEcheancesLu | null> {
  await exiger(acteur, false);
  const lot = await obtenirPrisma().lotEcheances.findUnique({ where: { id: lotId }, include: { elements: { orderBy: { id: "asc" } } } });
  if (!lot) return null;
  const parStatut: Record<string, number> = {};
  for (const e of lot.elements) parStatut[e.statut] = (parStatut[e.statut] ?? 0) + 1;
  return {
    id: lot.id,
    statut: lot.statut,
    dateListe: depuisDate(lot.dateListe),
    creePar: lot.creePar,
    creeLe: lot.creeLe,
    debut: lot.debut,
    fin: lot.fin,
    total: lot.elements.length,
    faits: lot.elements.filter((e) => e.statut !== "A_FAIRE").length,
    parStatut,
    elements: lot.elements.map((e) => ({ type: e.type as TypeAppel, factureId: e.factureId, echeanceNumero: e.echeanceNumero, niveau: e.niveauRelance, statut: e.statut, numero: e.numero, message: e.message })),
  };
}

export async function listerLotsEcheances(acteur: UtilisateurCourant): Promise<{ id: number; statut: string; dateListe: DateIso; creePar: string; creeLe: Date; total: number }[]> {
  await exiger(acteur, false);
  const lots = await obtenirPrisma().lotEcheances.findMany({ orderBy: { id: "desc" }, take: 20, include: { _count: { select: { elements: true } } } });
  return lots.map((l) => ({ id: l.id, statut: l.statut, dateListe: depuisDate(l.dateListe), creePar: l.creePar, creeLe: l.creeLe, total: l._count.elements }));
}
