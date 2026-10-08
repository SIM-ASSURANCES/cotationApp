import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { peutAgir, peutLire, type CodeAction } from "@/domaine/droits";
import { calculer, VERSION_MOTEUR, type EntreeCalcul, type AssietteTaxe, type ModeAccessoire, type ResultatCalcul, type RegleArrondi } from "@/domaine/calcul/calcul";
import { ajouterJours, dateValide, type DateIso } from "@/domaine/calcul/dates";
import { genererEcheancier, type Tranche } from "@/domaine/calcul/echeancier";
import { ErreurCalcul, montant, type Precision } from "@/domaine/calcul/montant";
import {
  codeValide,
  enVigueur,
  problemesTaxe,
  problemesVersion,
  type FormuleSaisie,
  type TaxeSaisie,
  type VersionSaisie,
} from "@/domaine/calcul/parametrage";
import { choisirTaux, estTypeContrat, periodesSeChevauchent, problemesBranche, type BrancheSaisie, type TypeContrat } from "@/domaine/calcul/taxes";
import { exigeDoubleValidation } from "@/domaine/calcul/validation";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

const ACTION_PARAMETRAGE: CodeAction = "PARAMETRER_PRODUITS";

/** Date (jour) en texte ISO, pour les colonnes `date` de PostgreSQL. */
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

/**
 * Montant déjà validé, en écriture canonique pour la base (« 93 581,33 » → « 93581.33 ») : la base ne
 * reçoit jamais le texte saisi tel quel (recette 2.3a : erreur 500 de Prisma).
 */
const canonique = (t: string): string => montant(t).toFixed();
const canoniqueOuNull = (t: string | null): string | null => (t === null ? null : canonique(t));

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

// ---------------------------------------------------------------- Branches fiscales

/** Branche fiscale (D21) : liste paramétrable, clé des taxes et des produits. Le code ne change jamais. */
export type LigneBranche = BrancheSaisie & { actif: boolean; creePar: string; creeLe: Date };

export async function listerBranches(acteur: UtilisateurCourant): Promise<LigneBranche[]> {
  await exigerConsultation(acteur);
  const branches = await obtenirPrisma().branche.findMany({ orderBy: { code: "asc" } });
  return branches.map((b) => ({ code: b.code, libelle: b.libelle, actif: b.actif, creePar: b.creePar, creeLe: b.creeLe }));
}

/** Ajoute une branche à la liste (journalisé). */
export async function creerBranche(acteur: UtilisateurCourant, saisie: BrancheSaisie, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  refuserSiProblemes(problemesBranche(saisie));
  await obtenirPrisma().$transaction(async (tx) => {
    if (await tx.branche.findUnique({ where: { code: saisie.code } })) throw new ErreurMetier(`La branche « ${saisie.code} » existe déjà.`);
    await tx.branche.create({ data: { code: saisie.code, libelle: saisie.libelle.trim(), creePar: acteur.identifiant } });
    await journaliser(
      { acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "PARAMETRE_MODIFIE", objetType: "branche", objetId: saisie.code, apres: { code: saisie.code, libelle: saisie.libelle.trim(), actif: true }, adresseIp },
      tx,
    );
  });
}

/**
 * Modifie le libellé et/ou l'état actif d'une branche (journalisé, avant/après). Une branche ne se
 * supprime pas : désactivée, elle garde ses taux et ses produits mais n'en reçoit plus de nouveaux.
 */
export async function modifierBranche(acteur: UtilisateurCourant, code: string, modif: { libelle: string; actif: boolean }, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  refuserSiProblemes(problemesBranche({ code, libelle: modif.libelle }));
  await obtenirPrisma().$transaction(async (tx) => {
    const avant = await tx.branche.findUnique({ where: { code } });
    if (!avant) throw new ErreurMetier(`Branche « ${code} » introuvable.`);
    const libelle = modif.libelle.trim();
    if (avant.libelle === libelle && avant.actif === modif.actif) return;
    await tx.branche.update({ where: { code }, data: { libelle, actif: modif.actif } });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "branche",
        objetId: code,
        avant: { libelle: avant.libelle, actif: avant.actif },
        apres: { libelle, actif: modif.actif },
        adresseIp,
      },
      tx,
    );
  });
}

/** Branche à utiliser pour un taux ou un produit : elle doit exister et être active. */
async function exigerBrancheActive(tx: Prisma.TransactionClient, code: string): Promise<void> {
  const b = await tx.branche.findUnique({ where: { code } });
  if (!b) throw new ErreurMetier(`La branche « ${code} » n'est pas dans la liste des branches : ajoutez-la d'abord (écran « Branches »).`);
  if (!b.actif) throw new ErreurMetier(`La branche « ${code} » est désactivée : réactivez-la avant d'y ajouter un taux ou un produit.`);
}

/** Branches de démarrage (prisma/donnees/branches.json), idempotent : une branche existante n'est jamais modifiée. */
export async function initialiserBranches(lignes: BrancheSaisie[], auteur = "initialisation"): Promise<number> {
  let crees = 0;
  for (const l of lignes) {
    refuserSiProblemes(problemesBranche(l));
    await obtenirPrisma().$transaction(async (tx) => {
      if (await tx.branche.findUnique({ where: { code: l.code } })) return;
      await tx.branche.create({ data: { code: l.code, libelle: l.libelle.trim(), creePar: auteur } });
      await journaliser({ acteur: null, action: "PARAMETRE_MODIFIE", objetType: "branche", objetId: l.code, apres: { ...l, actif: true, source: "données de démarrage" }, adresseIp: null }, tx);
      crees += 1;
    });
  }
  return crees;
}

// ---------------------------------------------------------------- Taxes

/** Une version d'un taux : sa période, sa valeur, son auteur et sa date de saisie (historique, D18). */
export type LigneTaxe = TaxeSaisie & { id: number; creePar: string; creeLe: Date };

function versLigneTaxe(t: Prisma.TaxeGetPayload<object>): LigneTaxe {
  return {
    id: t.id,
    branche: t.branche,
    typeContrat: (t.typeContrat as TypeContrat | null) ?? null,
    tauxPourcent: t.tauxPourcent ? texte(t.tauxPourcent) : null,
    tauxMixte: t.tauxMixte,
    commentaire: t.commentaire,
    assiette: t.assiette as AssietteTaxe,
    dateEffet: depuisDate(t.dateEffet),
    dateFin: t.dateFin ? depuisDate(t.dateFin) : null,
    creePar: t.creePar,
    creeLe: t.creeLe,
  };
}

/** Toutes les versions de tous les taux, regroupables par clé (branche, type de contrat), les plus récentes d'abord. */
export async function listerTaxes(acteur: UtilisateurCourant): Promise<LigneTaxe[]> {
  await exigerConsultation(acteur);
  const taxes = await obtenirPrisma().taxe.findMany({ orderBy: [{ branche: "asc" }, { typeContrat: { sort: "asc", nulls: "first" } }, { dateEffet: "desc" }] });
  return taxes.map(versLigneTaxe);
}

const libelleCle = (branche: string, type: string | null) => `« ${branche} » (${type ?? "tous types de contrat"})`;

/**
 * Ajoute une version d'un taux. Pour une même clé (branche, type de contrat), les périodes ne se
 * chevauchent jamais (recette 2.2b ; contrainte d'exclusion en base). Si la ligne précédente n'a pas de
 * date de fin et commence avant la nouvelle, elle est CLÔTURÉE la veille : c'est la seule modification
 * permise sur une ligne en vigueur, et elle est journalisée. Tout autre chevauchement est refusé.
 */
export async function creerTaxe(acteur: UtilisateurCourant, saisie: TaxeSaisie, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  refuserSiProblemes(problemesTaxe(saisie));
  const auteurAudit = { id: acteur.id, identifiant: acteur.identifiant };
  try {
    await obtenirPrisma().$transaction(async (tx) => {
      await exigerBrancheActive(tx, saisie.branche);
      const memeCle = (await tx.taxe.findMany({ where: { branche: saisie.branche, typeContrat: saisie.typeContrat } })).map(versLigneTaxe);
      const chevauchees = memeCle.filter((t) => periodesSeChevauchent(t, saisie));
      const aCloturer = chevauchees.length === 1 && chevauchees[0].dateFin === null && chevauchees[0].dateEffet < saisie.dateEffet ? chevauchees[0] : null;
      if (chevauchees.length > 0 && !aCloturer) {
        const p = chevauchees.map((t) => `du ${t.dateEffet} ${t.dateFin ? `au ${t.dateFin}` : "sans date de fin"}`).join(", ");
        throw new ErreurMetier(`Période refusée : elle chevauche un taux ${libelleCle(saisie.branche, saisie.typeContrat)} déjà enregistré (${p}). Deux périodes d'un même taux ne peuvent pas se chevaucher.`);
      }
      if (aCloturer) {
        const veille = ajouterJours(saisie.dateEffet, -1);
        await tx.taxe.update({ where: { id: aCloturer.id }, data: { dateFin: versDate(veille) } });
        await journaliser(
          { acteur: auteurAudit, action: "PARAMETRE_MODIFIE", objetType: "taxe", objetId: aCloturer.id, avant: { dateFin: null }, apres: { dateFin: veille, motif: "clôture par un nouveau taux" }, adresseIp },
          tx,
        );
      }
      const cree = await tx.taxe.create({
        data: {
          branche: saisie.branche,
          typeContrat: saisie.typeContrat,
          tauxPourcent: canoniqueOuNull(saisie.tauxPourcent),
          tauxMixte: saisie.tauxMixte,
          commentaire: saisie.commentaire?.trim() || null,
          assiette: saisie.assiette,
          dateEffet: versDate(saisie.dateEffet),
          dateFin: saisie.dateFin ? versDate(saisie.dateFin) : null,
          creePar: acteur.identifiant,
        },
      });
      await journaliser({ acteur: auteurAudit, action: "PARAMETRE_MODIFIE", objetType: "taxe", objetId: cree.id, apres: { ...saisie }, adresseIp }, tx);
    });
  } catch (erreur) {
    // Filet de sécurité : la contrainte d'exclusion de la base (deux saisies simultanées, par exemple).
    if (erreur instanceof Error && /taxes_sans_chevauchement|23P01/.test(erreur.message)) {
      throw new ErreurMetier(`Période refusée : elle chevauche un taux ${libelleCle(saisie.branche, saisie.typeContrat)} déjà enregistré.`);
    }
    throw erreur;
  }
}

export type ClientLecture = Pick<Prisma.TransactionClient, "taxe" | "produit">;

/** Taux le plus précis pour la branche et le type de contrat, en vigueur à la date d'effet (D18, H29). */
async function taxeEnVigueur(client: ClientLecture, branche: string, typeContrat: TypeContrat, date: DateIso): Promise<TaxeSaisie & { tauxPourcent: string }> {
  const lignes = (await client.taxe.findMany({ where: { branche } })).map(versLigneTaxe);
  try {
    return choisirTaux(lignes, branche, typeContrat, date);
  } catch (erreur) {
    if (erreur instanceof ErreurCalcul) throw new ErreurMetier(erreur.message);
    throw erreur;
  }
}

/** Données de démarrage des taux (jamais écrites dans le moteur) : voir prisma/donnees/taxes-loi.json. */
export type TaxeDemarrage = Omit<TaxeSaisie, "assiette"> & { assiette?: AssietteTaxe };

/**
 * Charge les taux de démarrage (idempotent) : une ligne n'est ajoutée que si sa clé (branche, type de
 * contrat) n'a encore AUCUNE ligne. Un taux déjà paramétré n'est jamais modifié.
 */
export async function initialiserTaxes(lignes: TaxeDemarrage[], auteur = "initialisation"): Promise<number> {
  let crees = 0;
  for (const l of lignes) {
    const saisie: TaxeSaisie = { ...l, assiette: l.assiette ?? "NETTE_ACCESSOIRES" };
    const problemes = problemesTaxe(saisie);
    if (problemes.length > 0) throw new Error(`Taux de démarrage invalide (${libelleCle(l.branche, l.typeContrat)}) : ${problemes.join(" ")}`);
    await obtenirPrisma().$transaction(async (tx) => {
      if (await tx.taxe.findFirst({ where: { branche: saisie.branche, typeContrat: saisie.typeContrat } })) return;
      const cree = await tx.taxe.create({
        data: {
          branche: saisie.branche,
          typeContrat: saisie.typeContrat,
          tauxPourcent: canoniqueOuNull(saisie.tauxPourcent),
          tauxMixte: saisie.tauxMixte,
          commentaire: saisie.commentaire,
          assiette: saisie.assiette,
          dateEffet: versDate(saisie.dateEffet),
          dateFin: saisie.dateFin ? versDate(saisie.dateFin) : null,
          creePar: auteur,
        },
      });
      await journaliser({ acteur: null, action: "PARAMETRE_MODIFIE", objetType: "taxe", objetId: cree.id, apres: { ...saisie, source: "données de démarrage" }, adresseIp: null }, tx);
      crees += 1;
    });
  }
  return crees;
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
  if (!codeValide(saisie.branche)) problemes.push("Branche invalide (choisissez-la dans la liste des branches).");
  if (saisie.libelle.trim() === "" || saisie.gamme.trim() === "") problemes.push("Libellé et gamme obligatoires.");
  refuserSiProblemes(problemes);

  await obtenirPrisma().$transaction(async (tx) => {
    if (await tx.produit.findUnique({ where: { code: saisie.code } })) {
      throw new ErreurMetier("Ce code produit existe déjà.");
    }
    await exigerBrancheActive(tx, saisie.branche);
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
        primeMinimale: canoniqueOuNull(saisie.prorata.primeMinimale),
        fractionnementTranchesMax: saisie.fractionnement.tranchesMax,
        fractionnementRepartition: saisie.fractionnement.repartitionPourcent?.map(canonique) ?? undefined,
        fractionnementDecalagesMois: saisie.fractionnement.decalagesMois ?? undefined,
        fraisFractionnement: canonique(saisie.fractionnement.frais),
        validiteMois: saisie.cotation.validiteMois,
        formulesMax: saisie.cotation.formulesMax,
        seuilValidationTtc: canoniqueOuNull(saisie.seuilValidationTtc),
        cgModeleCode: saisie.references?.cgModeleCode ?? null,
        cgVisa: saisie.references?.cgVisa?.trim() ?? null,
        csModeleCode: saisie.references?.csModeleCode ?? null,
        csVisa: saisie.references?.csVisa?.trim() ?? null,
        creePar: acteur.identifiant,
        formules: {
          create: saisie.formules.map((f) => ({
            code: f.code,
            libelle: f.libelle.trim(),
            tauxCouverture: canoniqueOuNull(f.tauxCouverture),
            primeUnitaire: canonique(f.primeUnitaire),
            accessoireMode: f.accessoireMode,
            accessoireValeur: canonique(f.accessoireValeur),
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
  /** Type de contrat (police.type_contrat) : il choisit le taux de taxe (D18). */
  typeContrat: TypeContrat;
  lignes: { codeFormule: string; effectif: number }[];
  nombreTranches?: number;
};

export type ReponseCalcul = {
  produit: { code: string; libelle: string };
  versionDu: DateIso;
  taxe: { branche: string; typeContrat: TypeContrat | null; tauxPourcent: string; dateEffet: DateIso };
  libelles: Record<string, string>;
  resultat: ResultatCalcul;
  echeancier: Tranche[] | null;
  doubleValidationRequise: boolean;
};

/** Paramètres résolus pour un calcul : version du produit à la date du document, taxe à la date d'effet. */
export type ContexteCalcul = {
  produit: { id: number; code: string; libelle: string };
  version: VersionProduit;
  taxe: TaxeSaisie & { tauxPourcent: string };
};

/**
 * Trouve les paramètres EN VIGUEUR : la version du produit à la date du document, la taxe de la
 * branche et du type de contrat à la date d'effet de la police (CDC §8.1, D18 ; décision de Thierry du
 * 08/10/2026 : la date d'effet, pas la date du document).
 */
export async function resoudreContexte(
  client: ClientLecture,
  codeProduit: string,
  dateDocument: DateIso,
  dateEffet: DateIso,
  typeContrat: TypeContrat,
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
  const taxe = await taxeEnVigueur(client, produit.branche, typeContrat, dateEffet);
  return { produit: { id: produit.id, code: produit.code, libelle: produit.libelle }, version, taxe };
}

export type LigneDemande = {
  codeFormule: string;
  effectif: number;
  /** Prime unitaire forcée (CDC §4.1) : remplace le tarif ; le motif et la validation sont exigés par l'appelant. */
  primeForcee?: string | null;
  /**
   * Valeur des accessoires saisie dans la cotation (H1, D18), dans le mode de la formule : remplace la
   * valeur par défaut du paramétrage. Ce n'est pas un forçage ; la modification est journalisée.
   */
  accessoireValeur?: string | null;
};

/** Construit l'entrée du moteur à partir du contexte. La prime de tarif de chaque ligne est renvoyée à part. */
export function construireEntree(
  contexte: ContexteCalcul,
  demande: { dateEffet: DateIso; dateEcheance: DateIso; lignes: LigneDemande[]; nombreTranches: number },
): { entree: EntreeCalcul; primesTarif: Record<string, string>; accessoiresTarif: Record<string, string> } {
  const { version, taxe } = contexte;
  if (!Number.isInteger(demande.nombreTranches) || demande.nombreTranches < 1 || demande.nombreTranches > version.fractionnement.tranchesMax) {
    throw new ErreurMetier(`Ce produit autorise de 1 à ${version.fractionnement.tranchesMax} tranche(s).`);
  }
  const primesTarif: Record<string, string> = {};
  const accessoiresTarif: Record<string, string> = {};
  const lignes = demande.lignes.map((l) => {
    const formule = version.formules.find((f) => f.code === l.codeFormule);
    if (!formule) {
      throw new ErreurMetier(`Formule « ${l.codeFormule} » inconnue pour ce produit.`);
    }
    primesTarif[formule.code] = formule.primeUnitaire;
    accessoiresTarif[formule.code] = formule.accessoireValeur;
    const accessoire = l.accessoireValeur ?? formule.accessoireValeur;
    const problemes: string[] = [];
    try {
      const valeur = montant(accessoire);
      if (valeur.isNegative() || (formule.accessoireMode === "POURCENT" && valeur.greaterThan(100))) {
        problemes.push(`Accessoires de « ${formule.code} » : valeur hors limites (0 ${formule.accessoireMode === "POURCENT" ? "à 100 %" : "ou plus"}).`);
      }
    } catch (erreur) {
      problemes.push(`Accessoires de « ${formule.code} » : ${erreur instanceof Error ? erreur.message : "valeur invalide"}`);
    }
    refuserSiProblemes(problemes);
    return {
      code: formule.code,
      primeUnitaire: l.primeForcee ?? formule.primeUnitaire,
      effectif: l.effectif,
      accessoire: { mode: formule.accessoireMode, valeur: canonique(accessoire) },
    };
  });
  return {
    primesTarif,
    accessoiresTarif,
    entree: {
      moteur: VERSION_MOTEUR,
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
  if (!estTypeContrat(demande.typeContrat)) {
    throw new ErreurMetier("Choisissez le type de contrat (individuel, famille, groupe ou groupe ouvert).");
  }
  const contexte = await resoudreContexte(obtenirPrisma(), demande.codeProduit, dateDocument, demande.dateEffet, demande.typeContrat);
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
    taxe: { branche: contexte.taxe.branche, typeContrat: contexte.taxe.typeContrat, tauxPourcent: contexte.taxe.tauxPourcent, dateEffet: contexte.taxe.dateEffet },
    libelles: Object.fromEntries(contexte.version.formules.map((f) => [f.code, f.libelle])),
    resultat,
    echeancier,
    doubleValidationRequise: exigeDoubleValidation(resultat.totaux.arrondi.ttc, contexte.version.seuilValidationTtc),
  };
}
