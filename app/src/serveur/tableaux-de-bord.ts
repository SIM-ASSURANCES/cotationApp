import "server-only";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { estStatut, type StatutCotation } from "@/domaine/cotation/statuts";
import { peutLire } from "@/domaine/droits";
import { echeancesDe, factureAppelable } from "@/domaine/facturation/echeances";
import { etatPaiements, type ContenuFacture } from "@/domaine/facturation/factures";
import {
  cotationsParStatut,
  impayesParAnciennete,
  parTypeEtMois,
  problemesPeriode,
  somme,
  tauxTransformation,
  type LigneTransformation,
  type Periode,
  type TrancheAnciennete,
} from "@/domaine/tableaux/indicateurs";

import { niveauDuProfil } from "./droits";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Tableaux de bord (session 5b, CDC §9.4, §12) : cotations, facturation, production. Chaque chiffre est RECALCULÉ depuis
 * la base à chaque affichage ; aucun indicateur n'est stocké. Droit « Consulter les tableaux de bord » (extension du
 * tableau du CDC §4, D25) : Technique, Comptabilité et Direction Générale en lecture par défaut, paramétrable.
 */

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const finDuJour = (iso: DateIso) => new Date(`${iso}T23:59:59.999Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

export type TableauDeBord = {
  periode: Periode;
  aujourdhui: DateIso;
  cotations: {
    parStatut: Record<StatutCotation, number>;
    transformation: { parProduit: LigneTransformation[]; parCommercial: LigneTransformation[]; parIntermediaire: LigneTransformation[] };
  };
  facturation: {
    emis: string;
    avoirs: string;
    encaisse: string;
    restantDu: string;
    impayes: Record<TrancheAnciennete, { nombre: number; montant: string }>;
    avis: number;
    relancesParNiveau: { niveau: number; nombre: number }[];
  };
  production: {
    documents: { type: string; mois: string; nombre: number }[];
    imports: { lots: number; traites: number; enErreur: number; enEchec: number };
  };
};

/** Libellé des cotations émises sans intermédiaire (affaires directes). */
export const SANS_INTERMEDIAIRE = "Sans intermédiaire";

export async function tableauDeBord(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauDeBord> {
  if (!peutLire(await niveauDuProfil(acteur.profil, "CONSULTER_TABLEAUX_DE_BORD"))) throw new ErreurAcces("Droit insuffisant : tableaux de bord.");
  const jour = aujourdhui();
  const p: Periode = { debut: periode?.debut || `${jour.slice(0, 4)}-01-01`, fin: periode?.fin || jour };
  const problemes = problemesPeriode(p, dateValide);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const prisma = obtenirPrisma();
  const entreDates = { gte: versDate(p.debut), lte: versDate(p.fin) };
  const entreInstants = { gte: versDate(p.debut), lte: finDuJour(p.fin) };

  // ------------------------------------------------ Cotations
  // Par statut : cotations CRÉÉES dans la période, à leur statut réel du jour (émise et périmée = « Expirée »).
  const creees = await prisma.cotation.findMany({ where: { creeLe: entreInstants }, select: { statut: true, dateValidite: true } });
  const parStatut = cotationsParStatut(
    creees.filter((c) => estStatut(c.statut)).map((c) => ({ statut: c.statut as StatutCotation, dateValidite: c.dateValidite ? depuisDate(c.dateValidite) : null })),
    jour,
  );
  // Transformation (H70) : cotations ÉMISES dans la période (numéro COT), acceptées ou non à ce jour.
  const emises = await prisma.cotation.findMany({
    where: { emiseLe: entreInstants, numero: { not: null } },
    select: { statut: true, auteurIdentifiant: true, produit: { select: { code: true } }, intermediaires: { select: { intermediaire: { select: { code: true, nom: true } } } } },
  });
  const transformation = {
    parProduit: tauxTransformation(emises.map((c) => ({ cle: c.produit.code, acceptee: c.statut === "ACCEPTEE" }))),
    parCommercial: tauxTransformation(emises.map((c) => ({ cle: c.auteurIdentifiant, acceptee: c.statut === "ACCEPTEE" }))),
    // Session 6.0 (H71 fermée) : une cotation compte pour chacun de ses intermédiaires (0 à 2) ; sans intermédiaire, elle
    // est comptée à part (« Sans intermédiaire »). Libellé : nom actuel du référentiel et code.
    parIntermediaire: tauxTransformation(
      emises.flatMap((c) => {
        const acceptee = c.statut === "ACCEPTEE";
        if (c.intermediaires.length === 0) return [{ cle: SANS_INTERMEDIAIRE, acceptee }];
        return c.intermediaires.map((i) => ({ cle: `${i.intermediaire.nom} (${i.intermediaire.code})`, acceptee }));
      }),
    ),
  };

  // ------------------------------------------------ Facturation
  const factures = await prisma.facture.findMany({
    where: { numero: { not: null } },
    select: {
      type: true,
      statut: true,
      ttc: true,
      contenu: true,
      dateEmission: true,
      paiements: { select: { montant: true, excedent: true } },
      imputations: { where: { type: "IMPUTATION" }, select: { montant: true } },
    },
  });
  const dansLaPeriode = factures.filter((f) => f.dateEmission !== null && depuisDate(f.dateEmission) >= p.debut && depuisDate(f.dateEmission) <= p.fin);
  const emis = somme(dansLaPeriode.filter((f) => f.type !== "AVOIR").map((f) => f.ttc.toFixed()));
  const avoirs = somme(dansLaPeriode.filter((f) => f.type === "AVOIR").map((f) => f.ttc.toFixed()));
  const encaisse = somme((await prisma.paiement.findMany({ where: { date: entreDates }, select: { montant: true } })).map((x) => x.montant.toFixed()));
  // Restant dû et impayés : à ce jour, sur les factures émises et non annulées (une facture annulée par un avoir ne doit plus rien).
  const appelables = factures.filter((f) => factureAppelable(f));
  const echeances = appelables.flatMap((f) => {
    const contenu = f.contenu as unknown as ContenuFacture;
    // Réglé = part des paiements hors excédent (H33) + imputations d'avance, reports compris (session 6.0).
    const sommes = [
      ...f.paiements.map((x) => ({ montant: x.montant.toFixed(), excedent: x.excedent.toFixed() })),
      ...f.imputations.map((x) => ({ montant: x.montant.toFixed(), excedent: "0" })),
    ];
    const paye = etatPaiements(f.ttc.toFixed(), [], sommes.map((x, i) => ({ numero: String(i), date: "", reference: "", canal: "ESPECES" as const, payeur: "", ...x }))).totalPaye;
    return echeancesDe({ statut: f.statut, type: f.type, dateEffet: contenu.dateEffet, ttc: f.ttc.toFixed(), echeances: contenu.echeances }, paye);
  });
  const restantDu = somme(echeances.map((e) => e.restant));
  const appels = await prisma.documentAProduire.findMany({ where: { type: { in: ["AVIS_ECHEANCE", "RELANCE"] }, version: 1, dateEmission: entreDates }, select: { type: true, niveauRelance: true } });
  const niveaux = new Map<number, number>();
  for (const a of appels) if (a.type === "RELANCE" && a.niveauRelance !== null) niveaux.set(a.niveauRelance, (niveaux.get(a.niveauRelance) ?? 0) + 1);

  // ------------------------------------------------ Production
  const documents = await prisma.documentEmis.findMany({ where: { version: 1, dateEmission: entreDates }, select: { type: true, dateEmission: true } });
  const lots = await prisma.lotImport.findMany({ where: { creeLe: entreInstants, statut: { in: ["EN_COURS", "TERMINE"] } }, select: { id: true } });
  const lignes = lots.length === 0 ? [] : await prisma.ligneImport.groupBy({ by: ["statut"], where: { lotId: { in: lots.map((l) => l.id) } }, _count: { _all: true } });
  const nombre = (statut: string) => lignes.find((l) => l.statut === statut)?._count._all ?? 0;

  return {
    periode: p,
    aujourdhui: jour,
    cotations: { parStatut, transformation },
    facturation: {
      emis,
      avoirs,
      encaisse,
      restantDu,
      impayes: impayesParAnciennete(echeances, jour),
      avis: appels.filter((a) => a.type === "AVIS_ECHEANCE").length,
      relancesParNiveau: [...niveaux].sort(([a], [b]) => a - b).map(([niveau, n]) => ({ niveau, nombre: n })),
    },
    production: {
      documents: parTypeEtMois(documents.map((d) => ({ type: d.type, date: depuisDate(d.dateEmission) }))),
      imports: { lots: lots.length, traites: nombre("PRODUIT"), enErreur: nombre("ERREUR"), enEchec: nombre("ECHEC") },
    },
  };
}
