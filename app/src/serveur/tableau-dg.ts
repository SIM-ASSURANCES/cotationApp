import "server-only";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { nomSouscripteur } from "@/domaine/documents/emission";
import { pourcentage, problemesPeriode, somme, type Periode } from "@/domaine/tableaux/indicateurs";

import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { montantsFacturation } from "./tableaux-de-bord";
import { ErreurMetier, type UtilisateurCourant } from "./types";

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const finDuJour = (iso: DateIso) => new Date(`${iso}T23:59:59.999Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

export type ModeleAPublierDG = {
  id: number;
  modeleId: number;
  modeleCode: string;
  modeleLibelle: string;
  type: string;
  numero: number;
  soumisLe: DateIso | null;
  auteurIdentifiant: string;
};

export type CotationAValiderDG = {
  id: number;
  numero: string | null;
  produitCode: string;
  souscripteur: string;
  ttc: string | null;
  raisonsValidation: string[];
  auteurIdentifiant: string;
  creeLe: DateIso;
};

export type ContratAValiderDG = {
  id: number;
  policeNumero: string;
  produitCode: string;
  souscripteur: string;
  ttc: string;
  seuil: string;
  demandeur: string;
  demandeLe: DateIso;
};

export type RepartitionProduitDG = {
  produit: string;
  polices: number;
  primeTtc: string;
};

export type TableauDirectionGenerale = {
  periode: Periode;
  aujourdhui: DateIso;
  indicateurs: {
    cotationsEmises: number;
    cotationsAcceptees: number;
    tauxTransformation: string | null;
    primeTtcTotale: string;
    encaisse: string;
    restantDu: string;
    policesEnVigueur: number;
  };
  approbations: {
    modelesAPublier: ModeleAPublierDG[];
    cotationsAValider: CotationAValiderDG[];
    contratsAValider: ContratAValiderDG[];
  };
  repartitionProduits: RepartitionProduitDG[];
};

/**
 * Tableau de bord Direction Générale : indicateurs stratégiques de performance globale
 * et file des validations/approbations réservées à la Direction Générale.
 */
export async function tableauDirectionGenerale(
  _acteur: UtilisateurCourant,
  periode?: Partial<Periode>,
): Promise<TableauDirectionGenerale> {
  const jour = aujourdhui();
  const p: Periode = { debut: periode?.debut || `${jour.slice(0, 4)}-01-01`, fin: periode?.fin || jour };
  const problemes = problemesPeriode(p, dateValide);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const prisma = obtenirPrisma();
  const entreInstants = { gte: versDate(p.debut), lte: finDuJour(p.fin) };

  // 1. Cotations émises et acceptées
  const emises = await prisma.cotation.findMany({
    where: { emiseLe: entreInstants, numero: { not: null } },
    select: { statut: true },
  });
  const cotationsEmises = emises.length;
  const cotationsAcceptees = emises.filter((c) => c.statut === "ACCEPTEE").length;
  const tauxTransformation = pourcentage(cotationsAcceptees, cotationsEmises);

  // 2. Production (cotations acceptées dans la période)
  const signees = await prisma.cotation.findMany({
    where: { statut: "ACCEPTEE", accepteeLe: entreInstants },
    select: { ttcTotal: true, produit: { select: { code: true } } },
  });
  const primeTtcTotale = somme(signees.map((c) => c.ttcTotal?.toFixed() ?? "0"));

  const produitsMap = new Map<string, string[]>();
  for (const c of signees) {
    produitsMap.set(c.produit.code, [...(produitsMap.get(c.produit.code) ?? []), c.ttcTotal?.toFixed() ?? "0"]);
  }
  const repartitionProduits = [...produitsMap]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([produit, ttcs]) => ({
      produit,
      polices: ttcs.length,
      primeTtc: somme(ttcs),
    }));

  // 3. Encaissements & restant dû
  const { encaisse, restantDu } = await montantsFacturation(p, jour);

  // 4. Polices en vigueur
  const policesEnVigueur = await prisma.police.count({
    where: {
      dateEffet: { lte: versDate(jour) },
      dateEcheance: { gte: versDate(jour) },
    },
  });

  // 5. File d'approbations DG
  const rawModeles = await prisma.modeleVersion.findMany({
    where: { statut: "SOUMIS" },
    select: {
      id: true,
      numero: true,
      soumisLe: true,
      auteurIdentifiant: true,
      modele: {
        select: {
          id: true,
          code: true,
          libelle: true,
          type: true,
        },
      },
    },
    orderBy: { soumisLe: "desc" },
    take: 10,
  });

  const rawCotations = await prisma.cotation.findMany({
    where: { statut: "A_VALIDER" },
    select: {
      id: true,
      numero: true,
      produit: { select: { code: true } },
      souscripteur: true,
      ttcTotal: true,
      raisonsValidation: true,
      auteurIdentifiant: true,
      creeLe: true,
    },
    orderBy: { creeLe: "desc" },
    take: 10,
  });

  const rawContrats = await prisma.validationContrat.findMany({
    where: { statut: "A_VALIDER" },
    select: {
      id: true,
      ttc: true,
      seuil: true,
      demandeLe: true,
      demandeParIdentifiant: true,
      police: {
        select: {
          numero: true,
          produitCode: true,
          souscripteur: true,
        },
      },
    },
    orderBy: { demandeLe: "desc" },
    take: 10,
  });

  return {
    periode: p,
    aujourdhui: jour,
    indicateurs: {
      cotationsEmises,
      cotationsAcceptees,
      tauxTransformation,
      primeTtcTotale,
      encaisse,
      restantDu,
      policesEnVigueur,
    },
    approbations: {
      modelesAPublier: rawModeles.map((m) => ({
        id: m.id,
        modeleId: m.modele.id,
        modeleCode: m.modele.code,
        modeleLibelle: m.modele.libelle,
        type: m.modele.type,
        numero: m.numero,
        soumisLe: m.soumisLe ? depuisDate(m.soumisLe) : null,
        auteurIdentifiant: m.auteurIdentifiant,
      })),
      cotationsAValider: rawCotations.map((c) => ({
        id: c.id,
        numero: c.numero,
        produitCode: c.produit.code,
        souscripteur: nomSouscripteur(c.souscripteur as unknown as Parameters<typeof nomSouscripteur>[0]),
        ttc: c.ttcTotal?.toFixed(0) ?? null,
        raisonsValidation: (c.raisonsValidation as string[]) ?? [],
        auteurIdentifiant: c.auteurIdentifiant,
        creeLe: depuisDate(c.creeLe),
      })),
      contratsAValider: rawContrats.map((v) => ({
        id: v.id,
        policeNumero: v.police.numero,
        produitCode: v.police.produitCode,
        souscripteur: nomSouscripteur(v.police.souscripteur as unknown as Parameters<typeof nomSouscripteur>[0]),
        ttc: v.ttc.toFixed(0),
        seuil: v.seuil.toFixed(0),
        demandeur: v.demandeParIdentifiant,
        demandeLe: depuisDate(v.demandeLe),
      })),
    },
    repartitionProduits,
  };
}
