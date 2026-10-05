import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { calculer, type EntreeCalcul, type ResultatCalcul } from "@/domaine/calcul/calcul";
import type { DateIso } from "@/domaine/calcul/dates";
import type { Tranche } from "@/domaine/calcul/echeancier";
import { montant } from "@/domaine/calcul/montant";
import {
  problemesAssures,
  problemesLignes,
  problemesRisque,
  problemesSouscripteur,
  type Assure,
  type Risque,
  type Souscripteur,
} from "@/domaine/cotation/saisie";
import {
  dateFinValidite,
  estStatut,
  filigraneDe,
  peutAccepter,
  peutEtreRenvoyee,
  peutEtreValidee,
  peutModifier,
  peutRefuser,
  statutEffectif,
  type StatutCotation,
} from "@/domaine/cotation/statuts";
import {
  detecterForcages,
  problemesForcage,
  raisonsDeValidation,
  valideurAutorise,
  type RaisonValidation,
} from "@/domaine/cotation/validation";
import { peutAgir, peutLire, peutValider } from "@/domaine/droits";

import { journaliser, type ActeurAudit } from "./audit";
import { versSouscripteur } from "./clients";
import { niveauDuProfil } from "./droits";
import { allouerNumero, allouerNumeroPolice } from "./numerotation";
import {
  aujourdhui,
  construireEntree,
  executerCalcul,
  resoudreContexte,
  type LigneDemande,
  type VersionProduit,
} from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------- Types

export type SaisieCotation = {
  codeProduit: string;
  clientId: number | null;
  souscripteur: Souscripteur;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  nombreTranches: number;
  lignes: LigneDemande[];
  motifForcage: string | null;
  assures: Assure[];
  risque: Risque;
};

/** Ligne stockée : le tarif ET la prime retenue, pour que le forçage reste visible. */
type LigneStockee = { code: string; effectif: number; primeTarif: string; primeForcee: string | null };

/** Montants arrondis, en texte, stockés avec la cotation (consultation et listes sans recalcul). */
type ResultatStocke = {
  joursCouverts: number;
  lignes: { code: string; effectif: number; nette: string; accessoires: string; taxe: string; ttc: string; ttcParUnite: string }[];
  fraisFractionnement: { accessoires: string; taxe: string; ttc: string } | null;
  totaux: { nette: string; accessoires: string; taxe: string; ttc: string };
};

function serialiser(r: ResultatCalcul): ResultatStocke {
  const t = (m: { toFixed(): string }) => m.toFixed();
  return {
    joursCouverts: r.joursCouverts,
    lignes: r.lignes.map((l) => ({
      code: l.code,
      effectif: l.effectif,
      nette: t(l.arrondi.nette),
      accessoires: t(l.arrondi.accessoires),
      taxe: t(l.arrondi.taxe),
      ttc: t(l.arrondi.ttc),
      ttcParUnite: t(l.ttcParUnite),
    })),
    fraisFractionnement: r.fraisFractionnement
      ? { accessoires: t(r.fraisFractionnement.arrondi.accessoires), taxe: t(r.fraisFractionnement.arrondi.taxe), ttc: t(r.fraisFractionnement.arrondi.ttc) }
      : null,
    totaux: { nette: t(r.totaux.arrondi.nette), accessoires: t(r.totaux.arrondi.accessoires), taxe: t(r.totaux.arrondi.taxe), ttc: t(r.totaux.arrondi.ttc) },
  };
}

const tranchesVersJson = (t: Tranche[] | null) => (t ? t.map((x) => ({ numero: x.numero, date: x.date, montant: x.montant.toFixed() })) : null);
const jsonVersTranches = (j: unknown): Tranche[] | null =>
  Array.isArray(j) ? (j as { numero: number; date: string; montant: string }[]).map((x) => ({ numero: x.numero, date: x.date, montant: montant(x.montant) })) : null;

// ---------------------------------------------------------------- Droits

async function exigerAgir(acteur: UtilisateurCourant): Promise<void> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, "CREER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : création de cotation.");
  }
}

async function exigerLecture(acteur: UtilisateurCourant): Promise<void> {
  if (!peutLire(await niveauDuProfil(acteur.profil, "CREER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : consultation des cotations.");
  }
}

// ---------------------------------------------------------------- Calcul d'une saisie

type Calcul = {
  versionDateEffet: DateIso;
  validiteMois: number;
  seuil: string | null;
  fractionnement: VersionProduit["fractionnement"];
  produitId: number;
  entree: EntreeCalcul;
  resultat: ResultatCalcul;
  echeancier: Tranche[] | null;
  lignesStockees: LigneStockee[];
  raisons: RaisonValidation[];
  souscripteur: Souscripteur;
  forcages: ReturnType<typeof detecterForcages>;
};

/**
 * Valide la saisie puis calcule avec les paramètres en vigueur à `dateDocument` : tout montant vient
 * du moteur, jamais de la saisie. Un forçage exige le droit « Demande » ou « Valide » ET un motif.
 */
async function calculerSaisie(tx: Tx, acteur: UtilisateurCourant, saisie: SaisieCotation, dateDocument: DateIso): Promise<Calcul> {
  const contexte = await resoudreContexte(tx, saisie.codeProduit, dateDocument, saisie.dateEffet);
  const { version } = contexte;

  let souscripteur = saisie.souscripteur;
  if (saisie.clientId !== null) {
    const client = await tx.client.findUnique({ where: { id: saisie.clientId } });
    if (!client) throw new ErreurMetier("Client introuvable.");
    souscripteur = versSouscripteur(client);
  }

  const problemes = [
    ...problemesSouscripteur(souscripteur),
    ...problemesLignes(saisie.lignes, version.cotation.formulesMax),
    ...problemesAssures(saisie.assures, version.formules.map((f) => f.code), dateDocument),
    ...problemesRisque(saisie.risque),
  ];
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

  const { entree, primesTarif } = construireEntree(contexte, {
    dateEffet: saisie.dateEffet,
    dateEcheance: saisie.dateEcheance,
    lignes: saisie.lignes,
    nombreTranches: saisie.nombreTranches,
  });
  const forcages = detecterForcages(saisie.lignes.map((l) => ({ code: l.codeFormule, primeTarif: primesTarif[l.codeFormule], primeForcee: l.primeForcee ?? null })));
  const problemesDeForcage = problemesForcage(forcages, saisie.motifForcage);
  if (problemesDeForcage.length > 0) throw new ErreurMetier(problemesDeForcage.join(" "));
  if (forcages.length > 0 && !peutLire(await niveauDuProfil(acteur.profil, "FORCER_PRIME"))) {
    throw new ErreurAcces("Droit insuffisant : forçage de prime.");
  }

  const { resultat, echeancier } = executerCalcul(entree, version.fractionnement, saisie.nombreTranches);
  return {
    versionDateEffet: version.dateEffet,
    validiteMois: version.cotation.validiteMois,
    seuil: version.seuilValidationTtc,
    fractionnement: version.fractionnement,
    produitId: contexte.produit.id,
    entree,
    resultat,
    echeancier,
    lignesStockees: saisie.lignes.map((l) => ({
      code: l.codeFormule,
      effectif: l.effectif,
      primeTarif: primesTarif[l.codeFormule],
      primeForcee: forcages.some((f) => f.code === l.codeFormule) ? (l.primeForcee ?? null) : null,
    })),
    raisons: raisonsDeValidation({ forcages, ttc: resultat.totaux.arrondi.ttc, seuil: version.seuilValidationTtc }),
    souscripteur,
    forcages,
  };
}

function donneesAEcrire(saisie: SaisieCotation, c: Calcul) {
  return {
    produitId: c.produitId,
    versionDateEffet: versDate(c.versionDateEffet),
    clientId: saisie.clientId,
    souscripteur: c.souscripteur as unknown as Prisma.InputJsonValue,
    dateEffet: versDate(saisie.dateEffet),
    dateEcheance: versDate(saisie.dateEcheance),
    nombreTranches: saisie.nombreTranches,
    lignes: c.lignesStockees as unknown as Prisma.InputJsonValue,
    motifForcage: c.forcages.length > 0 ? (saisie.motifForcage ?? "").trim() : null,
    assures: saisie.assures as unknown as Prisma.InputJsonValue,
    risque: saisie.risque as unknown as Prisma.InputJsonValue,
    donneesCalcul: c.entree as unknown as Prisma.InputJsonValue,
    resultat: serialiser(c.resultat) as unknown as Prisma.InputJsonValue,
    ttcTotal: c.resultat.totaux.arrondi.ttc.toFixed(),
    echeancier: (tranchesVersJson(c.echeancier) ?? undefined) as Prisma.InputJsonValue | undefined,
    raisonsValidation: c.raisons as unknown as Prisma.InputJsonValue,
  };
}

// ---------------------------------------------------------------- Brouillon

export async function creerBrouillon(acteur: UtilisateurCourant, saisie: SaisieCotation, adresseIp: string | null): Promise<number> {
  await exigerAgir(acteur);
  return obtenirPrisma().$transaction(async (tx) => {
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    const cree = await tx.cotation.create({
      data: { ...donneesAEcrire(saisie, c), statut: "BROUILLON", auteurId: acteur.id, auteurIdentifiant: acteur.identifiant },
    });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_CREEE", objetType: "cotation", objetId: cree.id, apres: { produit: saisie.codeProduit, ttc: c.resultat.totaux.arrondi.ttc.toFixed() }, adresseIp }, tx);
    return cree.id;
  });
}

async function chargerPourModification(tx: Tx, acteur: UtilisateurCourant, id: number) {
  const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
  if (!cotation) throw new ErreurMetier("Cotation introuvable.");
  if (cotation.auteurId !== acteur.id) {
    throw new ErreurMetier("Seul l'auteur d'un brouillon peut le modifier ou le soumettre.");
  }
  if (!peutModifier(cotation.statut as StatutCotation)) {
    throw new ErreurMetier("Cette cotation n'est plus un brouillon : elle est figée.");
  }
  return cotation;
}

export async function modifierBrouillon(acteur: UtilisateurCourant, id: number, saisie: SaisieCotation, adresseIp: string | null): Promise<void> {
  await exigerAgir(acteur);
  await obtenirPrisma().$transaction(async (tx) => {
    const avant = await chargerPourModification(tx, acteur, id);
    if (avant.produit.code !== saisie.codeProduit) throw new ErreurMetier("Le produit d'une cotation ne se change pas : créez une nouvelle cotation.");
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    await tx.cotation.update({ where: { id }, data: donneesAEcrire(saisie, c) });
    await journaliser(
      { acteur: auteur(acteur), action: "COTATION_MODIFIEE", objetType: "cotation", objetId: id, avant: { ttc: avant.ttcTotal?.toFixed() ?? null }, apres: { ttc: c.resultat.totaux.arrondi.ttc.toFixed() }, adresseIp },
      tx,
    );
  });
}

// ---------------------------------------------------------------- Émission

type CotationChargee = Prisma.CotationGetPayload<{ include: { produit: true } }>;

/** Attribue le numéro et fige la cotation. Appelée dans la transaction de la soumission ou de la validation. */
async function emettre(tx: Tx, acteur: UtilisateurCourant, cotation: CotationChargee, adresseIp: string | null, valideur: UtilisateurCourant | null): Promise<string> {
  const aujourdhuiIso = aujourdhui();
  const version = await tx.produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId: cotation.produitId, dateEffet: cotation.versionDateEffet } },
  });
  const numero = await allouerNumero(tx, "COT", aujourdhuiIso);
  await tx.cotation.update({
    where: { id: cotation.id },
    data: {
      statut: "EMISE",
      numero,
      dateEtablissement: versDate(aujourdhuiIso),
      dateValidite: versDate(dateFinValidite(aujourdhuiIso, version.validiteMois)),
      emiseLe: new Date(),
      ...(valideur ? { valideParId: valideur.id, valideLe: new Date() } : {}),
    },
  });
  await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_EMIS", objetType: "cotation", objetId: cotation.id, apres: { numero, validiteJusquau: dateFinValidite(aujourdhuiIso, version.validiteMois) }, adresseIp }, tx);
  return numero;
}

/**
 * Soumet un brouillon : il est recalculé avec les paramètres du jour, puis passe « À valider » si une prime
 * est forcée ou si le TTC dépasse le seuil du produit, sinon il est émis tout de suite (CDC §9.1, §4.1).
 */
export async function soumettre(acteur: UtilisateurCourant, id: number, adresseIp: string | null): Promise<{ statut: "A_VALIDER" | "EMISE"; numero: string | null }> {
  await exigerAgir(acteur);
  return obtenirPrisma().$transaction(async (tx) => {
    const cotation = await chargerPourModification(tx, acteur, id);
    // Recalcul avec les paramètres du jour, à partir de ce qui est enregistré.
    const lignes = cotation.lignes as unknown as LigneStockee[];
    const saisie: SaisieCotation = {
      codeProduit: cotation.produit.code,
      clientId: cotation.clientId,
      souscripteur: cotation.souscripteur as unknown as Souscripteur,
      dateEffet: depuisDate(cotation.dateEffet),
      dateEcheance: depuisDate(cotation.dateEcheance),
      nombreTranches: cotation.nombreTranches,
      lignes: lignes.map((l) => ({ codeFormule: l.code, effectif: l.effectif, primeForcee: l.primeForcee })),
      motifForcage: cotation.motifForcage,
      assures: cotation.assures as unknown as Assure[],
      risque: cotation.risque as unknown as Risque,
    };
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    await tx.cotation.update({ where: { id }, data: donneesAEcrire(saisie, c) });

    if (c.raisons.length > 0) {
      await tx.cotation.update({ where: { id }, data: { statut: "A_VALIDER" } });
      await journaliser({ acteur: auteur(acteur), action: "COTATION_SOUMISE", objetType: "cotation", objetId: id, apres: { raisons: c.raisons, ttc: c.resultat.totaux.arrondi.ttc.toFixed() }, adresseIp }, tx);
      if (c.forcages.length > 0) {
        await journaliser(
          {
            acteur: auteur(acteur),
            action: "PRIME_FORCEE",
            objetType: "cotation",
            objetId: id,
            avant: Object.fromEntries(c.forcages.map((f) => [f.code, f.primeTarif.toFixed()])),
            apres: { ...Object.fromEntries(c.forcages.map((f) => [f.code, f.primeForcee.toFixed()])), motif: saisie.motifForcage },
            adresseIp,
          },
          tx,
        );
      }
      return { statut: "A_VALIDER" as const, numero: null };
    }
    // Recharger : le recalcul a pu changer la version du produit (donc la durée de validité).
    const recalculee = await tx.cotation.findUniqueOrThrow({ where: { id }, include: { produit: true } });
    const numero = await emettre(tx, acteur, recalculee, adresseIp, null);
    return { statut: "EMISE" as const, numero };
  });
}

/**
 * Valide une cotation « À valider » (Technique ou Direction Générale) et l'émet. Le valideur ne peut
 * JAMAIS être l'auteur (CDC §4.1, T13).
 */
export async function valider(acteur: UtilisateurCourant, id: number, adresseIp: string | null): Promise<string> {
  if (!peutValider(await niveauDuProfil(acteur.profil, "FORCER_PRIME"))) {
    throw new ErreurAcces("Droit insuffisant : validation de cotation.");
  }
  return obtenirPrisma().$transaction(async (tx) => {
    const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
    if (!cotation) throw new ErreurMetier("Cotation introuvable.");
    if (!peutEtreValidee(cotation.statut as StatutCotation)) throw new ErreurMetier("Cette cotation n'est pas à valider.");
    if (!valideurAutorise(cotation.auteurId, acteur.id)) {
      throw new ErreurMetier("Vous ne pouvez pas valider votre propre cotation : un autre valideur doit la valider (séparation des tâches).");
    }
    await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_VALIDE", objetType: "cotation", objetId: id, apres: { raisons: cotation.raisonsValidation as unknown as string[] }, adresseIp }, tx);
    return emettre(tx, acteur, cotation, adresseIp, acteur);
  });
}

/** Renvoie une cotation « À valider » en brouillon (par son auteur, ou par un valideur qui la refuse). */
export async function renvoyerEnBrouillon(acteur: UtilisateurCourant, id: number, commentaire: string, adresseIp: string | null): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    const cotation = await tx.cotation.findUnique({ where: { id } });
    if (!cotation) throw new ErreurMetier("Cotation introuvable.");
    if (!peutEtreRenvoyee(cotation.statut as StatutCotation)) throw new ErreurMetier("Cette cotation n'est pas à valider.");
    const estAuteur = cotation.auteurId === acteur.id;
    if (!estAuteur && !peutValider(await niveauDuProfil(acteur.profil, "FORCER_PRIME"))) {
      throw new ErreurAcces("Droit insuffisant : seul l'auteur ou un valideur peut renvoyer cette cotation en brouillon.");
    }
    if (!estAuteur && commentaire.trim().length < 3) throw new ErreurMetier("Indiquez la raison du renvoi.");
    await tx.cotation.update({ where: { id }, data: { statut: "BROUILLON" } });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_RENVOYEE", objetType: "cotation", objetId: id, apres: { commentaire: commentaire.trim() }, adresseIp }, tx);
  });
}

// ---------------------------------------------------------------- Expiration, acceptation, refus

/**
 * Passe en « Expirée » les cotations émises dont la validité est dépassée (CDC §9.3). Le statut réel est de
 * toute façon calculé à la volée (statutEffectif) : cette mise à jour garde la base à jour.
 */
export async function expirerCotations(aujourdhuiIso: DateIso = aujourdhui()): Promise<number> {
  return obtenirPrisma().$transaction(async (tx) => {
    const aExpirer = await tx.cotation.findMany({
      where: { statut: "EMISE", dateValidite: { lt: versDate(aujourdhuiIso) } },
      select: { id: true, numero: true },
    });
    for (const c of aExpirer) {
      await tx.cotation.update({ where: { id: c.id }, data: { statut: "EXPIREE" } });
      await journaliser({ acteur: null, action: "COTATION_EXPIREE", objetType: "cotation", objetId: c.id, apres: { numero: c.numero }, adresseIp: null }, tx);
    }
    return aExpirer.length;
  });
}

async function chargerEmise(tx: Tx, id: number) {
  const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
  if (!cotation) throw new ErreurMetier("Cotation introuvable.");
  const statut = statutEffectif(cotation.statut as StatutCotation, cotation.dateValidite ? depuisDate(cotation.dateValidite) : null, aujourdhui());
  return { cotation, statut };
}

/**
 * Le client accepte : il retient une ou plusieurs formules ; le module crée la police avec la formule retenue,
 * les assurés et l'échéancier (CDC §9.4). Impossible si la cotation est expirée (T11).
 */
export async function accepter(acteur: UtilisateurCourant, id: number, codesRetenus: string[], adresseIp: string | null): Promise<{ numeroPolice: string }> {
  await exigerAgir(acteur);
  await expirerCotations();
  return obtenirPrisma().$transaction(async (tx) => {
    const { cotation, statut } = await chargerEmise(tx, id);
    if (statut === "EXPIREE") throw new ErreurMetier("Cette cotation est expirée : elle ne peut plus être acceptée ni transformée en police.");
    if (!peutAccepter(statut)) throw new ErreurMetier("Seule une cotation émise peut être acceptée.");

    const entree = cotation.donneesCalcul as unknown as EntreeCalcul;
    const retenues = entree.lignes.filter((l) => codesRetenus.includes(l.code));
    if (retenues.length === 0 || retenues.length !== new Set(codesRetenus).size) {
      throw new ErreurMetier("Choisissez au moins une formule parmi celles de la cotation.");
    }

    // Recalcul sur les seules formules retenues, avec les paramètres FIGÉS de la cotation.
    const version = await tx.produitVersion.findUniqueOrThrow({ where: { produitId_dateEffet: { produitId: cotation.produitId, dateEffet: cotation.versionDateEffet } } });
    const entreeRetenue: EntreeCalcul = { ...entree, lignes: retenues };
    const { resultat, echeancier } = executerCalcul(
      entreeRetenue,
      { repartitionPourcent: (version.fractionnementRepartition as string[] | null) ?? null, decalagesMois: (version.fractionnementDecalagesMois as number[] | null) ?? null },
      cotation.nombreTranches,
    );

    const numeroPolice = await allouerNumeroPolice(tx, aujourdhui());
    await tx.police.create({
      data: {
        numero: numeroPolice,
        cotationId: cotation.id,
        produitCode: cotation.produit.code,
        souscripteur: cotation.souscripteur as Prisma.InputJsonValue,
        assures: cotation.assures as Prisma.InputJsonValue,
        risque: cotation.risque as Prisma.InputJsonValue,
        formulesRetenues: codesRetenus as unknown as Prisma.InputJsonValue,
        donneesCalcul: entreeRetenue as unknown as Prisma.InputJsonValue,
        resultat: serialiser(resultat) as unknown as Prisma.InputJsonValue,
        ttcTotal: resultat.totaux.arrondi.ttc.toFixed(),
        echeancier: (tranchesVersJson(echeancier) ?? []) as unknown as Prisma.InputJsonValue,
        dateEffet: cotation.dateEffet,
        dateEcheance: cotation.dateEcheance,
        creePar: acteur.identifiant,
      },
    });
    await tx.cotation.update({ where: { id }, data: { statut: "ACCEPTEE", formulesRetenues: codesRetenus as unknown as Prisma.InputJsonValue, accepteeLe: new Date() } });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_ACCEPTEE", objetType: "cotation", objetId: id, apres: { formules: codesRetenus, numeroPolice }, adresseIp }, tx);
    await journaliser({ acteur: auteur(acteur), action: "POLICE_CREEE", objetType: "police", objetId: numeroPolice, apres: { cotation: cotation.numero, ttc: resultat.totaux.arrondi.ttc.toFixed() }, adresseIp }, tx);
    return { numeroPolice };
  });
}

/** Refus du client : le motif est obligatoire et vient de la liste paramétrable (CDC §9.3). */
export async function refuser(acteur: UtilisateurCourant, id: number, motifCode: string, commentaire: string, adresseIp: string | null): Promise<void> {
  await exigerAgir(acteur);
  await expirerCotations();
  await obtenirPrisma().$transaction(async (tx) => {
    const { cotation, statut } = await chargerEmise(tx, id);
    if (!peutRefuser(statut)) throw new ErreurMetier("Seule une cotation émise et encore valide peut être refusée.");
    const motif = await tx.motifRefus.findUnique({ where: { code: motifCode } });
    if (!motif || !motif.actif) throw new ErreurMetier("Le motif de refus est obligatoire : choisissez-en un dans la liste.");
    await tx.cotation.update({ where: { id }, data: { statut: "REFUSEE", motifRefusCode: motif.code, refusCommentaire: commentaire.trim() || null } });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_REFUSEE", objetType: "cotation", objetId: cotation.id, apres: { motif: motif.code, commentaire: commentaire.trim() || null }, adresseIp }, tx);
  });
}

// ---------------------------------------------------------------- Lecture

export type LigneCotation = {
  id: number;
  numero: string | null;
  statut: StatutCotation;
  produit: string;
  souscripteur: string;
  ttc: string | null;
  auteur: string;
  dateValidite: DateIso | null;
  creeLe: Date;
};

const nomSouscripteur = (s: Souscripteur) => (s.type === "MORALE" ? s.raison_sociale : `${s.nom} ${s.prenoms}`.trim());

export async function listerCotations(acteur: UtilisateurCourant, filtre: { statut?: string } = {}): Promise<LigneCotation[]> {
  await exigerLecture(acteur);
  await expirerCotations();
  const lignes = await obtenirPrisma().cotation.findMany({
    where: filtre.statut && estStatut(filtre.statut) ? { statut: filtre.statut } : {},
    include: { produit: { select: { code: true } } },
    orderBy: { id: "desc" },
    take: 200,
  });
  return lignes.map((c) => ({
    id: c.id,
    numero: c.numero,
    statut: c.statut as StatutCotation,
    produit: c.produit.code,
    souscripteur: nomSouscripteur(c.souscripteur as unknown as Souscripteur),
    ttc: c.ttcTotal?.toFixed(0) ?? null,
    auteur: c.auteurIdentifiant,
    dateValidite: c.dateValidite ? depuisDate(c.dateValidite) : null,
    creeLe: c.creeLe,
  }));
}

export type DetailCotation = {
  id: number;
  numero: string | null;
  statut: StatutCotation;
  /** Statut tenant compte de l'expiration à la date du jour. */
  statutEffectif: StatutCotation;
  filigrane: string | null;
  produit: { code: string; libelle: string };
  versionDateEffet: DateIso;
  souscripteur: Souscripteur;
  clientId: number | null;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  dateEtablissement: DateIso | null;
  dateValidite: DateIso | null;
  nombreTranches: number;
  lignes: LigneStockee[];
  libelles: Record<string, string>;
  motifForcage: string | null;
  assures: Assure[];
  risque: Risque;
  raisonsValidation: RaisonValidation[];
  /** Recalculé à partir des paramètres figés : identique à ce qui a été émis. */
  resultat: ResultatCalcul;
  echeancier: Tranche[] | null;
  auteurId: number;
  auteurIdentifiant: string;
  formulesRetenues: string[] | null;
  motifRefusCode: string | null;
  refusCommentaire: string | null;
  numeroPolice: string | null;
};

export async function lireCotation(acteur: UtilisateurCourant, id: number): Promise<DetailCotation | null> {
  await exigerLecture(acteur);
  await expirerCotations();
  const c = await obtenirPrisma().cotation.findUnique({
    where: { id },
    include: { produit: true, police: { select: { numero: true } } },
  });
  if (!c) return null;
  const version = await obtenirPrisma().produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId: c.produitId, dateEffet: c.versionDateEffet } },
    include: { formules: true },
  });
  const statut = c.statut as StatutCotation;
  const dateValidite = c.dateValidite ? depuisDate(c.dateValidite) : null;
  const effectif = statutEffectif(statut, dateValidite, aujourdhui());
  return {
    id: c.id,
    numero: c.numero,
    statut,
    statutEffectif: effectif,
    filigrane: filigraneDe(effectif),
    produit: { code: c.produit.code, libelle: c.produit.libelle },
    versionDateEffet: depuisDate(c.versionDateEffet),
    souscripteur: c.souscripteur as unknown as Souscripteur,
    clientId: c.clientId,
    dateEffet: depuisDate(c.dateEffet),
    dateEcheance: depuisDate(c.dateEcheance),
    dateEtablissement: c.dateEtablissement ? depuisDate(c.dateEtablissement) : null,
    dateValidite,
    nombreTranches: c.nombreTranches,
    lignes: c.lignes as unknown as LigneStockee[],
    libelles: Object.fromEntries(version.formules.map((f) => [f.code, f.libelle])),
    motifForcage: c.motifForcage,
    assures: c.assures as unknown as Assure[],
    risque: c.risque as unknown as Risque,
    raisonsValidation: c.raisonsValidation as unknown as RaisonValidation[],
    resultat: calculer(c.donneesCalcul as unknown as EntreeCalcul),
    echeancier: jsonVersTranches(c.echeancier),
    auteurId: c.auteurId,
    auteurIdentifiant: c.auteurIdentifiant,
    formulesRetenues: (c.formulesRetenues as unknown as string[] | null) ?? null,
    motifRefusCode: c.motifRefusCode,
    refusCommentaire: c.refusCommentaire,
    numeroPolice: c.police?.numero ?? null,
  };
}
