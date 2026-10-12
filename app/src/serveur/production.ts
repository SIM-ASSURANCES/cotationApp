import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import type { DateIso } from "@/domaine/calcul/dates";
import type { Souscripteur } from "@/domaine/cotation/saisie";
import { cheminStockage, masquerSouscripteur, nomSouscripteur, type TypeDocument } from "@/domaine/documents/emission";

import { journaliser, type ActeurAudit } from "./audit";
import { images, nouveauJeton, urlPublique, versLu, type DocumentLu } from "./documents";
import { generateur } from "./generateur";
import { fichiersAssocies, lireSeuilListe, type VersionsAssociees } from "./modeles";
import { obtenirPrisma } from "./prisma";
import { differerEcriture, programmerReprise, tenterEcriture } from "./stockage";
import type { UtilisateurCourant } from "./types";

/**
 * Documents à produire (session 4b, CDC §11.4) : facture, avoir, reçu ; avis d'échéance et relance (session 5b, CDC §12).
 *
 * 1. Dans la transaction de l'émission (ou du paiement), `figer` enregistre TOUT ce qu'il faut pour écrire le document :
 *    numéro (déjà attribué par le compteur, dans la même transaction), version, jeton du QR code, données complètes,
 *    versions des modèles. Si la transaction est annulée, rien ne reste : ni numéro consommé, ni document.
 * 2. Après la validation de la transaction, `produire` génère le PDF, le stocke et inscrit le document émis (même
 *    numéro, même version, même jeton). S'il échoue (générateur arrêté, stockage indisponible…), la facture reste émise,
 *    son numéro n'est pas perdu : le document reste « PDF en attente » et se relance À L'IDENTIQUE.
 */

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
const sha256 = (octets: Uint8Array) => createHash("sha256").update(octets).digest("hex");
const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });

export type TypeAProduire = Extract<TypeDocument, "FACTURE" | "AVOIR" | "RECU" | "AVIS_ECHEANCE" | "RELANCE">;

/** Versions des modèles associés, et listes toujours renvoyées en annexe (facture de groupe). */
export type AssociesFiges = VersionsAssociees & { listesEnAnnexe: string[] };

export type AFiger = {
  type: TypeAProduire;
  numero: string;
  version: number;
  factureId: number;
  paiementId?: number | null;
  /** Avis d'échéance et relance (session 5b) : échéance appelée et niveau ; uniques en base. */
  echeanceNumero?: number | null;
  niveauRelance?: number | null;
  produitCode: string;
  policeNumero: string;
  policeId: number;
  cotationId: number;
  souscripteur: Pick<Souscripteur, "type" | "nom" | "prenoms" | "raison_sociale">;
  dateEmission: DateIso;
  parametresDate: DateIso;
  modeleVersionId: number;
  associes: AssociesFiges;
  /** Données du document, construites avec l'adresse de vérification (QR code) de cette version. */
  donnees: (urlVerification: string) => Record<string, unknown>;
  emisPar: string;
};

/** À appeler DANS la transaction de l'émission : rien n'est produit ici, tout est figé. */
export async function figer(tx: Prisma.TransactionClient, a: AFiger): Promise<number> {
  const jeton = nouveauJeton();
  const ligne = await tx.documentAProduire.create({
    data: {
      type: a.type,
      numero: a.numero,
      version: a.version,
      jeton,
      factureId: a.factureId,
      paiementId: a.paiementId ?? null,
      echeanceNumero: a.echeanceNumero ?? null,
      niveauRelance: a.niveauRelance ?? null,
      produitCode: a.produitCode,
      policeNumero: a.policeNumero,
      policeId: a.policeId,
      cotationId: a.cotationId,
      souscripteurNom: nomSouscripteur(a.souscripteur),
      souscripteurMasque: masquerSouscripteur(a.souscripteur),
      dateEmission: versDate(a.dateEmission),
      parametresDate: versDate(a.parametresDate),
      modeleVersionId: a.modeleVersionId,
      versionsAssociees: a.associes as unknown as Prisma.InputJsonValue,
      donnees: a.donnees(`${urlPublique()}/verif/${jeton}`) as Prisma.InputJsonValue,
      emisPar: a.emisPar,
    },
  });
  return ligne.id;
}

/** Prochaine version d'un numéro (facture rééditée à chaque paiement) : toutes les versions passent par cette table. */
export async function prochaineVersion(tx: Prisma.TransactionClient, numero: string): Promise<number> {
  const max = await tx.documentAProduire.aggregate({ where: { numero }, _max: { version: true } });
  return (max._max.version ?? 0) + 1;
}

export type IssueProduction = { id: number; numero: string; version: number; type: string } & ({ ok: true; document: DocumentLu } | { ok: false; erreur: string });

/** Chemin du fichier : celui du CDC (§14.2) ; une relance après un échec ne réécrit jamais un fichier existant. */
const chemin = (p: { produitCode: string; type: string; numero: string; dateEmission: Date; version: number }, tentative: number) => {
  const base = cheminStockage({ produitCode: p.produitCode, type: p.type as TypeDocument, numero: p.numero, dateEmission: depuisDate(p.dateEmission), version: p.version });
  return tentative > 1 ? base.replace(/\.pdf$/, `_essai${tentative}.pdf`) : base;
};

/**
 * Produit UN document en attente, à l'identique de ce qui a été figé : mêmes données, mêmes versions de modèles, même
 * jeton. Les versions précédentes du même numéro passent d'abord (la version 1 est l'origine des suivantes).
 */
export async function produire(acteur: UtilisateurCourant, id: number, adresseIp: string | null): Promise<IssueProduction> {
  const prisma = obtenirPrisma();
  const p = await prisma.documentAProduire.findUniqueOrThrow({ where: { id } });
  const issue = { id: p.id, numero: p.numero, version: p.version, type: p.type };
  if (p.statut === "PRODUIT") {
    return { ...issue, ok: true, document: versLu(await prisma.documentEmis.findUniqueOrThrow({ where: { id: p.documentId! } })) };
  }
  const anterieure = await prisma.documentAProduire.findFirst({ where: { numero: p.numero, version: { lt: p.version }, statut: "EN_ATTENTE" }, orderBy: { version: "asc" } });
  if (anterieure) {
    const avant = await produire(acteur, anterieure.id, adresseIp);
    if (!avant.ok) return { ...issue, ok: false, erreur: `La version ${anterieure.version} de ${p.numero} est encore en attente : ${avant.erreur}` };
  }

  const essai = await prisma.documentAProduire.update({ where: { id }, data: { tentatives: { increment: 1 } } });
  try {
    const modele = await prisma.modeleVersion.findUniqueOrThrow({ where: { id: p.modeleVersionId }, select: { fichier: true, analyse: true } });
    const ids = p.versionsAssociees as unknown as AssociesFiges;
    const associes = await fichiersAssocies({ annexes: ids.annexes ?? {}, sousModeles: ids.sousModeles ?? {} });
    const donnees = p.donnees as Record<string, unknown> & { doc: { url_verification: string } };
    const pdf = await generateur().genererPdf({
      modele: modele.fichier,
      donnees,
      seuilListe: await lireSeuilListe(depuisDate(p.dateEmission)),
      annexes: associes.annexes,
      sousModeles: associes.sousModeles,
      images: await images(((modele.analyse as { champs?: string[] }).champs ?? []) as string[]),
      qr: { url: donnees.doc.url_verification },
      listesEnAnnexe: ids.listesEnAnnexe ?? [],
    });
    const empreinte = sha256(pdf);
    const fichier = chemin(p, essai.tentatives);
    // Stockage indisponible (T14) : le document est inscrit quand même, son fichier attend en base (écriture différée).
    const ecriture = await tenterEcriture(fichier, pdf, empreinte);

    const document = await prisma.$transaction(async (tx) => {
      const origine = p.version > 1 ? await tx.documentEmis.findUnique({ where: { numero_version: { numero: p.numero, version: 1 } }, select: { id: true } }) : null;
      const cree = await tx.documentEmis.create({
        data: {
          type: p.type,
          numero: p.numero,
          version: p.version,
          origineId: origine?.id ?? null,
          jeton: p.jeton,
          chemin: fichier,
          empreinte,
          taille: pdf.byteLength,
          produitCode: p.produitCode,
          policeNumero: p.policeNumero,
          souscripteurNom: p.souscripteurNom,
          souscripteurMasque: p.souscripteurMasque,
          cotationId: p.cotationId,
          policeId: p.policeId,
          dateEmission: p.dateEmission,
          modeleVersionId: p.modeleVersionId,
          versionsAssociees: p.versionsAssociees as Prisma.InputJsonValue,
          parametresDate: p.parametresDate,
          donnees: p.donnees as Prisma.InputJsonValue,
          emisPar: p.emisPar,
        },
      });
      // Facture annulée par un avoir pendant que son PDF était en attente : le document naît annulé (T12) ; de même
      // pour un avis d'échéance ou une relance de cette facture (session 5b).
      const facture = p.factureId ? await tx.facture.findUnique({ where: { id: p.factureId }, select: { statut: true, annuleeLe: true, annuleePar: { select: { numero: true } } } }) : null;
      const document =
        (p.type === "FACTURE" || p.type === "AVIS_ECHEANCE" || p.type === "RELANCE") && facture?.statut === "ANNULEE" && facture.annuleePar?.numero
          ? await tx.documentEmis.update({ where: { id: cree.id }, data: { annuleParNumero: facture.annuleePar.numero, annuleLe: facture.annuleeLe ?? new Date() } })
          : cree;
      await tx.documentAProduire.update({ where: { id }, data: { statut: "PRODUIT", documentId: cree.id, produitLe: new Date(), derniereErreur: null } });
      if (!ecriture.ecrit) await differerEcriture(tx, { documentId: cree.id, numero: p.numero, version: p.version, chemin: fichier, empreinte, contenu: pdf, erreur: ecriture.erreur }, auteur(acteur), adresseIp);
      await journaliser(
        {
          acteur: auteur(acteur),
          action: p.version === 1 ? "DOCUMENT_EMIS" : "DOCUMENT_REEDITE",
          objetType: "document",
          objetId: cree.id,
          apres: { type: p.type, numero: p.numero, version: p.version, empreinte, chemin: fichier, modeleVersionId: p.modeleVersionId, tentative: essai.tentatives },
          adresseIp,
        },
        tx,
      );
      return document;
    });
    if (!ecriture.ecrit) await programmerReprise(document.id);
    return { ...issue, ok: true, document: versLu(document) };
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    await prisma.documentAProduire.update({ where: { id }, data: { derniereErreur: message.slice(0, 1000) } });
    await journaliser({ acteur: auteur(acteur), action: "PDF_EN_ATTENTE", objetType: "document", objetId: `${p.numero} v${p.version}`, apres: { type: p.type, tentative: essai.tentatives, erreur: message.slice(0, 300) }, adresseIp });
    console.error(`[production] ${p.numero} v${p.version} : PDF en attente (${message})`);
    return { ...issue, ok: false, erreur: message };
  }
}

/** Produit, dans l'ordre (numéro puis version), les documents en attente d'une facture (et de ses reçus). */
export async function produireEnAttente(acteur: UtilisateurCourant, critere: { factureIds: number[] }, adresseIp: string | null): Promise<IssueProduction[]> {
  const enAttente = await obtenirPrisma().documentAProduire.findMany({
    where: { statut: "EN_ATTENTE", factureId: { in: critere.factureIds } },
    orderBy: [{ id: "asc" }],
    select: { id: true },
  });
  const issues: IssueProduction[] = [];
  for (const { id } of enAttente) issues.push(await produire(acteur, id, adresseIp));
  return issues;
}
