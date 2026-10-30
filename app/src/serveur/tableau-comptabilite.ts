import "server-only";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { impayesParAnciennete, problemesPeriode, type Periode, type TrancheAnciennete } from "@/domaine/tableaux/indicateurs";

import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { exigerLectureTableau, montantsFacturation } from "./tableaux-de-bord";
import { ErreurMetier, type UtilisateurCourant } from "./types";

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const finDuJour = (iso: DateIso) => new Date(`${iso}T23:59:59.999Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

export type FactureAValiderComptabilite = {
  id: number;
  numero: string | null;
  type: string;
  policeNumero: string;
  souscripteur: string;
  ttc: string;
  dateEmission: DateIso | null;
};

export type DernierPaiementComptabilite = {
  id: number;
  reference: string;
  montant: string;
  date: DateIso;
  canal: string;
  payeur: string;
  factureId: number;
  factureNumero: string | null;
  policeNumero: string;
};

export type TableauComptabilite = {
  periode: Periode;
  aujourdhui: DateIso;
  financier: {
    emis: string;
    avoirs: string;
    encaisse: string;
    restantDu: string;
    impayes: Record<TrancheAnciennete, { nombre: number; montant: string }>;
  };
  facturesEnAttente: FactureAValiderComptabilite[];
  derniersPaiements: DernierPaiementComptabilite[];
  relancesEtAvis: {
    avis: number;
    relancesParNiveau: { niveau: number; nombre: number }[];
  };
};

/**
 * Tableau de bord Comptabilité : suivi des encaissements, factures émises et avoirs,
 * impayés par ancienneté, et derniers paiements enregistrés.
 */
export async function tableauComptabilite(
  acteur: UtilisateurCourant,
  periode?: Partial<Periode>,
): Promise<TableauComptabilite> {
  await exigerLectureTableau(acteur, "comptabilite");
  const jour = aujourdhui();
  const p: Periode = { debut: periode?.debut || `${jour.slice(0, 4)}-01-01`, fin: periode?.fin || jour };
  const problemes = problemesPeriode(p, dateValide);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const prisma = obtenirPrisma();
  const entreDates = { gte: versDate(p.debut), lte: versDate(p.fin) };
  const entreInstants = { gte: versDate(p.debut), lte: finDuJour(p.fin) };

  // 1. Indicateurs financiers
  const { emis, avoirs, encaisse, restantDu, echeances } = await montantsFacturation(p, jour);

  // 2. Factures émises récentes / à suivre
  const rawFactures = await prisma.facture.findMany({
    where: {
      creeLe: entreInstants,
      statut: { in: ["A_VALIDER", "EMISE"] },
    },
    select: {
      id: true,
      numero: true,
      type: true,
      ttc: true,
      dateEmission: true,
      police: {
        select: {
          numero: true,
          souscripteur: true,
        },
      },
    },
    orderBy: { creeLe: "desc" },
    take: 10,
  });

  // 3. Derniers paiements reçus
  const rawPaiements = await prisma.paiement.findMany({
    where: {
      date: entreDates,
    },
    select: {
      id: true,
      reference: true,
      montant: true,
      date: true,
      canal: true,
      payeur: true,
      factureId: true,
      facture: {
        select: {
          numero: true,
          police: { select: { numero: true } },
        },
      },
    },
    orderBy: { id: "desc" },
    take: 10,
  });

  // 4. Avis d'échéance et relances
  const appels = await prisma.documentAProduire.findMany({
    where: {
      type: { in: ["AVIS_ECHEANCE", "RELANCE"] },
      version: 1,
      dateEmission: entreDates,
    },
    select: { type: true, niveauRelance: true },
  });
  const niveaux = new Map<number, number>();
  for (const a of appels) {
    if (a.type === "RELANCE" && a.niveauRelance !== null) {
      niveaux.set(a.niveauRelance, (niveaux.get(a.niveauRelance) ?? 0) + 1);
    }
  }

  return {
    periode: p,
    aujourdhui: jour,
    financier: {
      emis,
      avoirs,
      encaisse,
      restantDu,
      impayes: impayesParAnciennete(echeances, jour),
    },
    facturesEnAttente: rawFactures.map((f) => ({
      id: f.id,
      numero: f.numero,
      type: f.type,
      policeNumero: f.police.numero,
      souscripteur: String((f.police.souscripteur as Record<string, unknown>)?.nom ?? (f.police.souscripteur as Record<string, unknown>)?.raison_sociale ?? "—"),
      ttc: f.ttc.toFixed(0),
      dateEmission: f.dateEmission ? depuisDate(f.dateEmission) : null,
    })),
    derniersPaiements: rawPaiements.map((p) => ({
      id: p.id,
      reference: p.reference,
      montant: p.montant.toFixed(0),
      date: depuisDate(p.date),
      canal: p.canal,
      payeur: p.payeur,
      factureId: p.factureId,
      factureNumero: p.facture.numero,
      policeNumero: p.facture.police.numero,
    })),
    relancesEtAvis: {
      avis: appels.filter((a) => a.type === "AVIS_ECHEANCE").length,
      relancesParNiveau: [...niveaux].sort(([a], [b]) => a - b).map(([niveau, nombre]) => ({ niveau, nombre })),
    },
  };
}

