import "server-only";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { estStatut, type StatutCotation } from "@/domaine/cotation/statuts";
import { nomSouscripteur } from "@/domaine/documents/emission";
import { cotationsParStatut, impayesParAnciennete, pourcentage, problemesPeriode, somme, tauxTransformation, type LigneTransformation, type Periode, type TrancheAnciennete } from "@/domaine/tableaux/indicateurs";

import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { montantsFacturation } from "./tableaux-de-bord";
import { ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Tableau de bord du commercial (H102 à H104) : ses propres chiffres, jamais ceux des autres. Le périmètre est l'auteur de la cotation
 * (`auteurIdentifiant`), et il vient de la SESSION, jamais d'un paramètre de l'adresse. Aucun droit supplémentaire : chacun voit son travail.
 * Recalculé depuis la base à chaque affichage, comme le tableau de bord général.
 */

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const finDuJour = (iso: DateIso) => new Date(`${iso}T23:59:59.999Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

export type CotationEnCours = { id: number; numero: string | null; statut: StatutCotation; produit: string; souscripteur: string; ttc: string | null; dateValidite: DateIso | null };

export type TableauCommercial = {
  periode: Periode;
  aujourdhui: DateIso;
  cotations: { parStatut: Record<StatutCotation, number>; emises: number; acceptees: number; taux: string | null; parProduit: LigneTransformation[] };
  production: { polices: number; primeTtc: string; parProduit: { produit: string; polices: number; primeTtc: string }[] };
  encaissement: { emis: string; encaisse: string; restantDu: string; impayes: Record<TrancheAnciennete, { nombre: number; montant: string }> };
  enCours: CotationEnCours[];
};

export async function tableauCommercial(acteur: UtilisateurCourant, periode?: Partial<Periode>): Promise<TableauCommercial> {
  const jour = aujourdhui();
  const p: Periode = { debut: periode?.debut || `${jour.slice(0, 4)}-01-01`, fin: periode?.fin || jour };
  const problemes = problemesPeriode(p, dateValide);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const prisma = obtenirPrisma();
  const moi = { auteurIdentifiant: acteur.identifiant };
  const entreInstants = { gte: versDate(p.debut), lte: finDuJour(p.fin) };

  // Cotations créées dans la période, à leur statut du jour (même règle que le tableau général).
  const creees = await prisma.cotation.findMany({ where: { ...moi, creeLe: entreInstants }, select: { statut: true, dateValidite: true } });
  const parStatut = cotationsParStatut(
    creees.filter((c) => estStatut(c.statut)).map((c) => ({ statut: c.statut as StatutCotation, dateValidite: c.dateValidite ? depuisDate(c.dateValidite) : null })),
    jour,
  );
  // Transformation (H70) : cotations émises dans la période, acceptées ou non à ce jour.
  const emises = await prisma.cotation.findMany({ where: { ...moi, emiseLe: entreInstants, numero: { not: null } }, select: { statut: true, produit: { select: { code: true } } } });
  const acceptees = emises.filter((c) => c.statut === "ACCEPTEE").length;
  const parProduit = tauxTransformation(emises.map((c) => ({ cle: c.produit.code, acceptee: c.statut === "ACCEPTEE" })));

  // Production (H102) : cotations ACCEPTÉES dans la période (une police naît de l'acceptation), pour leur TTC.
  const signees = await prisma.cotation.findMany({
    where: { ...moi, statut: "ACCEPTEE", accepteeLe: entreInstants },
    select: { ttcTotal: true, produit: { select: { code: true } } },
  });
  const produits = new Map<string, string[]>();
  for (const c of signees) produits.set(c.produit.code, [...(produits.get(c.produit.code) ?? []), (c.ttcTotal?.toFixed() ?? "0")]);

  // Encaissement (H103) : factures des polices issues de SES cotations.
  const f = await montantsFacturation(p, jour, acteur.identifiant);

  // Suivi (H104) : ses cotations non terminées, les plus récentes d'abord.
  const ouvertes = await prisma.cotation.findMany({
    where: { ...moi, statut: { in: ["BROUILLON", "A_VALIDER", "EMISE"] } },
    select: { id: true, numero: true, statut: true, souscripteur: true, ttcTotal: true, dateValidite: true, produit: { select: { code: true } } },
    orderBy: { id: "desc" },
    take: 10,
  });

  return {
    periode: p,
    aujourdhui: jour,
    cotations: { parStatut, emises: emises.length, acceptees, taux: pourcentage(acceptees, emises.length), parProduit },
    production: {
      polices: signees.length,
      primeTtc: somme(signees.map((c) => (c.ttcTotal?.toFixed() ?? "0"))),
      parProduit: [...produits].sort(([a], [b]) => a.localeCompare(b, "fr")).map(([produit, ttc]) => ({ produit, polices: ttc.length, primeTtc: somme(ttc) })),
    },
    encaissement: { emis: f.emis, encaisse: f.encaisse, restantDu: f.restantDu, impayes: impayesParAnciennete(f.echeances, jour) },
    enCours: ouvertes
      .filter((c) => estStatut(c.statut))
      .map((c) => ({
        id: c.id,
        numero: c.numero,
        statut: c.statut as StatutCotation,
        produit: c.produit.code,
        souscripteur: nomSouscripteur(c.souscripteur as unknown as Parameters<typeof nomSouscripteur>[0]),
        ttc: c.ttcTotal?.toFixed(0) ?? null,
        dateValidite: c.dateValidite ? depuisDate(c.dateValidite) : null,
      })),
  };
}
