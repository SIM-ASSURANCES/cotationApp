import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { calculer, type EntreeCalcul, type ResultatCalcul } from "@/domaine/calcul/calcul";
import type { DateIso } from "@/domaine/calcul/dates";
import type { Tranche } from "@/domaine/calcul/echeancier";
import { montant } from "@/domaine/calcul/montant";
import { estContratDeGroupe } from "@/domaine/cotation/adherents";
import {
  problemesAssures,
  problemesBeneficiaires,
  problemesContactsUrgence,
  problemesLignes,
  problemesRisque,
  problemesSouscripteur,
  type Assure,
  type Beneficiaire,
  type ContactUrgence,
  type Risque,
  type Souscripteur,
  type SouscripteurComplements,
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
import { normaliserNumeroPolice, problemesNumeroPolice } from "@/domaine/cotation/police";
import { estTypeContrat, type TypeContrat } from "@/domaine/calcul/taxes";
import { peutAgir, peutLire, peutValider } from "@/domaine/droits";

import { journaliser, type ActeurAudit } from "./audit";
import { versSouscripteur } from "./clients";
import { niveauDuProfil } from "./droits";
import { allouerNumero } from "./numerotation";
import {
  aujourdhui,
  construireEntree,
  executerCalcul,
  resoudreContexte,
  type LigneDemande,
  type VersionProduit,
} from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { lireFormatNumeroPolice } from "./societe";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------- Types

export type SaisieCotation = {
  codeProduit: string;
  clientId: number | null;
  /** police.type_contrat : choisit le taux de taxe (D18). Texte lu dans le formulaire, contrôlé ici. */
  typeContrat: TypeContrat | string;
  souscripteur: Souscripteur;
  dateEffet: DateIso;
  dateEcheance: DateIso;
  nombreTranches: number;
  lignes: LigneDemande[];
  motifForcage: string | null;
  assures: Assure[];
  /**
   * Bénéficiaires et contacts d'urgence (session 4a). `null` : jamais fournis (brouillon d'avant la 4a),
   * à conserver tel quel ; `[]` : saisis et laissés vides. Les formulaires envoient toujours un tableau.
   */
  beneficiaires: Beneficiaire[] | null;
  contactsUrgence: ContactUrgence[] | null;
  risque: Risque;
};

/** Ce qu'on peut compléter à l'acceptation, quand on connaît enfin le souscripteur complet et ses bénéficiaires. */
export type ComplementsContrat = {
  /** Compléments du souscripteur (§6.3.2) : fusionnés sur le souscripteur de la cotation. */
  souscripteur: SouscripteurComplements;
  beneficiaires: Beneficiaire[];
  contactsUrgence: ContactUrgence[];
};

/**
 * Ligne stockée : le tarif ET la prime retenue, pour que le forçage reste visible ; la valeur des
 * accessoires du paramétrage ET celle saisie dans la cotation (H1). Les deux champs d'accessoires
 * sont absents d'une cotation antérieure à la session 4.0.
 */
type LigneStockee = { code: string; effectif: number; primeTarif: string; primeForcee: string | null; accessoireTarif?: string; accessoireSaisi?: string | null };

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
  typeContrat: TypeContrat;
  forcages: ReturnType<typeof detecterForcages>;
};

/**
 * Valide la saisie puis calcule avec les paramètres en vigueur à `dateDocument` : tout montant vient
 * du moteur, jamais de la saisie. Un forçage exige le droit « Demande » ou « Valide » ET un motif.
 */
async function calculerSaisie(tx: Tx, acteur: UtilisateurCourant, saisie: SaisieCotation, dateDocument: DateIso): Promise<Calcul> {
  const typeContrat = saisie.typeContrat;
  if (!estTypeContrat(typeContrat)) {
    throw new ErreurMetier("Choisissez le type de contrat (individuel, famille, groupe ou groupe ouvert) : il détermine le taux de taxe.");
  }
  const contexte = await resoudreContexte(tx, saisie.codeProduit, dateDocument, saisie.dateEffet, typeContrat);
  const { version } = contexte;

  let souscripteur = saisie.souscripteur;
  if (saisie.clientId !== null) {
    const client = await tx.client.findUnique({ where: { id: saisie.clientId } });
    if (!client) throw new ErreurMetier("Client introuvable.");
    souscripteur = versSouscripteur(client);
  }

  const problemes = [
    ...problemesSouscripteur(souscripteur, dateDocument),
    ...problemesLignes(saisie.lignes, version.cotation.formulesMax),
    ...problemesAssures(saisie.assures, version.formules.map((f) => f.code), dateDocument),
    ...problemesBeneficiaires(saisie.beneficiaires ?? []),
    ...problemesContactsUrgence(saisie.contactsUrgence ?? []),
    ...problemesRisque(saisie.risque),
  ];
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

  const { entree, primesTarif, accessoiresTarif } = construireEntree(contexte, {
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
      accessoireTarif: accessoiresTarif[l.codeFormule],
      // Une valeur saisie égale au paramétrage n'est pas une modification.
      accessoireSaisi: l.accessoireValeur != null && !montant(l.accessoireValeur).eq(montant(accessoiresTarif[l.codeFormule])) ? montant(l.accessoireValeur).toFixed() : null,
    })),
    raisons: raisonsDeValidation({ forcages, ttc: resultat.totaux.arrondi.ttc, seuil: version.seuilValidationTtc }),
    souscripteur,
    typeContrat,
    forcages,
  };
}

/** Valeur des accessoires effectivement retenue pour une ligne stockée (saisie, sinon paramétrage). */
const accessoireRetenu = (l: LigneStockee): string | null => l.accessoireSaisi ?? l.accessoireTarif ?? null;

/**
 * H1 (D18) : chaque modification des accessoires est journalisée, avant/après. À la création, « avant »
 * est la valeur du paramétrage ; ensuite, la valeur retenue jusque-là.
 */
async function journaliserAccessoires(tx: Tx, acteur: UtilisateurCourant, id: number, avant: LigneStockee[] | null, apres: LigneStockee[], adresseIp: string | null): Promise<void> {
  const changements = apres
    .map((l) => {
      const precedente = avant?.find((x) => x.code === l.code);
      const valeurAvant = precedente ? accessoireRetenu(precedente) : (l.accessoireTarif ?? null);
      return { code: l.code, avant: valeurAvant, apres: accessoireRetenu(l), parametrage: l.accessoireTarif ?? null };
    })
    .filter((c) => c.avant !== c.apres && !(c.avant !== null && c.apres !== null && montant(c.avant).eq(montant(c.apres))));
  if (changements.length === 0) return;
  await journaliser(
    {
      acteur: auteur(acteur),
      action: "ACCESSOIRES_MODIFIES",
      objetType: "cotation",
      objetId: id,
      avant: Object.fromEntries(changements.map((c) => [c.code, c.avant])),
      apres: Object.fromEntries(changements.map((c) => [c.code, c.apres])),
      adresseIp,
    },
    tx,
  );
}

/** Colonne JSON facultative : « jamais fournie » s'écrit NULL en base, « saisie vide » s'écrit []. */
const listeOuNull = (liste: unknown[] | null) => (liste === null ? Prisma.DbNull : (liste as unknown as Prisma.InputJsonValue));

function donneesAEcrire(saisie: SaisieCotation, c: Calcul) {
  return {
    produitId: c.produitId,
    versionDateEffet: versDate(c.versionDateEffet),
    clientId: saisie.clientId,
    typeContrat: c.typeContrat,
    souscripteur: c.souscripteur as unknown as Prisma.InputJsonValue,
    dateEffet: versDate(saisie.dateEffet),
    dateEcheance: versDate(saisie.dateEcheance),
    nombreTranches: saisie.nombreTranches,
    lignes: c.lignesStockees as unknown as Prisma.InputJsonValue,
    motifForcage: c.forcages.length > 0 ? (saisie.motifForcage ?? "").trim() : null,
    assures: saisie.assures as unknown as Prisma.InputJsonValue,
    beneficiaires: listeOuNull(saisie.beneficiaires),
    contactsUrgence: listeOuNull(saisie.contactsUrgence),
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
      data: { ...donneesAEcrire(saisie, c), statut: "BROUILLON", auteurId: acteur.id, auteurIdentifiant: acteur.identifiant, contributeurs: [acteur.id] },
    });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_CREEE", objetType: "cotation", objetId: cree.id, apres: { produit: saisie.codeProduit, typeContrat: c.typeContrat, ttc: c.resultat.totaux.arrondi.ttc.toFixed() }, adresseIp }, tx);
    await journaliserAccessoires(tx, acteur, cree.id, null, c.lignesStockees, adresseIp);
    return cree.id;
  });
}

/**
 * H9 (D18) : tout utilisateur qui a le droit de créer (donc de modifier) une cotation peut modifier ou
 * soumettre un brouillon, pas seulement son auteur. Le droit est contrôlé par l'appelant (exigerAgir).
 */
async function chargerPourModification(tx: Tx, id: number) {
  const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
  if (!cotation) throw new ErreurMetier("Cotation introuvable.");
  if (!peutModifier(cotation.statut as StatutCotation)) {
    throw new ErreurMetier("Cette cotation n'est plus un brouillon : elle est figée.");
  }
  return cotation;
}

export async function modifierBrouillon(acteur: UtilisateurCourant, id: number, saisie: SaisieCotation, adresseIp: string | null): Promise<void> {
  await exigerAgir(acteur);
  await obtenirPrisma().$transaction(async (tx) => {
    const avant = await chargerPourModification(tx, id);
    if (avant.produit.code !== saisie.codeProduit) throw new ErreurMetier("Le produit d'une cotation ne se change pas : créez une nouvelle cotation.");
    const c = await calculerSaisie(tx, acteur, saisie, aujourdhui());
    // Qui a modifié un brouillon ne pourra pas le valider (séparation des tâches renforcée, H9).
    const contributeurs = avant.contributeurs.includes(acteur.id) ? avant.contributeurs : [...avant.contributeurs, acteur.id];
    await tx.cotation.update({ where: { id }, data: { ...donneesAEcrire(saisie, c), contributeurs } });
    await journaliser(
      {
        acteur: auteur(acteur),
        action: "COTATION_MODIFIEE",
        objetType: "cotation",
        objetId: id,
        avant: { ttc: avant.ttcTotal?.toFixed() ?? null, typeContrat: avant.typeContrat },
        apres: { ttc: c.resultat.totaux.arrondi.ttc.toFixed(), typeContrat: c.typeContrat, auteurDuBrouillon: avant.auteurIdentifiant },
        adresseIp,
      },
      tx,
    );
    await journaliserAccessoires(tx, acteur, id, avant.lignes as unknown as LigneStockee[], c.lignesStockees, adresseIp);
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
    const cotation = await chargerPourModification(tx, id);
    // Recalcul avec les paramètres du jour, à partir de ce qui est enregistré.
    const lignes = cotation.lignes as unknown as LigneStockee[];
    if (cotation.typeContrat === null) {
      throw new ErreurMetier("Ce brouillon date d'avant le choix du type de contrat : modifiez-le pour indiquer le type de contrat, puis soumettez-le.");
    }
    const saisie: SaisieCotation = {
      codeProduit: cotation.produit.code,
      clientId: cotation.clientId,
      typeContrat: cotation.typeContrat,
      souscripteur: cotation.souscripteur as unknown as Souscripteur,
      dateEffet: depuisDate(cotation.dateEffet),
      dateEcheance: depuisDate(cotation.dateEcheance),
      nombreTranches: cotation.nombreTranches,
      lignes: lignes.map((l) => ({ codeFormule: l.code, effectif: l.effectif, primeForcee: l.primeForcee, accessoireValeur: l.accessoireSaisi ?? null })),
      motifForcage: cotation.motifForcage,
      assures: cotation.assures as unknown as Assure[],
      beneficiaires: (cotation.beneficiaires as unknown as Beneficiaire[] | null) ?? null,
      contactsUrgence: (cotation.contactsUrgence as unknown as ContactUrgence[] | null) ?? null,
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
 * Valide une cotation « À valider » et l'émet. Droit « Valider une cotation » (H7, D18 : profil
 * Technique par défaut, paramétrable). Le valideur ne peut JAMAIS être quelqu'un qui a créé OU modifié
 * la cotation (CDC §4.1, T13 ; séparation renforcée par H9).
 */
export async function valider(acteur: UtilisateurCourant, id: number, adresseIp: string | null): Promise<string> {
  if (!peutValider(await niveauDuProfil(acteur.profil, "VALIDER_COTATION"))) {
    throw new ErreurAcces("Droit insuffisant : validation de cotation.");
  }
  return obtenirPrisma().$transaction(async (tx) => {
    const cotation = await tx.cotation.findUnique({ where: { id }, include: { produit: true } });
    if (!cotation) throw new ErreurMetier("Cotation introuvable.");
    if (!peutEtreValidee(cotation.statut as StatutCotation)) throw new ErreurMetier("Cette cotation n'est pas à valider.");
    if (!valideurAutorise(cotation.auteurId, acteur.id)) {
      throw new ErreurMetier("Vous ne pouvez pas valider votre propre cotation : un autre valideur doit la valider (séparation des tâches).");
    }
    if (cotation.contributeurs.includes(acteur.id)) {
      throw new ErreurMetier("Vous avez modifié cette cotation : un autre valideur doit la valider (séparation des tâches).");
    }
    await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_VALIDE", objetType: "cotation", objetId: id, apres: { raisons: cotation.raisonsValidation as unknown as string[] }, adresseIp }, tx);
    return emettre(tx, acteur, cotation, adresseIp, acteur);
  });
}

/**
 * Renvoie une cotation « À valider » en brouillon : par son auteur, ou par un valideur qui la refuse
 * (H12, D18), avec un motif obligatoire, journalisé. Le statut « Refusée » reste réservé au refus du client.
 */
export async function renvoyerEnBrouillon(acteur: UtilisateurCourant, id: number, commentaire: string, adresseIp: string | null): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    const cotation = await tx.cotation.findUnique({ where: { id } });
    if (!cotation) throw new ErreurMetier("Cotation introuvable.");
    if (!peutEtreRenvoyee(cotation.statut as StatutCotation)) throw new ErreurMetier("Cette cotation n'est pas à valider.");
    const estAuteur = cotation.auteurId === acteur.id;
    if (!estAuteur && !peutValider(await niveauDuProfil(acteur.profil, "VALIDER_COTATION"))) {
      throw new ErreurAcces("Droit insuffisant : seul l'auteur ou un valideur peut renvoyer cette cotation en brouillon.");
    }
    if (!estAuteur && commentaire.trim().length < 3) throw new ErreurMetier("Le motif du renvoi en brouillon est obligatoire (3 caractères au moins).");
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
 * les assurés et l'échéancier (CDC §9.4). Impossible si la cotation est expirée (T11). Le numéro de police
 * est attribué par SIM et SAISI ici (H10, D18) : jamais généré ; unique ; format paramétré contrôlé (H31).
 *
 * Session 4a : le souscripteur, les assurés, les bénéficiaires, les contacts d'urgence et l'échéancier de la
 * cotation passent dans la police sans ressaisie. `complements` permet de compléter, à ce moment (celui de la
 * souscription), ce qui n'était pas connu à la cotation ; absent, les données de la cotation sont reprises telles quelles.
 * Pour un contrat de groupe, la liste des assurés devient la version 1 (initiale) des adhérents.
 */
export async function accepter(
  acteur: UtilisateurCourant,
  id: number,
  codesRetenus: string[],
  numeroSaisi: string,
  adresseIp: string | null,
  complements?: ComplementsContrat,
): Promise<{ numeroPolice: string }> {
  await exigerAgir(acteur);
  const numeroPolice = normaliserNumeroPolice(numeroSaisi);
  const problemesNumero = problemesNumeroPolice(numeroPolice, await lireFormatNumeroPolice());
  if (problemesNumero.length > 0) throw new ErreurMetier(problemesNumero.join(" "));
  await expirerCotations();
  try {
    return await accepterDansTransaction(acteur, id, codesRetenus, numeroPolice, adresseIp, complements);
  } catch (erreur) {
    // Filet de sécurité de l'unicité (deux saisies simultanées du même numéro) : contrainte unique en base.
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier(`Le numéro de police « ${numeroPolice} » est déjà utilisé.`);
    }
    throw erreur;
  }
}

async function accepterDansTransaction(
  acteur: UtilisateurCourant,
  id: number,
  codesRetenus: string[],
  numeroPolice: string,
  adresseIp: string | null,
  complements: ComplementsContrat | undefined,
): Promise<{ numeroPolice: string }> {
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

    if (await tx.police.findUnique({ where: { numero: numeroPolice }, select: { id: true } })) {
      throw new ErreurMetier(`Le numéro de police « ${numeroPolice} » est déjà utilisé.`);
    }

    // Données reprises de la cotation, éventuellement complétées à la souscription.
    const souscripteur: Souscripteur = { ...(cotation.souscripteur as unknown as Souscripteur), ...(complements?.souscripteur ?? {}) };
    const beneficiaires = complements ? complements.beneficiaires : ((cotation.beneficiaires as unknown as Beneficiaire[] | null) ?? null);
    const contactsUrgence = complements ? complements.contactsUrgence : ((cotation.contactsUrgence as unknown as ContactUrgence[] | null) ?? null);
    if (complements) {
      const problemes = [...problemesSouscripteur(souscripteur, aujourdhui()), ...problemesBeneficiaires(beneficiaires ?? []), ...problemesContactsUrgence(contactsUrgence ?? [])];
      if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
    }

    const police = await tx.police.create({
      data: {
        numero: numeroPolice,
        typeContrat: cotation.typeContrat,
        cotationId: cotation.id,
        produitCode: cotation.produit.code,
        souscripteur: souscripteur as unknown as Prisma.InputJsonValue,
        assures: cotation.assures as Prisma.InputJsonValue,
        beneficiaires: listeOuNull(beneficiaires),
        contactsUrgence: listeOuNull(contactsUrgence),
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
    if (estContratDeGroupe(cotation.typeContrat)) {
      // Version 1 de la liste des adhérents : celle de la cotation acceptée, à la date d'effet de la police.
      await tx.adherentsVersion.create({
        data: { policeId: police.id, numero: 1, motif: "INITIALE", dateEffet: cotation.dateEffet, adherents: cotation.assures as Prisma.InputJsonValue, concernes: [], creePar: acteur.identifiant },
      });
    }
    await tx.cotation.update({ where: { id }, data: { statut: "ACCEPTEE", formulesRetenues: codesRetenus as unknown as Prisma.InputJsonValue, accepteeLe: new Date() } });
    await journaliser({ acteur: auteur(acteur), action: "COTATION_ACCEPTEE", objetType: "cotation", objetId: id, apres: { formules: codesRetenus, numeroPolice }, adresseIp }, tx);
    await journaliser({ acteur: auteur(acteur), action: "POLICE_CREEE", objetType: "police", objetId: numeroPolice, apres: { cotation: cotation.numero, ttc: resultat.totaux.arrondi.ttc.toFixed(), complementsSaisis: complements !== undefined, beneficiaires: beneficiaires?.length ?? null, contactsUrgence: contactsUrgence?.length ?? null }, adresseIp }, tx);
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
  typeContrat: TypeContrat | null;
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
  /** null : jamais fournis (cotation d'avant la 4a). */
  beneficiaires: Beneficiaire[] | null;
  contactsUrgence: ContactUrgence[] | null;
  risque: Risque;
  raisonsValidation: RaisonValidation[];
  /** Recalculé à partir des paramètres figés : identique à ce qui a été émis. */
  resultat: ResultatCalcul;
  echeancier: Tranche[] | null;
  auteurId: number;
  auteurIdentifiant: string;
  /** Qui a créé ou modifié le brouillon (H9) : aucun ne peut valider. */
  contributeurs: number[];
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
    typeContrat: (c.typeContrat as TypeContrat | null) ?? null,
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
    beneficiaires: (c.beneficiaires as unknown as Beneficiaire[] | null) ?? null,
    contactsUrgence: (c.contactsUrgence as unknown as ContactUrgence[] | null) ?? null,
    risque: c.risque as unknown as Risque,
    raisonsValidation: c.raisonsValidation as unknown as RaisonValidation[],
    resultat: calculer(c.donneesCalcul as unknown as EntreeCalcul),
    echeancier: jsonVersTranches(c.echeancier),
    auteurId: c.auteurId,
    auteurIdentifiant: c.auteurIdentifiant,
    contributeurs: c.contributeurs,
    formulesRetenues: (c.formulesRetenues as unknown as string[] | null) ?? null,
    motifRefusCode: c.motifRefusCode,
    refusCommentaire: c.refusCommentaire,
    numeroPolice: c.police?.numero ?? null,
  };
}
