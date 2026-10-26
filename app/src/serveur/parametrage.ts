import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { peutAgir, peutLire, type CodeAction } from "@/domaine/droits";
import { calculer, VERSION_MOTEUR, type EntreeCalcul, type AssietteTaxe, type ModeAccessoire, type ResultatCalcul, type RegleArrondi } from "@/domaine/calcul/calcul";
import { ajouterJours, aujourdhui, dateValide, type DateIso } from "@/domaine/calcul/dates";
import { genererEcheancier, type Tranche } from "@/domaine/calcul/echeancier";
import { composer, VERSION_COMPOSITION, estComposition, type DonneesCalcul, type EntreeComposition, type LigneComposee, type LigneDePrime } from "@/domaine/calcul/composition";
import { ErreurCalcul, montant, type Precision } from "@/domaine/calcul/montant";
import {
  BRANCHES_PRINCIPALES,
  calculAutomatiquePossible,
  codeValide,
  compositionPossible,
  enVigueur,
  estBranchePrincipaleValide,
  libelleBranchePrincipale,
  MESSAGE_COMPOSITION_IMPOSSIBLE,
  MESSAGE_TARIFICATION_AU_BAREME,
  MESSAGE_TARIFICATION_PAR_GARANTIES,
  problemesTaxe,
  problemesVersion,
  type CodeBranchePrincipale,
  type FormuleSaisie,
  type GarantieParametree,
  type ModeTarification,
  type TaxeSaisie,
  type VersionSaisie,
} from "@/domaine/calcul/parametrage";
import { choisirTaux, estRegimeTaxe, periodesSeChevauchent, problemesBranche, type BrancheSaisie, type RegimeTaxe, type TypeContrat } from "@/domaine/calcul/taxes";
import { exigeDoubleValidation } from "@/domaine/calcul/validation";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { obtenirPrisma } from "./prisma";
import { lireSeuilValidationGlobal } from "./societe";
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

export { aujourdhui };

export async function exigerEcriture(acteur: UtilisateurCourant): Promise<void> {
  // « Oui » (Technique) ou « Valide » (DG). La Comptabilité est en « Lecture » (D21) : elle ne peut pas écrire.
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

/**
 * Refuse si la version EN VIGUEUR à `date` est tarifée par garanties, alors que le document en attente est rattaché à une version
 * plus ancienne : un produit basculé en GARANTIES n'émet plus rien de calculé, pas même ce qui attendait (cotation « À valider »,
 * brouillon de renouvellement). Pour ce qui est déjà émis ou figé sur la police (T10), cette fonction n'est jamais appelée.
 */
export async function exigerCalculAutomatiqueEnVigueur(client: Pick<Prisma.TransactionClient, "produitVersion">, produitId: number, date: DateIso): Promise<void> {
  const versions = await client.produitVersion.findMany({ where: { produitId }, select: { dateEffet: true, modeTarification: true } });
  const enCours = enVigueur(versions.map((v) => ({ dateEffet: depuisDate(v.dateEffet), modeTarification: v.modeTarification })), date);
  if (enCours) exigerCalculAutomatique(enCours.modeTarification);
}

/** Taux le plus précis pour la branche et le régime de taxe, en vigueur à la date d'effet (D18 ; H29 fermée, session 6.0). */
export async function taxeEnVigueur(client: ClientLecture, branche: string, regime: RegimeTaxe, date: DateIso): Promise<TaxeSaisie & { tauxPourcent: string }> {
  const lignes = (await client.taxe.findMany({ where: { branche } })).map(versLigneTaxe);
  try {
    return choisirTaux(lignes, branche, regime, date);
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

// ---------------------------------------------------------------- Branches principales (classement des produits, D37, H105)

export type LigneBranchePrincipale = { code: CodeBranchePrincipale; libelle: string };

export async function listerBranchesPrincipales(acteur: UtilisateurCourant): Promise<LigneBranchePrincipale[]> {
  await exigerConsultation(acteur);
  const enBase = await obtenirPrisma().branchePrincipale.findMany();
  const parCode = new Map(enBase.map((b) => [b.code, b.libelle]));
  return BRANCHES_PRINCIPALES.map((b) => ({ code: b.code, libelle: parCode.get(b.code) ?? b.libelle }));
}

/** Branches principales de démarrage (prisma/donnees/branches-principales.json), idempotent. */
export async function initialiserBranchesPrincipales(lignes: { code: string; libelle: string }[] = [...BRANCHES_PRINCIPALES]): Promise<number> {
  let crees = 0;
  for (const l of lignes) {
    if (!estBranchePrincipaleValide(l.code) || l.libelle.trim() === "") {
      throw new Error(`Branche principale de démarrage invalide : ${l.code}`);
    }
    await obtenirPrisma().$transaction(async (tx) => {
      if (await tx.branchePrincipale.findUnique({ where: { code: l.code } })) return;
      await tx.branchePrincipale.create({ data: { code: l.code, libelle: l.libelle.trim() } });
      await journaliser({ acteur: null, action: "PARAMETRE_MODIFIE", objetType: "branche_principale", objetId: l.code, apres: { code: l.code, libelle: l.libelle.trim(), source: "données de démarrage" }, adresseIp: null }, tx);
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
  branchePrincipale: string | null;
  branchePrincipaleLibelle: string | null;
  branche: string;
  actif: boolean;
  versions: DateIso[];
};

export async function listerProduits(acteur: UtilisateurCourant, filtre?: { branchePrincipale?: string }): Promise<LigneProduit[]> {
  await exigerConsultation(acteur);
  const branchePrincipale = filtre?.branchePrincipale?.trim() || undefined;
  const produits = await obtenirPrisma().produit.findMany({
    where: branchePrincipale ? { branchePrincipale } : undefined,
    include: {
      branchePrincipaleRef: true,
      versions: { select: { dateEffet: true }, orderBy: { dateEffet: "desc" } },
    },
    orderBy: { code: "asc" },
  });
  return produits.map((p) => ({
    code: p.code,
    libelle: p.libelle,
    gamme: p.gamme,
    branchePrincipale: p.branchePrincipale,
    branchePrincipaleLibelle: p.branchePrincipaleRef?.libelle ?? libelleBranchePrincipale(p.branchePrincipale),
    branche: p.branche,
    actif: p.actif,
    versions: p.versions.map((v) => depuisDate(v.dateEffet)),
  }));
}

export async function creerProduit(
  acteur: UtilisateurCourant,
  saisie: { code: string; libelle: string; gamme: string; branche: string; branchePrincipale?: string | null },
  adresseIp: string | null,
): Promise<void> {
  await exigerEcriture(acteur);
  const problemes: string[] = [];
  if (!codeValide(saisie.code)) problemes.push("Code produit invalide (majuscules, chiffres et _, 30 caractères au plus).");
  if (!estBranchePrincipaleValide(saisie.branchePrincipale)) {
    problemes.push("La branche principale est obligatoire (choisissez-la parmi les 5 branches principales : MALADIE, ACCIDENTS_CORPORELS, RECOLTE, DECES, INCENDIE_DOMMAGES).");
  }
  if (!codeValide(saisie.branche)) problemes.push("Catégorie de taxe (branche fiscale) invalide (choisissez-la dans la liste des branches).");
  if (saisie.libelle.trim() === "" || saisie.gamme.trim() === "") problemes.push("Libellé et gamme obligatoires.");
  refuserSiProblemes(problemes);
  const branchePrincipale = saisie.branchePrincipale!;

  await obtenirPrisma().$transaction(async (tx) => {
    if (await tx.produit.findUnique({ where: { code: saisie.code } })) {
      throw new ErreurMetier("Ce code produit existe déjà.");
    }
    if (!(await tx.branchePrincipale.findUnique({ where: { code: branchePrincipale } }))) {
      throw new ErreurMetier(`La branche principale « ${branchePrincipale} » est introuvable.`);
    }
    await exigerBrancheActive(tx, saisie.branche);
    const cree = await tx.produit.create({
      data: {
        code: saisie.code,
        libelle: saisie.libelle.trim(),
        gamme: saisie.gamme.trim(),
        branchePrincipale,
        branche: saisie.branche,
        creePar: acteur.identifiant,
      },
    });
    await journaliser(
      { acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "PARAMETRE_MODIFIE", objetType: "produit", objetId: cree.id, apres: { ...saisie, branchePrincipale }, adresseIp },
      tx,
    );
  });
}

/** Renseigne ou modifie la branche principale d'un produit existant (produits de développement créés avant D37, journalisé). */
export async function modifierBranchePrincipaleProduit(
  acteur: UtilisateurCourant,
  codeProduit: string,
  branchePrincipale: string,
  adresseIp: string | null,
): Promise<void> {
  await exigerEcriture(acteur);
  if (!estBranchePrincipaleValide(branchePrincipale)) {
    throw new ErreurMetier("La branche principale est obligatoire (choisissez-la parmi les 5 branches principales : MALADIE, ACCIDENTS_CORPORELS, RECOLTE, DECES, INCENDIE_DOMMAGES).");
  }
  await obtenirPrisma().$transaction(async (tx) => {
    const avant = await tx.produit.findUnique({ where: { code: codeProduit } });
    if (!avant) throw new ErreurMetier("Produit introuvable.");
    if (!(await tx.branchePrincipale.findUnique({ where: { code: branchePrincipale } }))) {
      throw new ErreurMetier(`La branche principale « ${branchePrincipale} » est introuvable.`);
    }
    if (avant.branchePrincipale === branchePrincipale) return;
    await tx.produit.update({ where: { id: avant.id }, data: { branchePrincipale } });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "produit",
        objetId: avant.id,
        avant: { branchePrincipale: avant.branchePrincipale },
        apres: { branchePrincipale },
        adresseIp,
      },
      tx,
    );
  });
}

/** Une version lue en base porte toujours son mode de tarification (la colonne est obligatoire). */
export type VersionProduit = VersionSaisie & { id: number; modeTarification: ModeTarification };

/** Refus de la composition manuelle pour une version qui n'est pas en mode GARANTIES (session 6.2b). */
export function exigerComposition(mode: string): void {
  if (!compositionPossible(mode)) {
    throw new ErreurMetier(mode === "BAREME" ? MESSAGE_TARIFICATION_AU_BAREME : MESSAGE_COMPOSITION_IMPOSSIBLE);
  }
}

/**
 * Point de refus du calcul automatique d'un produit tarifé par garanties (session 6.2a). Appelé là où un montant naît du
 * tarif (résolution du contexte de calcul, construction de l'entrée du moteur) et là où un document ou une facture le reprend
 * (émission d'une cotation, montants d'un document). Le texte est celui fixé par la Technique ; il remplace, pour l'IARD, le
 * refus « taux mixte non pris en charge » (qui reste le filet d'un produit à la formule rattaché à une branche à taux mixte).
 */
export function exigerCalculAutomatique(mode: string): void {
  if (!calculAutomatiquePossible(mode)) {
    throw new ErreurMetier(mode === "BAREME" ? MESSAGE_TARIFICATION_AU_BAREME : MESSAGE_TARIFICATION_PAR_GARANTIES);
  }
}

export function versVersion(v: Prisma.ProduitVersionGetPayload<{ include: { formules: true } }>): VersionProduit {
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
    modeTarification: v.modeTarification as ModeTarification,
    garanties: (v.garanties as GarantieParametree[] | null) ?? [],
    garantiesSaisieLibre: v.garantiesSaisieLibre,
    references: { csModeleCode: v.csModeleCode, csVisa: v.csVisa },
    formules: v.formules
      .map(
        (f): FormuleSaisie => ({
          code: f.code,
          libelle: f.libelle,
          tauxCouverture: f.tauxCouverture ? texte(f.tauxCouverture) : null,
          primeUnitaire: texte(f.primeUnitaire),
          accessoireMode: f.accessoireMode as ModeAccessoire,
          accessoireValeur: texte(f.accessoireValeur),
          ageMin: f.ageMin,
          ageMax: f.ageMax,
        }),
      )
      .sort((a, b) => (a.code < b.code ? -1 : 1)),
  };
}

export async function listerVersions(acteur: UtilisateurCourant, codeProduit: string): Promise<{ produit: LigneProduit; versions: VersionProduit[] } | null> {
  await exigerConsultation(acteur);
  const produit = await obtenirPrisma().produit.findUnique({
    where: { code: codeProduit },
    include: {
      branchePrincipaleRef: true,
      versions: { include: { formules: true }, orderBy: { dateEffet: "desc" } },
    },
  });
  if (!produit) {
    return null;
  }
  return {
    produit: {
      code: produit.code,
      libelle: produit.libelle,
      gamme: produit.gamme,
      branchePrincipale: produit.branchePrincipale,
      branchePrincipaleLibelle: produit.branchePrincipaleRef?.libelle ?? libelleBranchePrincipale(produit.branchePrincipale),
      branche: produit.branche,
      actif: produit.actif,
      versions: produit.versions.map((v) => depuisDate(v.dateEffet)),
    },
    versions: produit.versions.map(versVersion),
  };
}

/** Ajoute une version (jamais de modification) : c'est ainsi que le paramétrage reste historisé. */
export async function creerVersion(acteur: UtilisateurCourant, codeProduit: string, saisie: VersionSaisie, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  refuserSiProblemes(problemesVersion(saisie));
  if (saisie.modeTarification === "BAREME") {
    throw new ErreurMetier("Une version ne se crée pas directement au barème : créez-la dans un autre mode à une date d'effet future, importez et publiez son barème, puis basculez-la au barème.");
  }

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
        modeTarification: saisie.modeTarification ?? "FORMULE",
        garanties: (saisie.garanties ?? []).map((g) => {
          const mg =
            g.montantGaranti !== undefined && g.montantGaranti !== null && g.montantGaranti.trim() !== ""
              ? canonique(g.montantGaranti)
              : g.montantGaranti === null
                ? null
                : undefined;
          const acc =
            g.accessoires !== undefined && g.accessoires !== null && g.accessoires.trim() !== ""
              ? canonique(g.accessoires)
              : g.accessoires === null
                ? null
                : undefined;
          return {
            libelle: g.libelle.trim(),
            branche: g.branche,
            ...(mg !== undefined ? { montantGaranti: mg } : {}),
            ...(acc !== undefined ? { accessoires: acc } : {}),
          };
        }) as unknown as Prisma.InputJsonValue,
        garantiesSaisieLibre: saisie.garantiesSaisieLibre ?? true,
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
            ageMin: f.ageMin ?? null,
            ageMax: f.ageMax ?? null,
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
        apres: { produit: codeProduit, dateEffet: saisie.dateEffet, modeTarification: saisie.modeTarification ?? "FORMULE", garanties: (saisie.garanties ?? []).length, formules: saisie.formules.map((f) => f.code) },
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
  /** Régime de taxe (Individuel ou Groupe) : il choisit le taux de taxe (session 6.0, H29 fermée). */
  regimeTaxe: RegimeTaxe | string;
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
 * Produit actif et version EN VIGUEUR à la date du document (étape commune au calcul automatique et à la composition). Ne regarde
 * pas le mode de tarification : c'est à l'appelant de décider ce qu'il accepte.
 */
export async function resoudreVersion(client: ClientLecture, codeProduit: string, dateDocument: DateIso): Promise<{ produit: { id: number; code: string; libelle: string; branche: string }; version: VersionProduit }> {
  if (!dateValide(dateDocument)) {
    throw new ErreurMetier(`Date invalide : « ${dateDocument} ».`);
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
  return { produit: { id: produit.id, code: produit.code, libelle: produit.libelle, branche: produit.branche }, version };
}

/**
 * Trouve les paramètres EN VIGUEUR : la version du produit à la date du document, la taxe de la
 * branche et du régime de taxe à la date d'effet de la police (CDC §8.1, D18 ; décision de Thierry du
 * 08/10/2026 : la date d'effet, pas la date du document ; régime de taxe : session 6.0, H29 fermée).
 * Voie du CALCUL AUTOMATIQUE : refuse un produit en mode GARANTIES (sessions 6.2a et 6.2b : sa prime se compose).
 */
export async function resoudreContexte(
  client: ClientLecture,
  codeProduit: string,
  dateDocument: DateIso,
  dateEffet: DateIso,
  regime: RegimeTaxe,
): Promise<ContexteCalcul> {
  if (!dateValide(dateEffet)) {
    throw new ErreurMetier(`Date invalide : « ${dateEffet} ».`);
  }
  const { produit, version } = await resoudreVersion(client, codeProduit, dateDocument);
  // Avant la taxe : un produit tarifé par garanties est refusé pour cette raison, pas pour un taux mixte (session 6.2a).
  exigerCalculAutomatique(version.modeTarification);
  const taxe = await taxeEnVigueur(client, produit.branche, regime, dateEffet);
  return { produit: { id: produit.id, code: produit.code, libelle: produit.libelle }, version, taxe };
}

export const MESSAGE_NON_COMPOSEE = "La prime n'est pas encore composée : la Technique doit la composer (action « Composer une prime ») avant la soumission";

/**
 * Cohérence entre le mode de tarification d'une version et la nature du calcul figé qu'on lui rattache (session 6.2b) : un calcul
 * automatique ne se rattache qu'à une version à la formule, une composition qu'à une version par garanties ET non vide (jamais de 0 silencieux).
 */
export function exigerModeCoherent(mode: string, donnees: DonneesCalcul): void {
  if (estComposition(donnees)) {
    exigerComposition(mode);
    if (donnees.lignes.length === 0) throw new ErreurMetier(MESSAGE_NON_COMPOSEE);
  } else {
    exigerCalculAutomatique(mode);
  }
}

/** Idem pour la version EN VIGUEUR à `date` (un document préparé avant une bascule de mode ne s'émet plus : sessions 6.2a et 6.2b). */
export async function exigerModeCoherentEnVigueur(client: Pick<Prisma.TransactionClient, "produitVersion">, produitId: number, date: DateIso, donnees: DonneesCalcul): Promise<void> {
  const versions = await client.produitVersion.findMany({ where: { produitId }, select: { dateEffet: true, modeTarification: true } });
  const enCours = enVigueur(versions.map((v) => ({ dateEffet: depuisDate(v.dateEffet), modeTarification: v.modeTarification })), date);
  if (!enCours) return;
  if (estComposition(donnees)) exigerComposition(enCours.modeTarification);
  else exigerCalculAutomatique(enCours.modeTarification);
}

/** Paramètres d'une composition manuelle (session 6.2b) : le produit et sa version en vigueur, qui doit être en mode GARANTIES. Pas de taxe ici : chaque ligne a la sienne. */
export type ContexteComposition = { produit: { id: number; code: string; libelle: string }; version: VersionProduit };

export async function resoudreContexteComposition(client: ClientLecture, codeProduit: string, dateDocument: DateIso): Promise<ContexteComposition> {
  const { produit, version } = await resoudreVersion(client, codeProduit, dateDocument);
  exigerComposition(version.modeTarification);
  return { produit: { id: produit.id, code: produit.code, libelle: produit.libelle }, version };
}

/**
 * Résout et FIGE le taux de taxe de chaque ligne de prime : branche de la ligne, régime de taxe de la cotation, date d'effet de la
 * police, avec la MÊME résolution que le calcul automatique (`taxeEnVigueur`, H29). La branche doit exister et être active (D21).
 */
export async function figerLesTaux(client: Pick<Prisma.TransactionClient, "taxe" | "produit" | "branche">, lignes: LigneDePrime[], regime: RegimeTaxe, dateEffet: DateIso): Promise<LigneComposee[]> {
  if (!dateValide(dateEffet)) {
    throw new ErreurMetier(`Date invalide : « ${dateEffet} ».`);
  }
  const taux = new Map<string, TaxeSaisie & { tauxPourcent: string }>();
  for (const code of new Set(lignes.map((l) => l.branche))) {
    const branche = await client.branche.findUnique({ where: { code } });
    if (!branche) throw new ErreurMetier(`La branche « ${code} » n'est pas dans la liste des branches.`);
    if (!branche.actif) throw new ErreurMetier(`La branche « ${code} » est désactivée : elle ne peut plus recevoir de ligne de prime.`);
    taux.set(code, await taxeEnVigueur(client, code, regime, dateEffet));
  }
  return lignes.map((l) => {
    const t = taux.get(l.branche)!;
    const mg =
      l.montantGaranti !== undefined && l.montantGaranti !== null && l.montantGaranti.trim() !== ""
        ? canonique(l.montantGaranti)
        : l.montantGaranti === null
          ? null
          : undefined;
    return {
      libelle: l.libelle.trim(),
      branche: l.branche,
      ...(mg !== undefined ? { montantGaranti: mg } : {}),
      primeNette: canonique(l.primeNette),
      accessoires: canonique(l.accessoires),
      tauxPourcent: canonique(t.tauxPourcent),
      assiette: t.assiette,
    };
  });
}

/** Entrée figée d'une composition : les lignes aux taux résolus, la règle d'arrondi de la version, les dates de la police. */
export function construireComposition(contexte: ContexteComposition, demande: { dateEffet: DateIso; dateEcheance: DateIso; lignes: LigneComposee[]; nombreTranches: number }): EntreeComposition {
  exigerComposition(contexte.version.modeTarification); // ceinture, comme pour construireEntree
  if (demande.nombreTranches > 1 && !montant(contexte.version.fractionnement.frais).isZero()) {
    throw new ErreurMetier("Les frais de fractionnement de cette version ne s'ajoutent pas en mode par garanties : demandez à la Technique une version sans frais (ils se saisissent comme une ligne de prime).");
  }
  if (!Number.isInteger(demande.nombreTranches) || demande.nombreTranches < 1 || demande.nombreTranches > contexte.version.fractionnement.tranchesMax) {
    throw new ErreurMetier(`Ce produit autorise de 1 à ${contexte.version.fractionnement.tranchesMax} tranche(s).`);
  }
  return { type: "COMPOSITION", version: VERSION_COMPOSITION, dateEffet: demande.dateEffet, dateEcheance: demande.dateEcheance, arrondi: contexte.version.arrondi, lignes: demande.lignes };
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
  exigerCalculAutomatique(version.modeTarification); // ceinture : un contexte construit hors de resoudreContexte ne contourne pas le refus
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
  entree: DonneesCalcul,
  fractionnement: { repartitionPourcent: string[] | null; decalagesMois: number[] | null },
  nombreTranches: number,
): { resultat: ResultatCalcul; echeancier: Tranche[] | null } {
  try {
    const resultat = estComposition(entree) ? composer(entree) : calculer(entree);
    const arrondiEcheancier = estComposition(entree) ? entree.arrondi : entree.parametres.arrondi;
    const { repartitionPourcent, decalagesMois } = fractionnement;
    const echeancier =
      nombreTranches > 1
        ? genererEcheancier({
            ttc: resultat.totaux.arrondi.ttc,
            nombreTranches,
            dateEffet: entree.dateEffet,
            repartitionPourcent: repartitionPourcent?.length === nombreTranches ? repartitionPourcent : undefined,
            decalagesMois: decalagesMois?.length === nombreTranches ? decalagesMois : undefined,
            arrondi: { precision: arrondiEcheancier.precision, sens: arrondiEcheancier.sens },
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
  if (!estRegimeTaxe(demande.regimeTaxe)) {
    throw new ErreurMetier("Choisissez le régime de taxe (individuel ou groupe).");
  }
  const contexte = await resoudreContexte(obtenirPrisma(), demande.codeProduit, dateDocument, demande.dateEffet, demande.regimeTaxe);
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
    doubleValidationRequise: exigeDoubleValidation(resultat.totaux.arrondi.ttc, await lireSeuilValidationGlobal(demande.dateEffet)),
  };
}
