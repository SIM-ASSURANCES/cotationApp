import "server-only";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { nomSouscripteur } from "@/domaine/documents/emission";
import { parTypeEtMois, problemesPeriode, type Periode } from "@/domaine/tableaux/indicateurs";

import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const finDuJour = (iso: DateIso) => new Date(`${iso}T23:59:59.999Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

export type CotationPreteProduction = {
  id: number;
  numero: string | null;
  produitCode: string;
  souscripteur: string;
  ttc: string | null;
  accepteeLe: DateIso | null;
};

export type TachePoliceProduction = {
  id: number;
  policeNumero: string;
  produitCode: string;
  souscripteur: string;
  type: string;
  creeLe: DateIso;
};

export type ImportRecentProduction = {
  id: number;
  policeNumero: string;
  statut: string;
  lignes: number;
  certificatsEmis: number;
  creeLe: DateIso;
};

export type TableauProduction = {
  periode: Periode;
  aujourdhui: DateIso;
  indicateurs: {
    cotationsEnAttenteContrat: number;
    tachesEnAttente: number;
    importsEnCours: number;
  };
  cotationsAProduire: CotationPreteProduction[];
  tachesPolice: TachePoliceProduction[];
  lotsImports: ImportRecentProduction[];
  documentsParType: { type: string; mois: string; nombre: number }[];
};

/**
 * Tableau de bord Gestionnaire de Production : gestion des contrats à émettre,
 * suivi des tâches de police post-import, et lots d'adhérents.
 */
export async function tableauProduction(
  _acteur: UtilisateurCourant,
  periode?: Partial<Periode>,
): Promise<TableauProduction> {
  const jour = aujourdhui();
  const p: Periode = { debut: periode?.debut || `${jour.slice(0, 4)}-01-01`, fin: periode?.fin || jour };
  const problemes = problemesPeriode(p, dateValide);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const prisma = obtenirPrisma();
  const entreDates = { gte: versDate(p.debut), lte: versDate(p.fin) };
  const entreInstants = { gte: versDate(p.debut), lte: finDuJour(p.fin) };

  // 1. Cotations acceptées sans contrat (CP) encore émis
  const rawCotations = await prisma.cotation.findMany({
    where: {
      statut: "ACCEPTEE",
      police: { is: null },
    },
    select: {
      id: true,
      numero: true,
      produit: { select: { code: true } },
      souscripteur: true,
      ttcTotal: true,
      accepteeLe: true,
    },
    orderBy: { accepteeLe: "desc" },
    take: 15,
  });

  // 2. Tâches de police en attente (fermeture: null)
  const rawTaches = await prisma.tachePolice.findMany({
    where: { fermeture: null },
    select: {
      id: true,
      type: true,
      creeLe: true,
      police: {
        select: {
          numero: true,
          produitCode: true,
          souscripteur: true,
        },
      },
    },
    orderBy: { creeLe: "desc" },
    take: 15,
  });

  // 3. Imports récents
  const rawImports = await prisma.lotImport.findMany({
    where: { creeLe: entreInstants },
    select: {
      id: true,
      statut: true,
      creeLe: true,
      police: { select: { numero: true } },
      _count: { select: { lignes: true } },
    },
    orderBy: { creeLe: "desc" },
    take: 10,
  });

  // 4. Documents produits par type et par mois
  const documents = await prisma.documentEmis.findMany({
    where: { version: 1, dateEmission: entreDates },
    select: { type: true, dateEmission: true },
  });

  return {
    periode: p,
    aujourdhui: jour,
    indicateurs: {
      cotationsEnAttenteContrat: rawCotations.length,
      tachesEnAttente: rawTaches.length,
      importsEnCours: rawImports.filter((i) => i.statut === "EN_COURS").length,
    },
    cotationsAProduire: rawCotations.map((c) => ({
      id: c.id,
      numero: c.numero,
      produitCode: c.produit.code,
      souscripteur: nomSouscripteur(c.souscripteur as unknown as Parameters<typeof nomSouscripteur>[0]),
      ttc: c.ttcTotal?.toFixed(0) ?? null,
      accepteeLe: c.accepteeLe ? depuisDate(c.accepteeLe) : null,
    })),
    tachesPolice: rawTaches.map((t) => ({
      id: t.id,
      policeNumero: t.police.numero,
      produitCode: t.police.produitCode,
      souscripteur: nomSouscripteur(t.police.souscripteur as unknown as Parameters<typeof nomSouscripteur>[0]),
      type: t.type === "CP_A_EMETTRE" ? "Nouvelle CP à émettre" : "Facture d'avenant à émettre",
      creeLe: depuisDate(t.creeLe),
    })),
    lotsImports: rawImports.map((i) => ({
      id: i.id,
      policeNumero: i.police.numero,
      statut: i.statut,
      lignes: i._count.lignes,
      certificatsEmis: 0,
      creeLe: depuisDate(i.creeLe),
    })),
    documentsParType: parTypeEtMois(documents.map((d) => ({ type: d.type, date: depuisDate(d.dateEmission) }))),
  };
}
