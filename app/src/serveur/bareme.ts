import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import { aujourdhui, ajouterJours, type DateIso } from "@/domaine/calcul/dates";
import {
  VERSION_SCHEMA_BAREME,
  calculerBareme,
  jsonCanonique,
  lireBareme,
  rejouerJeuxEssai,
  schemaBareme,
  verifierBareme,
  type Bareme,
  type Ecart,
  type ParametresBareme,
  type Probleme,
  type ResultatBareme,
  type Saisie,
} from "@/domaine/bareme";

import { journaliser } from "./audit";
import { exigerEcriture, taxeEnVigueur, versVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Stockage et publication du barème d'une version de produit (session B3, D49 ; propositions-bareme.md §3 option c).
 * Un brouillon au plus par version, modifiable par la Technique ; la publication est un acte : le document est revalidé, ses jeux
 * d'essai sont rejoués (tous verts, sinon refus avec l'écart ligne à ligne), un motif est exigé, le publieur et l'avant/après sont
 * journalisés. Un barème publié ne se modifie plus (déclencheur) : une correction est une nouvelle version du produit.
 * Droit : celui du paramétrage des produits (Q8, défaut).
 */

type Client = Prisma.TransactionClient;

export const MESSAGE_BAREME_NON_PUBLIE = "Ce produit se tarife au barème, mais aucun barème n'est publié pour cette version : la Technique doit le publier avant tout calcul";
const LONGUEUR_MAX_MOTIF = 500;

/** Barème refusé à l'enregistrement : chaque problème porte un code (SCHEMA, TABLE_INCOMPLETE, CYCLE…) et un message en français. */
export class ErreurBaremeInvalide extends ErreurMetier {
  override name = "ErreurBaremeInvalide";
  constructor(readonly problemes: Probleme[]) {
    super(
      `Barème invalide : ${problemes.length} problème(s).`,
      problemes.map((p) => `[${p.code}] ${p.message}`),
    );
  }
}

export const decrireEcart = (e: Ecart): string => `Essai « ${e.essai} »${e.ligne ? `, ligne « ${e.ligne} »` : ""}, ${e.champ} : attendu ${e.attendu}, obtenu ${e.obtenu}`;

/** Publication refusée parce qu'un jeu d'essai ne retombe pas sur ses chiffres : les écarts sont donnés ligne à ligne. */
export class ErreurPublicationBareme extends ErreurMetier {
  override name = "ErreurPublicationBareme";
  constructor(readonly ecarts: Ecart[]) {
    super(`Publication refusée : ${ecarts.length} écart(s) entre les jeux d'essai et le calcul du barème.`, ecarts.map(decrireEcart));
  }
}

/** SHA-256 (hexadécimal) du JSON canonique du document. */
export const empreinteBareme = (contenu: unknown): string => createHash("sha256").update(jsonCanonique(contenu), "utf8").digest("hex");

/** Validation complète d'un document : schéma zod, puis intégrité (`verifierBareme`). Renvoie le barème lu, ou lève `ErreurBaremeInvalide`. */
export function validerDocumentBareme(document: unknown, options: { publication?: boolean } = {}): Bareme {
  const lu = schemaBareme.safeParse(document);
  if (!lu.success) {
    throw new ErreurBaremeInvalide(lu.error.issues.map((i) => ({ code: "SCHEMA", message: `${i.path.length > 0 ? i.path.join(".") : "(document)"} : ${i.message}` })));
  }
  const problemes = verifierBareme(lu.data, options);
  if (problemes.length > 0) throw new ErreurBaremeInvalide(problemes);
  return lu.data;
}

async function verrouillerVersion(tx: Client, versionId: number) {
  // Verrou de ligne sur la version : deux enregistrements ou deux publications simultanés d'une même version s'enchaînent.
  await tx.$queryRaw`SELECT id FROM produit_versions WHERE id = ${versionId} FOR NO KEY UPDATE`;
  const v = await tx.produitVersion.findUnique({ where: { id: versionId }, include: { formules: true } });
  if (!v) throw new ErreurMetier("Version de produit introuvable.");
  if (v.modeTarification !== "BAREME") throw new ErreurMetier("Cette version de produit n'est pas tarifée au barème : un barème ne se rattache qu'à une version en mode BAREME.");
  return v;
}

type VersionChargee = Awaited<ReturnType<typeof verrouillerVersion>>;

/**
 * Règles du produit que le barème ne porte pas, lues dans la version : arrondi et prorata. Les taux de taxe sont ceux en vigueur
 * à la date de l'essai (régime individuel). La période d'essai est d'un an qui commence à la date d'effet de la version, ou
 * aujourd'hui si elle est passée (H137).
 */
async function parametresDEssai(tx: Client, version: VersionChargee, bareme: Bareme): Promise<ParametresBareme> {
  const lue = versVersion(version);
  const dateEffet: DateIso = lue.dateEffet > aujourdhui() ? lue.dateEffet : aujourdhui();
  const categories = new Set<string>([bareme.produit.taxe, ...bareme.garanties.flatMap((g) => (g.taxe ? [g.taxe] : []))]);
  const taxes: ParametresBareme["taxes"] = {};
  for (const code of categories) {
    const t = await taxeEnVigueur(tx, code, "INDIVIDUEL", dateEffet);
    taxes[code] = { tauxPourcent: t.tauxPourcent, assiette: t.assiette };
  }
  return { arrondi: lue.arrondi, prorata: { actif: lue.prorata.actif }, dateEffet, dateEcheance: ajouterJours(dateEffet, 364), taxes };
}

const resume = (b: Bareme) => ({ garanties: b.garanties.length, champs: b.champs.length, jeuxEssai: b.jeuxEssai.length });
const enJson = (b: Bareme) => JSON.parse(jsonCanonique(b)) as Prisma.InputJsonValue;

/**
 * Enregistre le brouillon du barème d'une version (le crée, ou remplace le contenu du brouillon existant). Le document doit passer
 * le schéma et `verifierBareme` : sinon `ErreurBaremeInvalide`, sans rien écrire. Refusé si la version a déjà un barème publié.
 */
export async function enregistrerBrouillonBareme(acteur: UtilisateurCourant, versionId: number, document: unknown, adresseIp: string | null): Promise<{ id: number; empreinte: string }> {
  await exigerEcriture(acteur);
  const bareme = validerDocumentBareme(document);
  const empreinte = empreinteBareme(bareme);

  return obtenirPrisma().$transaction(async (tx) => {
    await verrouillerVersion(tx, versionId);
    if (await tx.baremeDocument.findFirst({ where: { versionId, statut: "PUBLIE" }, select: { id: true } })) {
      throw new ErreurMetier("Cette version a déjà un barème publié, qui ne se modifie plus : une correction est une nouvelle version du produit.");
    }
    const existant = await tx.baremeDocument.findFirst({ where: { versionId, statut: "BROUILLON" } });
    const ligne = existant
      ? await tx.baremeDocument.update({ where: { id: existant.id }, data: { contenu: enJson(bareme), empreinte, schemaVersion: VERSION_SCHEMA_BAREME, modifieLe: new Date() } })
      : await tx.baremeDocument.create({ data: { versionId, statut: "BROUILLON", contenu: enJson(bareme), empreinte, schemaVersion: VERSION_SCHEMA_BAREME, creePar: acteur.identifiant } });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "bareme_document",
        objetId: ligne.id,
        avant: existant ? { statut: "BROUILLON", empreinte: existant.empreinte } : undefined,
        apres: { versionId, statut: "BROUILLON", empreinte, ...resume(bareme) },
        adresseIp,
      },
      tx,
    );
    return { id: ligne.id, empreinte };
  });
}

/**
 * Rejoue les jeux d'essai du brouillon de la version (ou, à défaut, du barème publié) et rend les écarts : liste vide = tous verts.
 * Le barème est revalidé comme à la publication. Ne modifie rien.
 */
export async function rejouerLesEssaisBareme(acteur: UtilisateurCourant, versionId: number): Promise<Ecart[]> {
  await exigerEcriture(acteur);
  return obtenirPrisma().$transaction(async (tx) => {
    const version = await verrouillerVersion(tx, versionId);
    const ligne = (await tx.baremeDocument.findFirst({ where: { versionId, statut: "BROUILLON" } })) ?? (await tx.baremeDocument.findFirst({ where: { versionId, statut: "PUBLIE" } }));
    if (!ligne) throw new ErreurMetier("Cette version n'a pas de barème : enregistrez d'abord un brouillon.");
    const bareme = validerDocumentBareme(ligne.contenu, { publication: true });
    return rejouerJeuxEssai(bareme, await parametresDEssai(tx, version, bareme));
  });
}

/**
 * Publie le brouillon de la version, dans une transaction : revalidation (au moins un jeu d'essai), jeux d'essai tous verts (sinon
 * `ErreurPublicationBareme` avec les écarts), motif obligatoire, empreinte recalculée, publieur et avant/après journalisés.
 * Le verrou de ligne sur la version fait attendre une seconde publication simultanée, qui ne trouve plus de brouillon.
 */
export async function publierBareme(acteur: UtilisateurCourant, versionId: number, motif: string, adresseIp: string | null): Promise<{ id: number; empreinte: string }> {
  await exigerEcriture(acteur);
  const motifPropre = motif.trim();
  if (motifPropre.length === 0) throw new ErreurMetier("Le motif de publication est obligatoire.");
  if (motifPropre.length > LONGUEUR_MAX_MOTIF) throw new ErreurMetier(`Le motif de publication est limité à ${LONGUEUR_MAX_MOTIF} caractères.`);

  return obtenirPrisma().$transaction(async (tx) => {
    const version = await verrouillerVersion(tx, versionId);
    const brouillon = await tx.baremeDocument.findFirst({ where: { versionId, statut: "BROUILLON" } });
    if (!brouillon) {
      const publie = await tx.baremeDocument.findFirst({ where: { versionId, statut: "PUBLIE" }, select: { id: true } });
      throw new ErreurMetier(publie ? "Le barème de cette version est déjà publié." : "Cette version n'a pas de brouillon de barème à publier.");
    }
    const bareme = validerDocumentBareme(brouillon.contenu, { publication: true });
    const ecarts = rejouerJeuxEssai(bareme, await parametresDEssai(tx, version, bareme));
    if (ecarts.length > 0) throw new ErreurPublicationBareme(ecarts);

    const empreinte = empreinteBareme(bareme);
    const publieLe = new Date();
    await tx.baremeDocument.update({
      where: { id: brouillon.id },
      data: { statut: "PUBLIE", contenu: enJson(bareme), empreinte, schemaVersion: VERSION_SCHEMA_BAREME, publiePar: acteur.identifiant, publieLe, motifPublication: motifPropre, modifieLe: publieLe },
    });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "bareme_document",
        objetId: brouillon.id,
        avant: { versionId, statut: "BROUILLON", empreinte: brouillon.empreinte },
        apres: { versionId, statut: "PUBLIE", empreinte, motif: motifPropre, publiePar: acteur.identifiant, ...resume(bareme) },
        adresseIp,
      },
      tx,
    );
    return { id: brouillon.id, empreinte };
  });
}

export type BaremePublie = { id: number; bareme: Bareme; empreinte: string };

/**
 * Le barème publié d'une version, relu et contrôlé (schéma, empreinte recalculée). C'est le SEUL chemin par lequel un calcul au
 * barème obtient son barème : une version BAREME sans barème publié refuse (`MESSAGE_BAREME_NON_PUBLIE`), jamais de montant par défaut.
 */
export async function lireBaremePublie(client: Pick<Client, "baremeDocument">, versionId: number): Promise<BaremePublie> {
  const ligne = await client.baremeDocument.findFirst({ where: { versionId, statut: "PUBLIE" } });
  if (!ligne) throw new ErreurMetier(MESSAGE_BAREME_NON_PUBLIE);
  if (ligne.schemaVersion !== VERSION_SCHEMA_BAREME) {
    throw new ErreurMetier(`Le barème publié (schéma ${ligne.schemaVersion}) n'est pas lisible par cette version de l'application (schéma ${VERSION_SCHEMA_BAREME}).`);
  }
  if (empreinteBareme(ligne.contenu) !== ligne.empreinte) {
    throw new ErreurMetier("Le barème publié ne correspond plus à son empreinte : il a été altéré hors de l'application. Aucun calcul n'est fait.");
  }
  return { id: ligne.id, bareme: lireBareme(ligne.contenu), empreinte: ligne.empreinte };
}

/** Calcul d'une saisie au barème publié de la version : le résultat du moteur et l'empreinte du barème utilisé (à figer avec la cotation, B6). */
export async function calculerAvecBaremePublie(
  client: Pick<Client, "baremeDocument">,
  versionId: number,
  saisie: Saisie,
  parametres: ParametresBareme,
): Promise<{ empreinte: string; resultat: ResultatBareme }> {
  const { bareme, empreinte } = await lireBaremePublie(client, versionId);
  return { empreinte, resultat: calculerBareme(bareme, saisie, parametres) };
}
