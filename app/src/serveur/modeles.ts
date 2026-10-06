import "server-only";

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import type { DateIso } from "@/domaine/calcul/dates";
import { controlerDepot, type Constat } from "@/domaine/documents/controles";
import { IMAGES, donneesExemple } from "@/domaine/documents/dictionnaire";
import {
  CLE_SEUIL_LISTE,
  LIBELLE_STATUT_VERSION,
  REGLES,
  SEUIL_LISTE_DEFAUT,
  donneesFixes,
  estTypeModele,
  peutPublier,
  peutRenvoyer,
  peutSoumettre,
  problemesPublication,
  problemesSaisieModele,
  problemesSaisieVersion,
  problemesSeuil,
  statutAffiche,
  versionEnVigueur,
  type SaisieModele,
  type StatutAffiche,
  type StatutVersion,
  type TypeModele,
  type VersionCycle,
} from "@/domaine/documents/modeles";
import { peutAgir, peutLire } from "@/domaine/droits";

import { journaliser, type ActeurAudit } from "./audit";
import { niveauDuProfil } from "./droits";
import { generateur, type ImagePng } from "./generateur";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Bibliothèque de modèles Word (CDC §6.1, §6.6, §6.7) : création, dépôt contrôlé, soumission,
 * publication par un autre profil, aperçu, téléchargement. Droits (CDC §4) : la Technique dépose
 * (« Déposer/modifier un modèle Word »), la Direction Générale publie (« Publier un modèle »).
 */

type Client = PrismaClient | Prisma.TransactionClient;
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const sha256 = (octets: Uint8Array): string => createHash("sha256").update(octets).digest("hex");

/** Dépôt refusé par les contrôles : la liste des problèmes, avec leur emplacement, est affichée. */
export class ErreurDepot extends ErreurMetier {
  override name = "ErreurDepot";
}

// ---------------------------------------------------------------- Droits

async function niveaux(acteur: UtilisateurCourant) {
  const [depot, publication] = await Promise.all([niveauDuProfil(acteur.profil, "DEPOSER_MODELE"), niveauDuProfil(acteur.profil, "PUBLIER_MODELE")]);
  return { deposer: peutAgir(depot), publier: peutAgir(publication), lire: peutLire(depot) || peutLire(publication) };
}

async function exiger(acteur: UtilisateurCourant, droit: "lire" | "deposer" | "publier"): Promise<{ deposer: boolean; publier: boolean }> {
  const n = await niveaux(acteur);
  if (!n[droit]) {
    const quoi = { lire: "consultation des modèles", deposer: "dépôt de modèle Word", publier: "publication de modèle" }[droit];
    throw new ErreurAcces(`Droit insuffisant : ${quoi}.`);
  }
  return n;
}

// ---------------------------------------------------------------- Lecture

export type ResumeVersion = { id: number; numero: number; statut: StatutAffiche; libelleStatut: string; dateEffet: DateIso };

export type LigneModele = {
  id: number;
  type: TypeModele;
  libelleType: string;
  code: string;
  libelle: string;
  produitCode: string | null;
  precision: string | null;
  enVigueur: ResumeVersion | null;
  derniere: ResumeVersion | null;
};

export type VersionLue = ResumeVersion & {
  commentaire: string;
  nomFichier: string;
  taille: number;
  empreinte: string;
  auteur: string;
  deposeLe: Date;
  soumisLe: Date | null;
  valideur: string | null;
  publieLe: Date | null;
  motifRenvoi: string | null;
  visa: string | null;
  dateDocument: DateIso | null;
  aUnPdf: boolean;
  avertissements: Constat[];
  champsUtilises: string[];
  peutSoumettre: boolean;
  peutPublier: boolean;
  peutRenvoyer: boolean;
};

export type ModeleLu = LigneModele & { versions: VersionLue[]; droits: { deposer: boolean; publier: boolean } };

type AnalyseStockee = { avertissements: Constat[]; champs: string[]; polices: string[]; blocs: { nom: string; cle: string | null }[] };

const champsVersion = {
  id: true,
  numero: true,
  statut: true,
  dateEffet: true,
  auteurId: true,
} as const;

const cycle = (v: { id: number; numero: number; statut: string; dateEffet: Date; auteurId: number }): VersionCycle => ({
  id: v.id,
  numero: v.numero,
  statut: v.statut as StatutVersion,
  dateEffet: depuisDate(v.dateEffet),
  auteurId: v.auteurId,
});

function resume(v: VersionCycle, toutes: VersionCycle[], jour: DateIso): ResumeVersion {
  const statut = statutAffiche(v, toutes, jour);
  return { id: v.id, numero: v.numero, statut, libelleStatut: LIBELLE_STATUT_VERSION[statut], dateEffet: v.dateEffet };
}

function precision(m: { type: string; niveauRelance: number | null; listeAnnexe: string | null; blocNom: string | null; blocCle: string | null }): string | null {
  if (m.type === "RELANCE") return `niveau ${m.niveauRelance}`;
  if (m.type === "ANNEXE") return `liste « ${m.listeAnnexe} »`;
  if (m.type === "SOUS_MODELE") return `bloc("${m.blocNom}", ${m.blocCle})`;
  return null;
}

function ligne(
  m: { id: number; type: string; code: string; libelle: string; niveauRelance: number | null; listeAnnexe: string | null; blocNom: string | null; blocCle: string | null; produit: { code: string } | null },
  versions: VersionCycle[],
  jour: DateIso,
): LigneModele {
  const type = m.type as TypeModele;
  const enVigueur = versionEnVigueur(versions, jour);
  const derniere = versions.reduce<VersionCycle | null>((max, v) => (!max || v.numero > max.numero ? v : max), null);
  return {
    id: m.id,
    type,
    libelleType: REGLES[type]?.libelle ?? m.type,
    code: m.code,
    libelle: m.libelle,
    produitCode: m.produit?.code ?? null,
    precision: precision(m),
    enVigueur: enVigueur ? resume(enVigueur, versions, jour) : null,
    derniere: derniere ? resume(derniere, versions, jour) : null,
  };
}

export async function listerModeles(acteur: UtilisateurCourant): Promise<LigneModele[]> {
  await exiger(acteur, "lire");
  const jour = aujourdhui();
  const modeles = await obtenirPrisma().modele.findMany({
    include: { produit: { select: { code: true } }, versions: { select: champsVersion } },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
  return modeles.map((m) => ligne(m, m.versions.map(cycle), jour));
}

export async function lireModele(acteur: UtilisateurCourant, id: number): Promise<ModeleLu | null> {
  const droits = await exiger(acteur, "lire");
  const jour = aujourdhui();
  const m = await obtenirPrisma().modele.findUnique({
    where: { id },
    include: {
      produit: { select: { code: true } },
      // Jamais le fichier ni le PDF : une liste de versions ne charge pas des mégaoctets.
      versions: { omit: { fichier: true, pdf: true }, orderBy: { numero: "desc" } },
    },
  });
  if (!m) return null;
  const cycles = m.versions.map(cycle);
  return {
    ...ligne(m, cycles, jour),
    droits: { deposer: droits.deposer, publier: droits.publier },
    versions: m.versions.map((v, i) => {
      const c = cycles[i];
      const analyse = v.analyse as unknown as AnalyseStockee;
      return {
        ...resume(c, cycles, jour),
        commentaire: v.commentaire,
        nomFichier: v.nomFichier,
        taille: v.taille,
        empreinte: v.empreinte,
        auteur: v.auteurIdentifiant,
        deposeLe: v.deposeLe,
        soumisLe: v.soumisLe,
        valideur: v.valideurIdentifiant,
        publieLe: v.publieLe,
        motifRenvoi: v.motifRenvoi,
        visa: v.visa,
        dateDocument: v.dateDocument ? depuisDate(v.dateDocument) : null,
        aUnPdf: v.pdfEmpreinte !== null,
        avertissements: analyse.avertissements ?? [],
        champsUtilises: analyse.champs ?? [],
        peutSoumettre: droits.deposer && peutSoumettre(c, acteur.id),
        peutPublier: droits.publier && peutPublier(c, acteur.id),
        peutRenvoyer: droits.publier && peutRenvoyer(c, acteur.id),
      };
    }),
  };
}

// ---------------------------------------------------------------- Création d'un modèle

export async function creerModele(acteur: UtilisateurCourant, saisie: SaisieModele, adresseIp: string | null): Promise<number> {
  await exiger(acteur, "deposer");
  if (!estTypeModele(saisie.type)) throw new ErreurMetier("Type de modèle inconnu.");
  const problemes = problemesSaisieModele(saisie);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

  return obtenirPrisma().$transaction(async (tx) => {
    const produit = saisie.produitCode ? await tx.produit.findUnique({ where: { code: saisie.produitCode } }) : null;
    if (saisie.produitCode && !produit) throw new ErreurMetier(`Produit « ${saisie.produitCode} » inconnu.`);
    if (await tx.modele.findUnique({ where: { code: saisie.code } })) throw new ErreurMetier("Ce code de modèle existe déjà.");
    // Un seul modèle par rôle : sinon, lequel choisir à la génération ?
    const homonyme = await tx.modele.findFirst({
      where: {
        type: saisie.type,
        produitId: produit?.id ?? null,
        ...(saisie.type === "ANNEXE" ? { listeAnnexe: saisie.listeAnnexe } : {}),
        ...(saisie.type === "SOUS_MODELE" ? { blocNom: saisie.blocNom, blocCle: saisie.blocCle } : {}),
        ...(saisie.type === "RELANCE" ? { niveauRelance: saisie.niveauRelance } : {}),
      },
    });
    if (homonyme && ["ANNEXE", "SOUS_MODELE", "RELANCE"].includes(saisie.type)) {
      throw new ErreurMetier(`Un modèle joue déjà ce rôle : ${homonyme.code}. Déposez-y une nouvelle version.`);
    }
    const cree = await tx.modele.create({
      data: {
        type: saisie.type,
        code: saisie.code,
        libelle: saisie.libelle.trim(),
        produitId: produit?.id ?? null,
        niveauRelance: saisie.niveauRelance,
        listeAnnexe: saisie.listeAnnexe,
        blocNom: saisie.blocNom,
        blocCle: saisie.blocCle,
        creePar: acteur.identifiant,
      },
    });
    await journaliser({ acteur: auteur(acteur), action: "MODELE_CREE", objetType: "modele", objetId: cree.id, apres: { ...saisie }, adresseIp }, tx);
    return cree.id;
  });
}

// ---------------------------------------------------------------- Dépôt d'une version

export type DepotVersion = {
  fichier: Uint8Array;
  nomFichier: string;
  commentaire: string;
  dateEffet: DateIso;
  visa: string | null;
  dateDocument: DateIso | null;
};

/**
 * Dépose un .docx : analyse par le générateur, contrôles (CDC §6.7). Refusé : rien n'est enregistré
 * (le refus est journalisé) et l'erreur liste chaque problème avec son emplacement. Accepté : une
 * nouvelle version en brouillon, avec ses avertissements.
 */
export async function deposerVersion(acteur: UtilisateurCourant, modeleId: number, depot: DepotVersion, adresseIp: string | null): Promise<{ numero: number; avertissements: Constat[] }> {
  await exiger(acteur, "deposer");
  const prisma = obtenirPrisma();
  const modele = await prisma.modele.findUnique({ where: { id: modeleId } });
  if (!modele) throw new ErreurMetier("Modèle introuvable.");
  const type = modele.type as TypeModele;
  const problemes = problemesSaisieVersion(type, { ...depot, taille: depot.fichier.byteLength });
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

  const empreinte = sha256(depot.fichier);
  const analyse = await generateur().analyser(depot.fichier);
  const { rejets, avertissements } = controlerDepot(type, analyse);
  const details = (c: Constat) => (c.emplacement ? `${c.message} — ${c.emplacement}` : c.message);

  if (rejets.length > 0) {
    await journaliser({
      acteur: auteur(acteur),
      action: "MODELE_DEPOT_REFUSE",
      objetType: "modele",
      objetId: modele.id,
      apres: { fichier: depot.nomFichier, empreinte, problemes: rejets.slice(0, 50).map(details) },
      adresseIp,
    });
    throw new ErreurDepot(`Dépôt refusé : ${rejets.length} problème(s) à corriger dans le fichier Word, puis à redéposer.`, rejets.map(details));
  }

  const stockee: AnalyseStockee = {
    avertissements,
    champs: [...new Set(analyse.references.map((r) => r.chemin))].sort(),
    polices: analyse.polices,
    blocs: analyse.blocs.map((b) => ({ nom: b.nom, cle: b.cle })),
  };
  try {
    return await prisma.$transaction(async (tx) => {
      const derniere = await tx.modeleVersion.aggregate({ where: { modeleId }, _max: { numero: true } });
      const numero = (derniere._max.numero ?? 0) + 1;
      const creee = await tx.modeleVersion.create({
        data: {
          modeleId,
          numero,
          statut: "BROUILLON",
          fichier: depot.fichier as Uint8Array<ArrayBuffer>,
          nomFichier: depot.nomFichier.slice(0, 200),
          taille: depot.fichier.byteLength,
          empreinte,
          commentaire: depot.commentaire.trim(),
          dateEffet: versDate(depot.dateEffet),
          analyse: stockee as unknown as Prisma.InputJsonValue,
          auteurId: acteur.id,
          auteurIdentifiant: acteur.identifiant,
          visa: depot.visa?.trim() ?? null,
          dateDocument: depot.dateDocument ? versDate(depot.dateDocument) : null,
        },
      });
      await journaliser(
        {
          acteur: auteur(acteur),
          action: "MODELE_DEPOSE",
          objetType: "modele_version",
          objetId: creee.id,
          apres: { modele: modele.code, numero, fichier: depot.nomFichier, empreinte, avertissements: avertissements.length },
          adresseIp,
        },
        tx,
      );
      return { numero, avertissements };
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier("Une autre version vient d'être déposée en même temps : redéposez le fichier.");
    }
    throw erreur;
  }
}

// ---------------------------------------------------------------- Cycle de vie

async function chargerVersion(tx: Client, versionId: number) {
  const v = await tx.modeleVersion.findUnique({
    where: { id: versionId },
    omit: { pdf: true },
    include: { modele: { include: { versions: { select: champsVersion } } } },
  });
  if (!v) throw new ErreurMetier("Version de modèle introuvable.");
  return v;
}

export async function soumettreVersion(acteur: UtilisateurCourant, versionId: number, adresseIp: string | null): Promise<void> {
  await exiger(acteur, "deposer");
  await obtenirPrisma().$transaction(async (tx) => {
    const v = await chargerVersion(tx, versionId);
    if (!peutSoumettre(cycle(v), acteur.id)) {
      throw new ErreurMetier(v.statut !== "BROUILLON" ? "Seul un brouillon peut être soumis." : "Seul l'auteur d'une version peut la soumettre.");
    }
    const fait = await tx.modeleVersion.updateMany({ where: { id: v.id, statut: "BROUILLON" }, data: { statut: "SOUMIS", soumisLe: new Date(), motifRenvoi: null } });
    if (fait.count !== 1) throw new ErreurMetier("Cette version vient de changer : rechargez la page.");
    await journaliser({ acteur: auteur(acteur), action: "MODELE_SOUMIS", objetType: "modele_version", objetId: v.id, apres: { modele: v.modele.code, numero: v.numero }, adresseIp }, tx);
  });
}

export async function renvoyerVersion(acteur: UtilisateurCourant, versionId: number, motif: string, adresseIp: string | null): Promise<void> {
  await exiger(acteur, "publier");
  if (motif.trim().length < 5) throw new ErreurMetier("Motif du renvoi obligatoire (5 caractères au moins).");
  await obtenirPrisma().$transaction(async (tx) => {
    const v = await chargerVersion(tx, versionId);
    if (!peutRenvoyer(cycle(v), acteur.id)) {
      throw new ErreurMetier(v.statut !== "SOUMIS" ? "Seule une version soumise peut être renvoyée." : "L'auteur ne peut pas renvoyer sa propre version.");
    }
    const fait = await tx.modeleVersion.updateMany({ where: { id: v.id, statut: "SOUMIS" }, data: { statut: "BROUILLON", soumisLe: null, motifRenvoi: motif.trim().slice(0, 1000) } });
    if (fait.count !== 1) throw new ErreurMetier("Cette version vient de changer : rechargez la page.");
    await journaliser({ acteur: auteur(acteur), action: "MODELE_RENVOYE", objetType: "modele_version", objetId: v.id, apres: { modele: v.modele.code, numero: v.numero, motif: motif.trim() }, adresseIp }, tx);
  });
}

/**
 * Publie une version soumise, à une date d'effet qui n'est pas passée. Le valideur n'est jamais
 * l'auteur (vérifié ici ET par la base). CG et CS : le PDF est produit ICI, une seule fois, et
 * conservé avec la version ; il ne sera jamais reconverti.
 */
export async function publierVersion(acteur: UtilisateurCourant, versionId: number, dateEffet: DateIso, adresseIp: string | null): Promise<void> {
  await exiger(acteur, "publier");
  const prisma = obtenirPrisma();
  const v = await chargerVersion(prisma, versionId);
  const c = cycle(v);
  if (!peutPublier(c, acteur.id)) {
    throw new ErreurMetier(v.statut !== "SOUMIS" ? "Seule une version soumise peut être publiée." : "Le valideur ne peut pas être l'auteur de la version (CDC §4.1) : un autre utilisateur doit publier.");
  }
  const problemes = problemesPublication(c, dateEffet, aujourdhui(), v.modele.versions.map(cycle));
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

  const type = v.modele.type as TypeModele;
  let pdf: Uint8Array | null = null;
  if (REGLES[type].fixe) {
    const complet = await prisma.modeleVersion.findUniqueOrThrow({ where: { id: v.id }, select: { fichier: true } });
    pdf = await generateur().genererPdf({
      modele: complet.fichier,
      donnees: donneesFixes(type as "CG" | "CS", v.modele.libelle, v.visa ?? "", v.dateDocument ? depuisDate(v.dateDocument) : null),
      seuilListe: await lireSeuilListe(),
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const fait = await tx.modeleVersion.updateMany({
        where: { id: v.id, statut: "SOUMIS" },
        data: {
          statut: "PUBLIE",
          dateEffet: versDate(dateEffet),
          valideurId: acteur.id,
          valideurIdentifiant: acteur.identifiant,
          publieLe: new Date(),
          ...(pdf ? { pdf: pdf as Uint8Array<ArrayBuffer>, pdfEmpreinte: sha256(pdf) } : {}),
        },
      });
      if (fait.count !== 1) throw new ErreurMetier("Cette version vient de changer : rechargez la page.");
      await journaliser(
        {
          acteur: auteur(acteur),
          action: "MODELE_PUBLIE",
          objetType: "modele_version",
          objetId: v.id,
          apres: { modele: v.modele.code, numero: v.numero, dateEffet, empreinte: v.empreinte, ...(pdf ? { pdfEmpreinte: sha256(pdf) } : {}) },
          adresseIp,
        },
        tx,
      );
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier("Une version de ce modèle est déjà publiée avec cette date d'effet.");
    }
    throw erreur;
  }
}

// ---------------------------------------------------------------- Fichiers et aperçu

export async function fichierVersion(acteur: UtilisateurCourant, versionId: number, adresseIp: string | null): Promise<{ nom: string; contenu: Uint8Array }> {
  await exiger(acteur, "lire");
  const v = await obtenirPrisma().modeleVersion.findUnique({ where: { id: versionId }, select: { id: true, numero: true, fichier: true, modele: { select: { code: true } } } });
  if (!v) throw new ErreurMetier("Version de modèle introuvable.");
  await journaliser({ acteur: auteur(acteur), action: "MODELE_TELECHARGE", objetType: "modele_version", objetId: v.id, apres: { modele: v.modele.code, numero: v.numero, fichier: "docx" }, adresseIp });
  return { nom: `${v.modele.code}_v${v.numero}.docx`, contenu: v.fichier };
}

/** PDF des CG ou CS, produit à la publication. */
export async function pdfPublie(acteur: UtilisateurCourant, versionId: number, adresseIp: string | null): Promise<{ nom: string; contenu: Uint8Array }> {
  await exiger(acteur, "lire");
  const v = await obtenirPrisma().modeleVersion.findUnique({ where: { id: versionId }, select: { id: true, numero: true, pdf: true, modele: { select: { code: true } } } });
  if (!v?.pdf) throw new ErreurMetier("Pas de PDF : il est produit à la publication des conditions générales ou spéciales.");
  await journaliser({ acteur: auteur(acteur), action: "MODELE_TELECHARGE", objetType: "modele_version", objetId: v.id, apres: { modele: v.modele.code, numero: v.numero, fichier: "pdf" }, adresseIp });
  return { nom: `${v.modele.code}_v${v.numero}.pdf`, contenu: v.pdf };
}

// Emplacement d'image (gris, barré) pour l'aperçu : la vraie signature, le cachet et le QR code
// viendront avec l'émission des documents.
const IMAGE_APERCU = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAAAAAAfl4auAAABHklEQVR42qXXvRXDMAhFYfziOVJmimyg/bKJFnKZLhuksGzrBxBg+q98V0fLZ6PoPdftmYI2b6CUgzYRKKhzIgLFdE6044DOiQ7s1rst2KmLPbBLH/bEDn3aC5v1ZSts1JWtsUnXtsEG3dgWT3VrOzzRne2xqns7YEUPdsSiHi2DBc1YDrOasyxmNGt5PGjeCrjTgpVwoyUr4kqLVsanlq2Ci1ashill3dJKulYfMtCNg75ffd+YbF/VmG1f05h2Q9GYd0PWMDRH1LA0R9Iw9UrQsPWK1zC2jtUwto7VMFpWw2o5DbNlNOx21HDYQcNjew2X7TR8ttVw2kbDa2sNt600/PbSCNhTI2IPjZAtGjG768f7G/yUvfJvufMd/ANxTHcSW6x96AAAAABJRU5ErkJggg==",
  "base64",
);
const LARGEUR_IMAGE_MM: Record<string, number> = { qr_code: 25, signature_sim: 40, cachet_sim: 35 };

type Candidat = { modeleId: number; type: string; produitId: number | null; listeAnnexe: string | null; blocNom: string | null; blocCle: string | null };

/**
 * Pour l'aperçu : la version en vigueur de chaque sous-modèle et de chaque annexe (celle du produit
 * avant la commune), ou à défaut la dernière déposée, pour pouvoir essayer avant de publier.
 */
async function modelesAssocies(produitId: number | null, jour: DateIso) {
  const prisma = obtenirPrisma();
  const modeles = await prisma.modele.findMany({
    where: { type: { in: ["SOUS_MODELE", "ANNEXE"] }, OR: [{ produitId: null }, ...(produitId !== null ? [{ produitId }] : [])] },
    include: { versions: { select: champsVersion } },
    orderBy: { produitId: { sort: "asc", nulls: "first" } }, // le modèle du produit écrase le modèle commun
  });
  const choix = new Map<string, { versionId: number; m: Candidat }>();
  for (const m of modeles) {
    const versions = m.versions.map(cycle);
    const retenue = versionEnVigueur(versions, jour) ?? versions.reduce<VersionCycle | null>((max, v) => (!max || v.numero > max.numero ? v : max), null);
    if (!retenue) continue;
    const cle = m.type === "ANNEXE" ? `A:${m.listeAnnexe}` : `S:${m.blocNom}:${m.blocCle}`;
    choix.set(cle, { versionId: retenue.id, m: { modeleId: m.id, ...m } });
  }
  const fichiers = new Map(
    (await prisma.modeleVersion.findMany({ where: { id: { in: [...choix.values()].map((c) => c.versionId) } }, select: { id: true, fichier: true } })).map((f) => [f.id, f.fichier]),
  );
  const annexes: Record<string, Uint8Array> = {};
  const sousModeles: Record<string, Record<string, Uint8Array>> = {};
  for (const { versionId, m } of choix.values()) {
    const fichier = fichiers.get(versionId);
    if (!fichier) continue;
    if (m.type === "ANNEXE" && m.listeAnnexe) annexes[m.listeAnnexe] = fichier;
    if (m.type === "SOUS_MODELE" && m.blocNom && m.blocCle) (sousModeles[m.blocNom] ??= {})[m.blocCle] = fichier;
  }
  return { annexes, sousModeles };
}

/**
 * Aperçu PDF d'une version avec des données FICTIVES couvrant tout le dictionnaire (CDC §6.6 :
 * un brouillon s'utilise « seulement en aperçu avec données fictives »). `nombreAssures` au-delà
 * du seuil montre le renvoi en annexe des listes longues (T7).
 */
export async function apercuVersion(acteur: UtilisateurCourant, versionId: number, options: { nombreAssures: number }, adresseIp: string | null): Promise<{ nom: string; contenu: Uint8Array }> {
  await exiger(acteur, "lire");
  if (!Number.isInteger(options.nombreAssures) || options.nombreAssures < 0 || options.nombreAssures > 200) {
    throw new ErreurMetier("Nombre d'assurés fictifs : de 0 à 200.");
  }
  const prisma = obtenirPrisma();
  const v = await prisma.modeleVersion.findUnique({ where: { id: versionId }, include: { modele: { include: { produit: true } } } });
  if (!v) throw new ErreurMetier("Version de modèle introuvable.");
  const type = v.modele.type as TypeModele;
  const jour = aujourdhui();
  const seuilListe = await lireSeuilListe(jour);

  let contenu: Uint8Array;
  if (REGLES[type].fixe) {
    contenu =
      v.pdf ??
      (await generateur().genererPdf({
        modele: v.fichier,
        donnees: donneesFixes(type as "CG" | "CS", v.modele.libelle, v.visa ?? "", v.dateDocument ? depuisDate(v.dateDocument) : null),
        seuilListe,
      }));
  } else {
    const donnees = donneesExemple({ nombreAssures: options.nombreAssures });
    const p = v.modele.produit;
    if (p) donnees.produit = { ...(donnees.produit as object), code: p.code, libelle: p.libelle, gamme: p.gamme, branche: p.branche };
    const { annexes, sousModeles } = await modelesAssocies(v.modele.produitId, jour);
    const images: Record<string, ImagePng> = Object.fromEntries(IMAGES.map((nom) => [nom, { png: IMAGE_APERCU, largeurMm: LARGEUR_IMAGE_MM[nom] ?? 30 }]));
    contenu = await generateur().genererPdf({ modele: v.fichier, donnees, seuilListe, annexes, sousModeles, images });
  }
  await journaliser({ acteur: auteur(acteur), action: "MODELE_APERCU", objetType: "modele_version", objetId: v.id, apres: { modele: v.modele.code, numero: v.numero, nombreAssures: options.nombreAssures }, adresseIp });
  return { nom: `apercu_${v.modele.code}_v${v.numero}.pdf`, contenu };
}

// ---------------------------------------------------------------- Seuil des listes longues (CDC §6.5)

/** Seuil en vigueur à une date (paramètre historisé), 10 par défaut. */
export async function lireSeuilListe(date: DateIso = aujourdhui()): Promise<number> {
  const ligne = await obtenirPrisma().parametre.findFirst({
    where: { cle: CLE_SEUIL_LISTE, dateEffet: { lte: versDate(date) } },
    orderBy: { dateEffet: "desc" },
  });
  return ligne ? Number(ligne.valeur) : SEUIL_LISTE_DEFAUT;
}

export async function historiqueSeuilListe(acteur: UtilisateurCourant): Promise<{ valeur: number; dateEffet: DateIso; creePar: string }[]> {
  await exiger(acteur, "lire");
  const lignes = await obtenirPrisma().parametre.findMany({ where: { cle: CLE_SEUIL_LISTE }, orderBy: { dateEffet: "desc" } });
  return lignes.map((l) => ({ valeur: Number(l.valeur), dateEffet: depuisDate(l.dateEffet), creePar: l.creePar }));
}

export async function enregistrerSeuilListe(acteur: UtilisateurCourant, valeur: number, dateEffet: DateIso, adresseIp: string | null): Promise<void> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, "PARAMETRER_PRODUITS"))) {
    throw new ErreurAcces("Droit insuffisant : paramétrage.");
  }
  const problemes = problemesSeuil(valeur);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEffet)) problemes.push("Date d'effet invalide (AAAA-MM-JJ).");
  else if (dateEffet < aujourdhui()) problemes.push("La date d'effet ne peut pas être passée : un paramètre n'est jamais modifié rétroactivement.");
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const avant = await lireSeuilListe(dateEffet);
  try {
    await obtenirPrisma().$transaction(async (tx) => {
      await tx.parametre.create({ data: { cle: CLE_SEUIL_LISTE, valeur: String(valeur), dateEffet: versDate(dateEffet), creePar: acteur.identifiant } });
      await journaliser({ acteur: auteur(acteur), action: "PARAMETRE_MODIFIE", objetType: "parametre", objetId: CLE_SEUIL_LISTE, avant: { valeur: avant }, apres: { valeur, dateEffet }, adresseIp }, tx);
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier("Une valeur est déjà enregistrée à cette date d'effet.");
    }
    throw erreur;
  }
}
