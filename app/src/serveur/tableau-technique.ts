import "server-only";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { nomSouscripteur } from "@/domaine/documents/emission";
import { problemesPeriode, tauxTransformation, type LigneTransformation, type Periode } from "@/domaine/tableaux/indicateurs";

import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const finDuJour = (iso: DateIso) => new Date(`${iso}T23:59:59.999Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

export type CotationAValiderTechnique = {
  id: number;
  numero: string | null;
  produitCode: string;
  souscripteur: string;
  ttc: string | null;
  raisonsValidation: string[];
  auteurIdentifiant: string;
  creeLe: DateIso;
};

export type CotationAComposerTechnique = {
  id: number;
  produitCode: string;
  souscripteur: string;
  auteurIdentifiant: string;
  creeLe: DateIso;
};

export type ContratAValiderTechnique = {
  id: number;
  policeNumero: string;
  produitCode: string;
  souscripteur: string;
  ttc: string;
  seuil: string;
  demandeur: string;
  demandeLe: DateIso;
};

export type ModeleSoumisTechnique = {
  id: number;
  modeleId: number;
  modeleCode: string;
  modeleLibelle: string;
  type: string;
  numero: number;
  auteurIdentifiant: string;
  soumisLe: DateIso | null;
};

export type BaremeBrouillonTechnique = {
  id: number;
  versionId: number;
  produitCode: string;
  produitLibelle: string;
  dateEffet: DateIso;
  modifieLe: DateIso;
};

export type TableauTechnique = {
  periode: Periode;
  aujourdhui: DateIso;
  aValider: CotationAValiderTechnique[];
  aComposer: CotationAComposerTechnique[];
  contratsAValider: ContratAValiderTechnique[];
  modelesSoumis: ModeleSoumisTechnique[];
  baremesBrouillons: BaremeBrouillonTechnique[];
  transformation: { parProduit: LigneTransformation[] };
};

/**
 * Tableau de bord Technique : file de travail opérationnelle (cotations à valider, primes à composer,
 * contrats dépassant le seuil à valider, modèles Word soumis, barèmes en brouillon).
 */
export async function tableauTechnique(
  _acteur: UtilisateurCourant,
  periode?: Partial<Periode>,
): Promise<TableauTechnique> {
  const jour = aujourdhui();
  const p: Periode = { debut: periode?.debut || `${jour.slice(0, 4)}-01-01`, fin: periode?.fin || jour };
  const problemes = problemesPeriode(p, dateValide);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const prisma = obtenirPrisma();
  const entreInstants = { gte: versDate(p.debut), lte: finDuJour(p.fin) };

  // 1. Cotations à valider
  const rawAValider = await prisma.cotation.findMany({
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
    take: 15,
  });

  // 2. Primes à composer (cotations sur produit GARANTIES sans composition)
  const rawAComposer = await prisma.cotation.findMany({
    where: {
      statut: "BROUILLON",
      compositionParId: null,
      produit: {
        versions: {
          some: { modeTarification: "GARANTIES" },
        },
      },
    },
    select: {
      id: true,
      produit: { select: { code: true } },
      souscripteur: true,
      auteurIdentifiant: true,
      creeLe: true,
    },
    orderBy: { creeLe: "desc" },
    take: 15,
  });

  // 3. Contrats au-dessus du seuil à valider
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
    take: 15,
  });

  // 4. Modèles Word soumis (en attente de validation / publication)
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
    take: 15,
  });

  // 5. Barèmes en brouillon
  const rawBaremes = await prisma.baremeDocument.findMany({
    where: { statut: "BROUILLON" },
    select: {
      id: true,
      versionId: true,
      modifieLe: true,
      version: {
        select: {
          dateEffet: true,
          produit: { select: { code: true, libelle: true } },
        },
      },
    },
    orderBy: { modifieLe: "desc" },
    take: 15,
  });

  // 6. Transformation par produit sur la période
  const emises = await prisma.cotation.findMany({
    where: { emiseLe: entreInstants, numero: { not: null } },
    select: { statut: true, produit: { select: { code: true } } },
  });
  const parProduit = tauxTransformation(
    emises.map((c) => ({ cle: c.produit.code, acceptee: c.statut === "ACCEPTEE" })),
  );

  return {
    periode: p,
    aujourdhui: jour,
    aValider: rawAValider.map((c) => ({
      id: c.id,
      numero: c.numero,
      produitCode: c.produit.code,
      souscripteur: nomSouscripteur(c.souscripteur as unknown as Parameters<typeof nomSouscripteur>[0]),
      ttc: c.ttcTotal?.toFixed(0) ?? null,
      raisonsValidation: (c.raisonsValidation as string[]) ?? [],
      auteurIdentifiant: c.auteurIdentifiant,
      creeLe: depuisDate(c.creeLe),
    })),
    aComposer: rawAComposer.map((c) => ({
      id: c.id,
      produitCode: c.produit.code,
      souscripteur: nomSouscripteur(c.souscripteur as unknown as Parameters<typeof nomSouscripteur>[0]),
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
    modelesSoumis: rawModeles.map((m) => ({
      id: m.id,
      modeleId: m.modele.id,
      modeleCode: m.modele.code,
      modeleLibelle: m.modele.libelle,
      type: m.modele.type,
      numero: m.numero,
      auteurIdentifiant: m.auteurIdentifiant,
      soumisLe: m.soumisLe ? depuisDate(m.soumisLe) : null,
    })),
    baremesBrouillons: rawBaremes.map((b) => ({
      id: b.id,
      versionId: b.versionId,
      produitCode: b.version.produit.code,
      produitLibelle: b.version.produit.libelle,
      dateEffet: depuisDate(b.version.dateEffet),
      modifieLe: depuisDate(b.modifieLe),
    })),
    transformation: { parProduit },
  };
}

