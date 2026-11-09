import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { baremeVide, schemaBareme, VERSION_SCHEMA_BAREME, verifierBareme, type Bareme, type Probleme } from "@/domaine/bareme";
import { aujourdhui, dateValide, formaterDate, type DateIso } from "@/domaine/calcul/dates";
import { DATE_EFFET_A_LA_PUBLICATION, estEffetALaPublication, problemesVersion, type VersionSaisie } from "@/domaine/calcul/parametrage";

import { journaliser } from "./audit";
import { depuisDate, empreinteBareme, enJson, exigerPreparable, exigerVersionAuBareme, motifValide, publierDansTransaction, resume, verrouillerVersion } from "./bareme";
import { creerVersionDansTransaction, exigerEcriture, versVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Barème d'une version, côté ÉCRAN d'édition (session B4, D58). L'écran édite le même document que l'import (`bareme_documents`,
 * BROUILLON), validé par le même schéma et la même `verifierBareme` : ce fichier n'a aucune règle de barème, seulement des gardes de
 * parcours (qui peut éditer quoi, quand) et la copie d'un barème publié dans une NOUVELLE version (H157, D49).
 */

export type BaremePourEdition = {
  produit: { code: string; libelle: string; branche: string };
  version: { id: number; dateEffet: DateIso; modeTarification: string };
  /** La version peut encore recevoir un barème (pas en vigueur dans un autre mode). */
  preparable: boolean;
  brouillon: { id: number; contenu: unknown; empreinte: string; modifieLe: Date; creePar: string } | null;
  publie: { id: number; contenu: unknown; empreinte: string; publieLe: Date; publiePar: string; motif: string } | null;
  /** Codes de champs et de valeurs intermédiaires qui figurent dans un barème PUBLIÉ de ce produit (toutes versions) : ils ne se renomment plus. */
  codesFiges: string[];
  /** Catégories de taxe (branches fiscales) proposées aux garanties. */
  categoriesTaxe: string[];
  /** Problèmes d'intégrité du brouillon tel qu'enregistré (les contrôles se recalculent ensuite à l'écran, à chaque modification). */
  problemes: Probleme[];
};

/** Barème d'une version pour l'écran : brouillon (modifiable) et/ou publié (lecture), plus de quoi savoir quels codes sont figés. */
export async function lireBaremePourEdition(acteur: UtilisateurCourant, versionId: number): Promise<BaremePourEdition | null> {
  await exigerEcriture(acteur);
  const prisma = obtenirPrisma();
  const v = await prisma.produitVersion.findUnique({ where: { id: versionId }, include: { produit: true } });
  if (!v) return null;
  const [lignes, publiesDuProduit, branches] = await Promise.all([
    prisma.baremeDocument.findMany({ where: { versionId } }),
    prisma.baremeDocument.findMany({ where: { statut: "PUBLIE", version: { produitId: v.produitId } }, select: { contenu: true } }),
    prisma.branche.findMany({ select: { code: true }, orderBy: { code: "asc" } }),
  ]);
  const b = lignes.find((l) => l.statut === "BROUILLON");
  const p = lignes.find((l) => l.statut === "PUBLIE");
  const codesFiges = new Set<string>();
  for (const l of publiesDuProduit) {
    const lu = schemaBareme.safeParse(l.contenu);
    if (!lu.success) continue;
    for (const c of lu.data.champs) codesFiges.add(c.code);
    for (const i of lu.data.intermediaires) codesFiges.add(i.code);
  }
  const lu = b ? schemaBareme.safeParse(b.contenu) : null;
  return {
    produit: { code: v.produit.code, libelle: v.produit.libelle, branche: v.produit.branche },
    version: { id: v.id, dateEffet: depuisDate(v.dateEffet), modeTarification: v.modeTarification },
    preparable: v.modeTarification === "BAREME" || depuisDate(v.dateEffet) > aujourdhui(),
    brouillon: b ? { id: b.id, contenu: b.contenu, empreinte: b.empreinte, modifieLe: b.modifieLe, creePar: b.creePar } : null,
    publie: p && p.publieLe && p.publiePar ? { id: p.id, contenu: p.contenu, empreinte: p.empreinte, publieLe: p.publieLe, publiePar: p.publiePar, motif: p.motifPublication ?? "" } : null,
    codesFiges: [...codesFiges],
    categoriesTaxe: branches.map((x) => x.code),
    problemes: lu?.success ? verifierBareme(lu.data) : [],
  };
}

/**
 * « Créer un barème vide » : un brouillon neuf sur une version qui n'a encore AUCUN barème (ni brouillon, ni publié) et qui peut en
 * recevoir un. Le document vide est celui de `baremeVide` (une garantie sans montant, la catégorie de taxe du produit).
 */
export async function creerBaremeVide(acteur: UtilisateurCourant, versionId: number, adresseIp: string | null): Promise<{ id: number; empreinte: string }> {
  await exigerEcriture(acteur);
  return obtenirPrisma().$transaction(async (tx) => {
    const version = await verrouillerVersion(tx, versionId);
    exigerPreparable(version);
    exigerVersionAuBareme(version.modeTarification);
    if (await tx.baremeDocument.findFirst({ where: { versionId }, select: { id: true } })) {
      throw new ErreurMetier("Cette version a déjà un barème : ouvrez-le pour le modifier à l'écran.");
    }
    const produit = await tx.produit.findUniqueOrThrow({ where: { id: version.produitId }, select: { branche: true } });
    const bareme: Bareme = schemaBareme.parse(baremeVide(produit.branche));
    const empreinte = empreinteBareme(bareme);
    const ligne = await tx.baremeDocument.create({
      data: { versionId, statut: "BROUILLON", contenu: enJson(bareme), empreinte, schemaVersion: VERSION_SCHEMA_BAREME, creePar: acteur.identifiant },
    });
    await journaliser(
      { acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "PARAMETRE_MODIFIE", objetType: "bareme_document", objetId: ligne.id, apres: { versionId, statut: "BROUILLON", empreinte, origine: "BAREME_VIDE", ...resume(bareme) }, adresseIp },
      tx,
    );
    return { id: ligne.id, empreinte };
  });
}

/** Date d'effet demandée pour une version au barème : vide ou « dès la publication » (date provisoire, D66), sinon une date postérieure à aujourd'hui. */
function dateEffetDemandee(dateEffet: string): DateIso {
  const date = dateEffet.trim();
  if (date === "" || estEffetALaPublication(date)) return DATE_EFFET_A_LA_PUBLICATION;
  if (!dateValide(date)) throw new ErreurMetier("La date d'effet est invalide : saisissez-la en JJ/MM/AAAA, ou choisissez « dès la publication ».");
  if (date <= aujourdhui()) {
    throw new ErreurMetier("La date d'effet d'une version au barème est « dès la publication » ou une date postérieure à aujourd'hui : une version ne prend jamais effet rétroactivement.");
  }
  return date;
}

/** Le barème publié le plus récent d'un produit (par date d'effet de sa version), relu et contrôlé ; `null` si le produit n'en a pas. */
async function baremePublieLePlusRecent(tx: Prisma.TransactionClient, produitId: number) {
  const publie = await tx.baremeDocument.findFirst({ where: { statut: "PUBLIE", version: { produitId } }, orderBy: { version: { dateEffet: "desc" } } });
  if (!publie) return null;
  if (publie.schemaVersion !== VERSION_SCHEMA_BAREME || empreinteBareme(publie.contenu) !== publie.empreinte) {
    throw new ErreurMetier("Le barème publié ne correspond plus à son empreinte : il a été altéré hors de l'application. Aucune copie n'est faite.");
  }
  return { ligne: publie, bareme: schemaBareme.parse(publie.contenu) };
}

/** Copie un barème publié en BROUILLON de la version `versionId` (même contenu, donc même empreinte) et le journalise. */
async function copierEnBrouillon(tx: Prisma.TransactionClient, acteur: UtilisateurCourant, versionId: number, source: { versionId: number; empreinte: string; bareme: Bareme }, adresseIp: string | null) {
  const ligne = await tx.baremeDocument.create({
    data: { versionId, statut: "BROUILLON", contenu: enJson(source.bareme), empreinte: empreinteBareme(source.bareme), schemaVersion: VERSION_SCHEMA_BAREME, creePar: acteur.identifiant },
  });
  await journaliser(
    {
      acteur: { id: acteur.id, identifiant: acteur.identifiant },
      action: "PARAMETRE_MODIFIE",
      objetType: "bareme_document",
      objetId: ligne.id,
      apres: { versionId, statut: "BROUILLON", empreinte: ligne.empreinte, origine: "COPIE_DU_PUBLIE", copieDe: { versionId: source.versionId, empreinte: source.empreinte }, ...resume(source.bareme) },
      adresseIp,
    },
    tx,
  );
  return ligne;
}

/**
 * Un barème PUBLIÉ ne se modifie jamais (D49) : sa correction est une NOUVELLE version du produit (H157). Crée cette version par le service
 * de création de version existant (mêmes contrôles, même journal, paramètres de la dernière version comme un ajout ordinaire), AU BARÈME et « en
 * préparation » (D66, plus de version provisoire « Par garanties »), puis y copie le barème publié en BROUILLON. Sa date d'effet est « dès la
 * publication » (défaut : `dateEffet` vide) ou une date postérieure à aujourd'hui. Tout dans une transaction : la version n'existe pas sans sa
 * copie. Le publié d'origine et les cotations qui le citent ne sont pas touchés ; la version précédente continue de servir jusqu'à la publication.
 *
 * Le produit qui a un barème publié est un produit au barème : la correction est donc permise même si sa dernière version est restée « Par garanties »
 * (réparation d'une version provisoire d'avant D66, H140 : la seule façon de revenir au barème sans changer le mode d'une version existante).
 */
export async function creerVersionDepuisBareme(acteur: UtilisateurCourant, versionSourceId: number, dateEffet: string, adresseIp: string | null): Promise<{ versionId: number; codeProduit: string }> {
  await exigerEcriture(acteur);
  const date = dateEffetDemandee(dateEffet);

  return obtenirPrisma().$transaction(async (tx) => {
    const source = await tx.produitVersion.findUnique({ where: { id: versionSourceId }, include: { produit: true } });
    if (!source) throw new ErreurMetier("Version de produit introuvable.");
    const publie = await tx.baremeDocument.findFirst({ where: { versionId: versionSourceId, statut: "PUBLIE" } });
    if (!publie) throw new ErreurMetier("Seul un barème publié se corrige par une nouvelle version : un brouillon se modifie directement.");
    if (publie.schemaVersion !== VERSION_SCHEMA_BAREME || empreinteBareme(publie.contenu) !== publie.empreinte) {
      throw new ErreurMetier("Le barème publié ne correspond plus à son empreinte : il a été altéré hors de l'application. Aucune copie n'est faite.");
    }
    const bareme = schemaBareme.parse(publie.contenu);
    await tx.$queryRaw`SELECT id FROM produits WHERE id = ${source.produitId} FOR NO KEY UPDATE`;

    // Une version à venir (ou « dès la publication ») qui a déjà un barème (brouillon ou publié) : on l'ouvre, on n'en crée pas une autre.
    const avenir = await tx.produitVersion.findMany({
      where: { produitId: source.produitId, id: { not: versionSourceId }, baremes: { some: {} } },
      include: { baremes: { select: { statut: true } } },
      orderBy: { dateEffet: "asc" },
    });
    const deja = avenir.find((x) => depuisDate(x.dateEffet) > aujourdhui());
    if (deja) {
      const etat = deja.baremes.some((x) => x.statut === "PUBLIE") ? "un barème publié" : "un brouillon de barème";
      const quand = estEffetALaPublication(depuisDate(deja.dateEffet)) ? "« dès la publication » (en préparation)" : `du ${formaterDate(depuisDate(deja.dateEffet))} (à venir)`;
      throw new ErreurMetier(`La version ${quand} a déjà ${etat} : ouvrez-la sur la fiche du produit plutôt que d'en créer une autre.`);
    }
    if (estEffetALaPublication(date) && (await tx.produitVersion.findUnique({ where: { produitId_dateEffet: { produitId: source.produitId, dateEffet: versDate(date) } }, select: { id: true } }))) {
      throw new ErreurMetier("Une version « dès la publication » est déjà en préparation pour ce produit : ouvrez-la sur la fiche du produit, ou publiez-la d'abord.");
    }

    // Paramètres de la dernière version RETENUE (D66) : une version au barème en préparation n'est pas encore un paramétrage qui sert.
    const derniere = await tx.produitVersion.findFirstOrThrow({
      where: { produitId: source.produitId, NOT: { modeTarification: "BAREME", baremes: { none: { statut: "PUBLIE" } } } },
      orderBy: { dateEffet: "desc" },
      include: { formules: true, baremes: { select: { statut: true } } },
    });
    // Mêmes paramètres qu'un ajout ordinaire (pré-remplissage par la dernière version), AU BARÈME (D66).
    const saisie: VersionSaisie = { ...versVersion(derniere), dateEffet: date, modeTarification: "BAREME", garanties: [], garantiesSaisieLibre: true };
    const problemes = problemesVersion(saisie);
    if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

    const versionId = await creerVersionDansTransaction(tx, acteur, source.produit.code, saisie, adresseIp);
    await copierEnBrouillon(tx, acteur, versionId, { versionId: versionSourceId, empreinte: publie.empreinte, bareme }, adresseIp);
    return { versionId, codeProduit: source.produit.code };
  });
}

/**
 * « Ajouter une version » sur un produit AU BARÈME (D66), dans la transaction de `creerVersion` (mode déjà contrôlé, saisie déjà validée) :
 *  - le produit n'a encore aucun barème publié : la version naît « en préparation », sans barème (la Technique le crée, l'importe, le publie) ;
 *  - sinon : elle reprend le barème publié le plus récent (copie, même empreinte), rejoue ses essais avec les paramètres de la saisie, et SE PUBLIE
 *    aussitôt si tout est vert (motif obligatoire), « dès la publication » ou à la date future saisie. Un essai rouge, un doublon de date ou un
 *    motif manquant annulent tout : aucune version n'est créée.
 */
export async function creerVersionAuBaremeDansTransaction(tx: Prisma.TransactionClient, acteur: UtilisateurCourant, codeProduit: string, saisie: VersionSaisie, motifPublication: string, adresseIp: string | null): Promise<{ versionId: number; publiee: boolean }> {
  const date = dateEffetDemandee(saisie.dateEffet);
  const produit = await tx.produit.findUniqueOrThrow({ where: { code: codeProduit }, select: { id: true } });
  const source = await baremePublieLePlusRecent(tx, produit.id);
  const motif = source ? motifValide(motifPublication) : "";
  if (estEffetALaPublication(date) && (await tx.produitVersion.findUnique({ where: { produitId_dateEffet: { produitId: produit.id, dateEffet: versDate(date) } }, select: { id: true } }))) {
    throw new ErreurMetier("Une version « dès la publication » est déjà en préparation pour ce produit : ouvrez-la sur la fiche du produit, ou publiez-la d'abord.");
  }

  const versionId = await creerVersionDansTransaction(tx, acteur, codeProduit, { ...saisie, dateEffet: date, modeTarification: "BAREME" }, adresseIp);
  if (!source) return { versionId, publiee: false };

  await copierEnBrouillon(tx, acteur, versionId, { versionId: source.ligne.versionId, empreinte: source.ligne.empreinte, bareme: source.bareme }, adresseIp);
  const issue = await publierDansTransaction(tx, acteur, versionId, motif, adresseIp, { journaliserLesRefus: false });
  if ("erreur" in issue) throw issue.erreur;
  return { versionId, publiee: true };
}
