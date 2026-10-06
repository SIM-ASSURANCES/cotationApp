import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { peutAgir, peutLire, type CodeAction } from "@/domaine/droits";
import { calculer, type EntreeCalcul, type AssietteTaxe, type ModeAccessoire, type ResultatCalcul, type RegleArrondi } from "@/domaine/calcul/calcul";
import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { genererEcheancier, type Tranche } from "@/domaine/calcul/echeancier";
import { ErreurCalcul, type Precision } from "@/domaine/calcul/montant";
import {
  codeValide,
  enVigueur,
  problemesTaxe,
  problemesVersion,
  type FormuleSaisie,
  type TaxeSaisie,
  type VersionSaisie,
} from "@/domaine/calcul/parametrage";
import { exigeDoubleValidation } from "@/domaine/calcul/validation";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

const ACTION_PARAMETRAGE: CodeAction = "PARAMETRER_PRODUITS";

/** Date (jour) en texte ISO, pour les colonnes `date` de PostgreSQL. */
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

/** Décimal Prisma en texte exact (jamais de notation exponentielle). */
const texte = (d: { toFixed(): string }) => d.toFixed();

export const aujourdhui = (): DateIso => new Date().toISOString().slice(0, 10);

async function exigerEcriture(acteur: UtilisateurCourant): Promise<void> {
  // « Oui » (Technique) ou « Valide » (DG). La « Proposition » de la Comptabilité demandera un
  // circuit de validation, qui n'existe pas encore : elle ne peut pas écrire.
  if (!peutAgir(await niveauDuProfil(acteur.profil, ACTION_PARAMETRAGE))) {
    throw new ErreurAcces("Droit insuffisant : paramétrage des produits et des taxes.");
  }
}

/** Consultation : paramétrage, ou cotation (qui doit pouvoir calculer). */
async function exigerConsultation(acteur: UtilisateurCourant): Promise<void> {
  const [parametrage, cotation] = await Promise.all([
    niveauDuProfil(acteur.profil, ACTION_PARAMETRAGE),
    niveauDuProfil(acteur.profil, "CREER_COTATION"),
  ]);
  if (!peutLire(parametrage) && !peutLire(cotation)) {
    throw new ErreurAcces("Droit insuffisant : consultation du paramétrage.");
  }
}

function refuserSiProblemes(problemes: string[]): void {
  if (problemes.length > 0) {
    throw new ErreurMetier(problemes.join(" "));
  }
}

// ---------------------------------------------------------------- Taxes

export type LigneTaxe = TaxeSaisie & { id: number };

export async function listerTaxes(acteur: UtilisateurCourant): Promise<LigneTaxe[]> {
  await exigerConsultation(acteur);
  const taxes = await obtenirPrisma().taxe.findMany({ orderBy: [{ branche: "asc" }, { dateEffet: "desc" }] });
  return taxes.map((t) => ({
    id: t.id,
    branche: t.branche,
    tauxPourcent: texte(t.tauxPourcent),
    assiette: t.assiette as AssietteTaxe,
    dateEffet: depuisDate(t.dateEffet),
    dateFin: t.dateFin ? depuisDate(t.dateFin) : null,
  }));
}

export async function creerTaxe(acteur: UtilisateurCourant, saisie: TaxeSaisie, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  refuserSiProblemes(problemesTaxe(saisie));
  await obtenirPrisma().$transaction(async (tx) => {
    if (await tx.taxe.findUnique({ where: { branche_dateEffet: { branche: saisie.branche, dateEffet: versDate(saisie.dateEffet) } } })) {
      throw new ErreurMetier("Une taxe existe déjà pour cette branche à cette date d'effet : ajoutez une ligne avec une autre date.");
    }
    const cree = await tx.taxe.create({
      data: {
        branche: saisie.branche,
        tauxPourcent: saisie.tauxPourcent,
        assiette: saisie.assiette,
        dateEffet: versDate(saisie.dateEffet),
        dateFin: saisie.dateFin ? versDate(saisie.dateFin) : null,
        creePar: acteur.identifiant,
      },
    });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "taxe",
        objetId: cree.id,
        apres: { ...saisie },
        adresseIp,
      },
      tx,
    );
  });
}

export type ClientLecture = Pick<Prisma.TransactionClient, "taxe" | "produit">;

async function taxeEnVigueur(client: ClientLecture, branche: string, date: DateIso): Promise<TaxeSaisie> {
  const lignes = await client.taxe.findMany({ where: { branche } });
  const candidates = lignes.map((t) => ({
    branche: t.branche,
    tauxPourcent: texte(t.tauxPourcent),
    assiette: t.assiette as AssietteTaxe,
    dateEffet: depuisDate(t.dateEffet),
    dateFin: t.dateFin ? depuisDate(t.dateFin) : null,
  }));
  const taxe = enVigueur(candidates, date);
  if (!taxe || (taxe.dateFin !== null && taxe.dateFin < date)) {
    throw new ErreurMetier(`Aucune taxe en vigueur pour la branche « ${branche} » au ${date}.`);
  }
  return taxe;
}

// ---------------------------------------------------------------- Produits

export type LigneProduit = {
  code: string;
  libelle: string;
  gamme: string;
  branche: string;
  actif: boolean;
  versions: DateIso[];
};

export async function listerProduits(acteur: UtilisateurCourant): Promise<LigneProduit[]> {
  await exigerConsultation(acteur);
  const produits = await obtenirPrisma().produit.findMany({
    include: { versions: { select: { dateEffet: true }, orderBy: { dateEffet: "desc" } } },
    orderBy: { code: "asc" },
  });
  return produits.map((p) => ({
    code: p.code,
    libelle: p.libelle,
    gamme: p.gamme,
    branche: p.branche,
    actif: p.actif,
    versions: p.versions.map((v) => depuisDate(v.dateEffet)),
  }));
}

export async function creerProduit(
  acteur: UtilisateurCourant,
  saisie: { code: string; libelle: string; gamme: string; branche: string },
  adresseIp: string | null,
): Promise<void> {
  await exigerEcriture(acteur);
  const problemes: string[] = [];
  if (!codeValide(saisie.code)) problemes.push("Code produit invalide (majuscules, chiffres et _, 30 caractères au plus).");
  if (!codeValide(saisie.branche)) problemes.push("Branche invalide (majuscules, chiffres et _).");
  if (saisie.libelle.trim() === "" || saisie.gamme.trim() === "") problemes.push("Libellé et gamme obligatoires.");
  refuserSiProblemes(problemes);

  await obtenirPrisma().$transaction(async (tx) => {
    if (await tx.produit.findUnique({ where: { code: saisie.code } })) {
      throw new ErreurMetier("Ce code produit existe déjà.");
    }
    const cree = await tx.produit.create({
      data: { code: saisie.code, libelle: saisie.libelle.trim(), gamme: saisie.gamme.trim(), branche: saisie.branche, creePar: acteur.identifiant },
    });
    await journaliser(
      { acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "PARAMETRE_MODIFIE", objetType: "produit", objetId: cree.id, apres: { ...saisie }, adresseIp },
      tx,
    );
  });
}

export type VersionProduit = VersionSaisie & { id: number };

function versVersion(v: Prisma.ProduitVersionGetPayload<{ include: { formules: true } }>): VersionProduit {
  return {
    id: v.id,
    dateEffet: depuisDate(v.dateEffet),
    arrondi: {
      precision: v.arrondiPrecision as Precision,
      sens: v.arrondiSens as RegleArrondi["sens"],
      niveau: v.arrondiNiveau as RegleArrondi["niveau"],
      composanteAbsorbante: v.arrondiComposante as RegleArrondi["composanteAbsorbante"],
    },
    prorata: { actif: v.prorataActif, primeMinimale: v.primeMinimale ? texte(v.primeMinimale) : null },
    fractionnement: {
      tranchesMax: v.fractionnementTranchesMax,
      repartitionPourcent: (v.fractionnementRepartition as string[] | null) ?? null,
      decalagesMois: (v.fractionnementDecalagesMois as number[] | null) ?? null,
      frais: texte(v.fraisFractionnement),
    },
    cotation: { validiteMois: v.validiteMois, formulesMax: v.formulesMax },
    seuilValidationTtc: v.seuilValidationTtc ? texte(v.seuilValidationTtc) : null,
    references: { cgModeleCode: v.cgModeleCode, cgVisa: v.cgVisa, csModeleCode: v.csModeleCode, csVisa: v.csVisa },
    formules: v.formules
      .map(
        (f): FormuleSaisie => ({
          code: f.code,
          libelle: f.libelle,
          tauxCouverture: f.tauxCouverture ? texte(f.tauxCouverture) : null,
          primeUnitaire: texte(f.primeUnitaire),
          accessoireMode: f.accessoireMode as ModeAccessoire,
          accessoireValeur: texte(f.accessoireValeur),
        }),
      )
      .sort((a, b) => (a.code < b.code ? -1 : 1)),
  };
}

export async function listerVersions(acteur: UtilisateurCourant, codeProduit: string): Promise<{ produit: LigneProduit; versions: VersionProduit[] } | null> {
  await exigerConsultation(acteur);
  const produit = await obtenirPrisma().produit.findUnique({
    where: { code: codeProduit },
    include: { versions: { include: { formules: true }, orderBy: { dateEffet: "desc" } } },
  });
  if (!produit) {
    return null;
  }
  return {
    produit: { code: produit.code, libelle: produit.libelle, gamme: produit.gamme, branche: produit.branche, actif: produit.actif, versions: produit.versions.map((v) => depuisDate(v.dateEffet)) },
    versions: produit.versions.map(versVersion),
  };
}

/** Ajoute une version (jamais de modification) : c'est ainsi que le paramétrage reste historisé. */
export async function creerVersion(acteur: UtilisateurCourant, codeProduit: string, saisie: VersionSaisie, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  refuserSiProblemes(problemesVersion(saisie));

  await obtenirPrisma().$transaction(async (tx) => {
    const produit = await tx.produit.findUnique({ where: { code: codeProduit } });
    if (!produit) {
      throw new ErreurMetier("Produit introuvable.");
    }
    if (await tx.produitVersion.findUnique({ where: { produitId_dateEffet: { produitId: produit.id, dateEffet: versDate(saisie.dateEffet) } } })) {
      throw new ErreurMetier("Une version existe déjà à cette date d'effet : une version en vigueur ne se modifie pas, ajoutez-en une avec une autre date.");
    }
    const cree = await tx.produitVersion.create({
      data: {
        produitId: produit.id,
        dateEffet: versDate(saisie.dateEffet),
        arrondiPrecision: saisie.arrondi.precision,
        arrondiSens: saisie.arrondi.sens,
        arrondiNiveau: saisie.arrondi.niveau,
        arrondiComposante: saisie.arrondi.composanteAbsorbante,
        prorataActif: saisie.prorata.actif,
        primeMinimale: saisie.prorata.primeMinimale,
        fractionnementTranchesMax: saisie.fractionnement.tranchesMax,
        fractionnementRepartition: saisie.fractionnement.repartitionPourcent ?? undefined,
        fractionnementDecalagesMois: saisie.fractionnement.decalagesMois ?? undefined,
        fraisFractionnement: saisie.fractionnement.frais,
        validiteMois: saisie.cotation.validiteMois,
        formulesMax: saisie.cotation.formulesMax,
        seuilValidationTtc: saisie.seuilValidationTtc,
        cgModeleCode: saisie.references?.cgModeleCode ?? null,
        cgVisa: saisie.references?.cgVisa?.trim() ?? null,
        csModeleCode: saisie.references?.csModeleCode ?? null,
        csVisa: saisie.references?.csVisa?.trim() ?? null,
        creePar: acteur.identifiant,
        formules: {
          create: saisie.formules.map((f) => ({
            code: f.code,
            libelle: f.libelle.trim(),
            tauxCouverture: f.tauxCouverture,
            primeUnitaire: f.primeUnitaire,
            accessoireMode: f.accessoireMode,
            accessoireValeur: f.accessoireValeur,
          })),
        },
      },
    });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "produit_version",
        objetId: cree.id,
        apres: { produit: codeProduit, dateEffet: saisie.dateEffet, formules: saisie.formules.map((f) => f.code) },
        adresseIp,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------- Calcul

export type DemandeCalcul = {
  codeProduit: string;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  /** Date du document : les paramètres utilisés sont ceux en vigueur à cette date (défaut : aujourd'hui). */
  dateDocument?: DateIso;
  lignes: { codeFormule: string; effectif: number }[];
  nombreTranches?: number;
};

export type ReponseCalcul = {
  produit: { code: string; libelle: string };
  versionDu: DateIso;
  taxe: { branche: string; tauxPourcent: string; dateEffet: DateIso };
  libelles: Record<string, string>;
  resultat: ResultatCalcul;
  echeancier: Tranche[] | null;
  doubleValidationRequise: boolean;
};

/** Paramètres résolus pour un calcul : version du produit à la date du document, taxe à la date d'effet. */
export type ContexteCalcul = {
  produit: { id: number; code: string; libelle: string };
  version: VersionProduit;
  taxe: TaxeSaisie;
};

/**
 * Trouve les paramètres EN VIGUEUR : la version du produit à la date du document, la taxe de la
 * branche à la date d'effet de la police (CDC §8.1).
 */
export async function resoudreContexte(
  client: ClientLecture,
  codeProduit: string,
  dateDocument: DateIso,
  dateEffet: DateIso,
): Promise<ContexteCalcul> {
  for (const d of [dateEffet, dateDocument]) {
    if (!dateValide(d)) {
      throw new ErreurMetier(`Date invalide : « ${d} ».`);
    }
  }
  const produit = await client.produit.findUnique({
    where: { code: codeProduit },
    include: { versions: { include: { formules: true } } },
  });
  if (!produit) {
    throw new ErreurMetier("Produit introuvable.");
  }
  if (!produit.actif) {
    throw new ErreurMetier("Ce produit est inactif.");
  }
  const version = enVigueur(produit.versions.map(versVersion), dateDocument);
  if (!version) {
    throw new ErreurMetier(`Aucun paramétrage de « ${produit.code} » en vigueur au ${dateDocument}.`);
  }
  const taxe = await taxeEnVigueur(client, produit.branche, dateEffet);
  return { produit: { id: produit.id, code: produit.code, libelle: produit.libelle }, version, taxe };
}

export type LigneDemande = {
  codeFormule: string;
  effectif: number;
  /** Prime unitaire forcée (CDC §4.1) : remplace le tarif ; le motif et la validation sont exigés par l'appelant. */
  primeForcee?: string | null;
};

/** Construit l'entrée du moteur à partir du contexte. La prime de tarif de chaque ligne est renvoyée à part. */
export function construireEntree(
  contexte: ContexteCalcul,
  demande: { dateEffet: DateIso; dateEcheance: DateIso; lignes: LigneDemande[]; nombreTranches: number },
): { entree: EntreeCalcul; primesTarif: Record<string, string> } {
  const { version, taxe } = contexte;
  if (!Number.isInteger(demande.nombreTranches) || demande.nombreTranches < 1 || demande.nombreTranches > version.fractionnement.tranchesMax) {
    throw new ErreurMetier(`Ce produit autorise de 1 à ${version.fractionnement.tranchesMax} tranche(s).`);
  }
  const primesTarif: Record<string, string> = {};
  const lignes = demande.lignes.map((l) => {
    const formule = version.formules.find((f) => f.code === l.codeFormule);
    if (!formule) {
      throw new ErreurMetier(`Formule « ${l.codeFormule} » inconnue pour ce produit.`);
    }
    primesTarif[formule.code] = formule.primeUnitaire;
    return {
      code: formule.code,
      primeUnitaire: l.primeForcee ?? formule.primeUnitaire,
      effectif: l.effectif,
      accessoire: { mode: formule.accessoireMode, valeur: formule.accessoireValeur },
    };
  });
  return {
    primesTarif,
    entree: {
      dateEffet: demande.dateEffet,
      dateEcheance: demande.dateEcheance,
      lignes,
      parametres: {
        prorata: version.prorata,
        arrondi: version.arrondi,
        taxe: { tauxPourcent: taxe.tauxPourcent, assiette: taxe.assiette },
        fraisFractionnement: demande.nombreTranches > 1 ? version.fractionnement.frais : undefined,
      },
    },
  };
}

/** Moteur + échéancier. Les erreurs de calcul deviennent des refus lisibles. */
export function executerCalcul(
  entree: EntreeCalcul,
  fractionnement: { repartitionPourcent: string[] | null; decalagesMois: number[] | null },
  nombreTranches: number,
): { resultat: ResultatCalcul; echeancier: Tranche[] | null } {
  try {
    const resultat = calculer(entree);
    const { repartitionPourcent, decalagesMois } = fractionnement;
    const echeancier =
      nombreTranches > 1
        ? genererEcheancier({
            ttc: resultat.totaux.arrondi.ttc,
            nombreTranches,
            dateEffet: entree.dateEffet,
            repartitionPourcent: repartitionPourcent?.length === nombreTranches ? repartitionPourcent : undefined,
            decalagesMois: decalagesMois?.length === nombreTranches ? decalagesMois : undefined,
            arrondi: { precision: entree.parametres.arrondi.precision, sens: entree.parametres.arrondi.sens },
          })
        : null;
    return { resultat, echeancier };
  } catch (erreur) {
    if (erreur instanceof ErreurCalcul) {
      throw new ErreurMetier(erreur.message);
    }
    throw erreur;
  }
}

/**
 * Calcule les primes d'un produit avec les paramètres EN VIGUEUR. Le moteur (domaine/calcul) reste
 * pur : ce service ne fait que lui fournir les paramètres.
 */
export async function calculerPourProduit(acteur: UtilisateurCourant, demande: DemandeCalcul): Promise<ReponseCalcul> {
  await exigerConsultation(acteur);
  const dateDocument = demande.dateDocument ?? aujourdhui();
  if (!dateValide(demande.dateEcheance)) {
    throw new ErreurMetier(`Date invalide : « ${demande.dateEcheance} ».`);
  }
  const contexte = await resoudreContexte(obtenirPrisma(), demande.codeProduit, dateDocument, demande.dateEffet);
  const nombreTranches = demande.nombreTranches ?? 1;
  const { entree } = construireEntree(contexte, {
    dateEffet: demande.dateEffet,
    dateEcheance: demande.dateEcheance,
    lignes: demande.lignes,
    nombreTranches,
  });
  const { resultat, echeancier } = executerCalcul(entree, contexte.version.fractionnement, nombreTranches);
  return {
    produit: { code: contexte.produit.code, libelle: contexte.produit.libelle },
    versionDu: contexte.version.dateEffet,
    taxe: { branche: contexte.taxe.branche, tauxPourcent: contexte.taxe.tauxPourcent, dateEffet: contexte.taxe.dateEffet },
    libelles: Object.fromEntries(contexte.version.formules.map((f) => [f.code, f.libelle])),
    resultat,
    echeancier,
    doubleValidationRequise: exigeDoubleValidation(resultat.totaux.arrondi.ttc, contexte.version.seuilValidationTtc),
  };
}
