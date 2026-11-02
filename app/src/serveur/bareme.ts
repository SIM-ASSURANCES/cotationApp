import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import { aujourdhui, ajouterJours, type DateIso } from "@/domaine/calcul/dates";
import { estCompositionBareme } from "@/domaine/calcul/composition";
import { versionEnVigueur, type StatutVersion, type VersionCycle } from "@/domaine/documents/modeles";
import type { RegimeTaxe } from "@/domaine/calcul/taxes";
import {
  VERSION_SCHEMA_BAREME,
  aDejaLeDetail,
  balisesSansCle,
  calculerBareme,
  codesRisqueDuBareme,
  garantiesExempleDuBareme,
  compositionAvecDetail,
  jsonCanonique,
  lireBareme,
  rejouerJeuxEssai,
  renommagesInterdits,
  resumeBareme,
  risqueCodeDuBareme,
  risqueDuBareme,
  risqueExempleDuBareme,
  schemaBareme,
  verifierBareme,
  type Bareme,
  type ControlesDePublication,
  type Ecart,
  type ParametresBareme,
  type Probleme,
  type ResultatBareme,
  type Saisie,
} from "@/domaine/bareme";

import { journaliser } from "./audit";
import { exigerEcriture, taxeEnVigueur, versVersion, type VersionProduit } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Stockage et publication du barème d'une version de produit (session B3, D49 ; propositions-bareme.md §3 option c).
 * Un brouillon au plus par version, modifiable par la Technique ; la publication est un acte : le document est revalidé, ses jeux
 * d'essai sont rejoués (tous verts, sinon refus avec l'écart ligne à ligne), un motif est exigé, le publieur et l'avant/après sont
 * journalisés. Un barème publié ne se modifie plus (déclencheur) : une correction est une nouvelle version du produit.
 * Droit : celui du paramétrage des produits (Q8, défaut).
 */

export type Client = Prisma.TransactionClient;

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

/** Publication refusée parce qu'un modèle publié en vigueur cite une balise `risque.<code>` que le nouveau barème n'a plus (B5, ajout 9). */
export class ErreurBalisesAbsentes extends ErreurMetier {
  override name = "ErreurBalisesAbsentes";
  constructor(readonly balises: string[]) {
    super(`Publication refusée : ${balises.length} balise(s) de modèles publiés en vigueur n'ont plus de champ dans ce barème. Rétablissez le champ, ou faites publier un modèle corrigé.`, balises.map((b) => `Le ${b}`));
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

export async function verrouillerVersion(tx: Client, versionId: number) {
  // Verrou de ligne sur la version : deux enregistrements ou deux publications simultanés d'une même version s'enchaînent.
  await tx.$queryRaw`SELECT id FROM produit_versions WHERE id = ${versionId} FOR NO KEY UPDATE`;
  const v = await tx.produitVersion.findUnique({ where: { id: versionId }, include: { formules: true } });
  if (!v) throw new ErreurMetier("Version de produit introuvable.");
  return v;
}

type VersionChargee = Awaited<ReturnType<typeof verrouillerVersion>>;

export const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

/**
 * Un barème se prépare avant la mise en vigueur de sa version (créée dans un autre mode, à une date future), puis la version
 * bascule au barème ; une version déjà au barème (B3) reste préparable. Une version en vigueur dans un autre mode, jamais.
 */
export function exigerPreparable(v: VersionChargee): void {
  if (v.modeTarification !== "BAREME" && depuisDate(v.dateEffet) <= aujourdhui()) {
    throw new ErreurMetier("Cette version est déjà en vigueur dans un autre mode : elle ne peut plus recevoir de barème. Créez une nouvelle version, à une date d'effet postérieure à aujourd'hui.");
  }
}

/**
 * Règles du produit que le barème ne porte pas, lues dans la version : arrondi et prorata. Les taux de taxe sont ceux en vigueur
 * à la date de l'essai (régime individuel). La période d'essai est d'un an qui commence à la date d'effet de la version, ou
 * aujourd'hui si elle est passée (H137).
 */
async function parametresDEssai(tx: Client, version: VersionChargee, bareme: Bareme): Promise<ParametresBareme> {
  const lue = versVersion(version);
  const dateEffet: DateIso = lue.dateEffet > aujourdhui() ? lue.dateEffet : aujourdhui();
  return parametresDeCalcul(tx, lue, bareme, "INDIVIDUEL", dateEffet, ajouterJours(dateEffet, 364));
}

/**
 * Paramètres d'un calcul au barème : arrondi et prorata de la version du produit, taux de taxe de chaque catégorie du barème
 * (régime de taxe de la cotation, en vigueur à la date d'effet). Une catégorie sans taux en vigueur arrête le calcul.
 */
export async function parametresDeCalcul(
  client: Parameters<typeof taxeEnVigueur>[0],
  version: VersionProduit,
  bareme: Bareme,
  regime: RegimeTaxe,
  dateEffet: DateIso,
  dateEcheance: DateIso,
): Promise<ParametresBareme> {
  const categories = new Set<string>([bareme.produit.taxe, ...bareme.garanties.flatMap((g) => (g.taxe ? [g.taxe] : []))]);
  const taxes: ParametresBareme["taxes"] = {};
  for (const code of categories) {
    const t = await taxeEnVigueur(client, code, regime, dateEffet);
    taxes[code] = { tauxPourcent: t.tauxPourcent, assiette: t.assiette };
  }
  return { arrondi: version.arrondi, prorata: { actif: version.prorata.actif }, dateEffet, dateEcheance, taxes };
}

/** Résumé d'un barème pour le journal (avant / après) : de quoi lire ce qui a changé sans recopier le document. */
export const resume = resumeBareme;
/** Résumé d'un contenu déjà stocké (journal, « avant ») ; vide si le contenu n'est pas lisible. */
function resumeDuContenu(contenu: unknown): Partial<ReturnType<typeof resume>> {
  const lu = schemaBareme.safeParse(contenu);
  return lu.success ? resume(lu.data) : {};
}
export const enJson = (b: Bareme) => JSON.parse(jsonCanonique(b)) as Prisma.InputJsonValue;

/**
 * Barème PUBLIÉ dont le brouillon d'une version est issu : celui de la version publiée la plus récente du même produit qui précède cette
 * version (B5, ajout 10). `null` : le produit n'a pas de barème publié avant elle, rien n'est figé.
 */
async function baremeDOrigine(tx: Client, version: VersionChargee): Promise<Bareme | null> {
  const ligne = await tx.baremeDocument.findFirst({
    where: { statut: "PUBLIE", version: { produitId: version.produitId, dateEffet: { lt: version.dateEffet } } },
    orderBy: { version: { dateEffet: "desc" } },
  });
  if (!ligne) return null;
  const lu = schemaBareme.safeParse(ligne.contenu);
  return lu.success ? lu.data : null;
}

/**
 * Balises `risque.<code>` / `risque_code.<code>` citées par les modèles PUBLIÉS en vigueur du produit (CP, cotation, certificat) qui n'ont pas
 * de clé dans ce barème (B5, ajout 9). « En vigueur » : à la date d'effet de la version du barème, ou aujourd'hui si elle est passée ; la
 * liste des clés est celle de l'émission (`codesRisqueDuBareme`). Chaque entrée nomme le modèle, sa version et la balise.
 */
export async function balisesDesModelesSansCle(client: Pick<Client, "modeleVersion">, produitId: number, dateEffetVersion: DateIso, bareme: Bareme): Promise<string[]> {
  const jour = dateEffetVersion > aujourdhui() ? dateEffetVersion : aujourdhui();
  const versions = await client.modeleVersion.findMany({
    where: { statut: "PUBLIE", modele: { produitId, type: { in: ["CP", "COTATION", "CERTIFICAT"] } } },
    select: { id: true, numero: true, statut: true, dateEffet: true, auteurId: true, analyse: true, modeleId: true, modele: { select: { code: true, type: true } } },
  });
  type Ligne = (typeof versions)[number];
  const parModele = new Map<number, Ligne[]>();
  for (const v of versions) parModele.set(v.modeleId, [...(parModele.get(v.modeleId) ?? []), v]);
  const publies: { description: string; chemins: string[] }[] = [];
  for (const groupe of parModele.values()) {
    const cycles = groupe.map((v): VersionCycle & { source: Ligne } => ({ id: v.id, numero: v.numero, statut: v.statut as StatutVersion, dateEffet: depuisDate(v.dateEffet), auteurId: v.auteurId, source: v }));
    const enVigueur = versionEnVigueur(cycles, jour);
    if (enVigueur) {
      const v = enVigueur.source;
      publies.push({ description: `modèle ${v.modele.type} ${v.modele.code} v${v.numero}`, chemins: ((v.analyse as { champs?: string[] }).champs ?? []) as string[] });
    }
  }
  return balisesSansCle(publies, bareme);
}

/**
 * Enregistre le brouillon du barème d'une version (le crée, ou remplace le contenu du brouillon existant). Le document doit passer
 * le schéma et `verifierBareme` : sinon `ErreurBaremeInvalide`, sans rien écrire. Refusé si la version a déjà un barème publié.
 *
 * `options.toleranceIntegrite` (écran d'édition, B4, H158) : le schéma reste exigé, mais les problèmes d'intégrité de `verifierBareme`
 * (table incomplète, taux sans sous-jacent…) n'empêchent pas d'enregistrer un travail en cours ; ils sont rendus dans `problemes` et
 * continuent d'interdire la PUBLICATION (qui revalide tout). L'import garde l'exigence entière.
 */
export async function enregistrerBrouillonBareme(
  acteur: UtilisateurCourant,
  versionId: number,
  document: unknown,
  adresseIp: string | null,
  options: { toleranceIntegrite?: boolean } = {},
): Promise<{ id: number; empreinte: string; problemes: Probleme[] }> {
  await exigerEcriture(acteur);
  let bareme: Bareme;
  let problemes: Probleme[] = [];
  if (options.toleranceIntegrite) {
    const lu = schemaBareme.safeParse(document);
    if (!lu.success) {
      throw new ErreurBaremeInvalide(lu.error.issues.map((i) => ({ code: "SCHEMA", message: `${i.path.length > 0 ? i.path.join(".") : "(document)"} : ${i.message}` })));
    }
    bareme = lu.data;
    problemes = verifierBareme(bareme);
  } else bareme = validerDocumentBareme(document);
  const empreinte = empreinteBareme(bareme);

  return obtenirPrisma().$transaction(async (tx) => {
    const version = await verrouillerVersion(tx, versionId);
    exigerPreparable(version);
    if (await tx.baremeDocument.findFirst({ where: { versionId, statut: "PUBLIE" }, select: { id: true } })) {
      throw new ErreurMetier("Cette version a déjà un barème publié, qui ne se modifie plus : une correction est une nouvelle version du produit.");
    }
    // Codes figés côté serveur (B5, ajout 10) : un code du barème publié d'origine ne change pas (supprimer reste permis).
    const origine = await baremeDOrigine(tx, version);
    if (origine) {
      const renommages = renommagesInterdits(origine, bareme);
      if (renommages.length > 0) throw new ErreurMetier(`Enregistrement refusé : ${renommages.length} code(s) d'un barème publié ne peuvent pas changer.`, renommages);
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
        avant: existant ? { statut: "BROUILLON", empreinte: existant.empreinte, ...resumeDuContenu(existant.contenu) } : undefined,
        apres: { versionId, statut: "BROUILLON", empreinte, ...resume(bareme), ...(problemes.length > 0 ? { problemes: problemes.length } : {}) },
        adresseIp,
      },
      tx,
    );
    return { id: ligne.id, empreinte, problemes };
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
 * Onglet « Publier » (B5) : rejoue TOUS les jeux d'essai du brouillon enregistré et contrôle les balises des modèles publiés en vigueur, avec
 * les mêmes fonctions que la publication. Le barème est revalidé comme à la publication (un barème invalide lève `ErreurBaremeInvalide`).
 */
export async function controlerAvantPublication(acteur: UtilisateurCourant, versionId: number): Promise<ControlesDePublication> {
  await exigerEcriture(acteur);
  return obtenirPrisma().$transaction(async (tx) => {
    const version = await verrouillerVersion(tx, versionId);
    const ligne = await tx.baremeDocument.findFirst({ where: { versionId, statut: "BROUILLON" } });
    if (!ligne) throw new ErreurMetier("Cette version n'a pas de brouillon de barème à contrôler : enregistrez d'abord le barème.");
    const bareme = validerDocumentBareme(ligne.contenu, { publication: true });
    const balises = await balisesDesModelesSansCle(tx, version.produitId, depuisDate(version.dateEffet), bareme);
    return { nombreEssais: bareme.jeuxEssai.length, ecarts: rejouerJeuxEssai(bareme, await parametresDEssai(tx, version, bareme)), balises };
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

  const issue = await obtenirPrisma().$transaction(async (tx) => {
    const version = await verrouillerVersion(tx, versionId);
    exigerPreparable(version);
    const brouillon = await tx.baremeDocument.findFirst({ where: { versionId, statut: "BROUILLON" } });
    if (!brouillon) {
      const publie = await tx.baremeDocument.findFirst({ where: { versionId, statut: "PUBLIE" }, select: { id: true } });
      throw new ErreurMetier(publie ? "Le barème de cette version est déjà publié." : "Cette version n'a pas de brouillon de barème à publier.");
    }
    const acteurAudit = { id: acteur.id, identifiant: acteur.identifiant };
    // Un refus de contenu (barème invalide, essai en écart) est journalisé : la transaction est validée avec son journal, l'erreur est levée après.
    const refuser = async (erreur: ErreurBaremeInvalide | ErreurPublicationBareme | ErreurBalisesAbsentes, raison: string) => {
      await journaliser(
        {
          acteur: acteurAudit,
          action: "BAREME_PUBLICATION_REFUSEE",
          objetType: "bareme_document",
          objetId: brouillon.id,
          avant: { versionId, statut: "BROUILLON", empreinte: brouillon.empreinte },
          apres: { motif: motifPropre, raison, ecarts: erreur.details },
          adresseIp,
        },
        tx,
      );
      return { erreur };
    };
    let bareme: Bareme;
    try {
      bareme = validerDocumentBareme(brouillon.contenu, { publication: true });
    } catch (e) {
      if (!(e instanceof ErreurBaremeInvalide)) throw e;
      return refuser(e, "BAREME_INVALIDE");
    }
    const balises = await balisesDesModelesSansCle(tx, version.produitId, depuisDate(version.dateEffet), bareme);
    if (balises.length > 0) return refuser(new ErreurBalisesAbsentes(balises), "BALISES_ABSENTES");
    const ecarts = rejouerJeuxEssai(bareme, await parametresDEssai(tx, version, bareme));
    if (ecarts.length > 0) return refuser(new ErreurPublicationBareme(ecarts), "ESSAIS_EN_ECART");

    const empreinte = empreinteBareme(bareme);
    const publieLe = new Date();
    await tx.baremeDocument.update({
      where: { id: brouillon.id },
      data: { statut: "PUBLIE", contenu: enJson(bareme), empreinte, schemaVersion: VERSION_SCHEMA_BAREME, publiePar: acteur.identifiant, publieLe, motifPublication: motifPropre, modifieLe: publieLe },
    });
    await journaliser(
      {
        acteur: acteurAudit,
        action: "PARAMETRE_MODIFIE",
        objetType: "bareme_document",
        objetId: brouillon.id,
        avant: { versionId, statut: "BROUILLON", empreinte: brouillon.empreinte },
        apres: { versionId, statut: "PUBLIE", empreinte, motif: motifPropre, publiePar: acteur.identifiant, ...resume(bareme) },
        adresseIp,
      },
      tx,
    );
    return { publie: { id: brouillon.id, empreinte } };
  });
  if ("erreur" in issue) throw issue.erreur;
  return issue.publie;
}

/**
 * Bascule une version au mode BAREME, une fois son barème publié. Seule une version qui n'est pas encore en vigueur peut changer de
 * mode (la base refuse sinon) : on ne réécrit jamais ce qu'un document a déjà calculé (T10). Journalisée (avant/après).
 */
export async function basculerVersionAuBareme(acteur: UtilisateurCourant, versionId: number, adresseIp: string | null): Promise<void> {
  await exigerEcriture(acteur);
  await obtenirPrisma().$transaction(async (tx) => {
    const v = await verrouillerVersion(tx, versionId);
    if (v.modeTarification === "BAREME") throw new ErreurMetier("Cette version est déjà tarifée au barème.");
    if (depuisDate(v.dateEffet) <= aujourdhui()) {
      throw new ErreurMetier("Cette version est déjà en vigueur : son mode ne peut plus changer. Créez une nouvelle version à une date d'effet postérieure à aujourd'hui, importez et publiez son barème, puis basculez-la.");
    }
    const publie = await tx.baremeDocument.findFirst({ where: { versionId, statut: "PUBLIE" }, select: { empreinte: true } });
    if (!publie) throw new ErreurMetier("Aucun barème publié pour cette version : importez et publiez le barème avant de basculer le mode.");
    await tx.produitVersion.update({ where: { id: versionId }, data: { modeTarification: "BAREME" } });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "produit_version",
        objetId: versionId,
        avant: { modeTarification: v.modeTarification },
        apres: { modeTarification: "BAREME", baremeEmpreinte: publie.empreinte },
        adresseIp,
      },
      tx,
    );
  });
}

/** État du barème d'une version, pour la fiche : le brouillon et le publié. */
export type EtatBareme = {
  brouillon: { id: number; empreinte: string; modifieLe: Date; creePar: string } | null;
  publie: { id: number; empreinte: string; publieLe: Date; publiePar: string; motif: string } | null;
};

export async function lireEtatBareme(client: Pick<Client, "baremeDocument">, versionId: number): Promise<EtatBareme> {
  const lignes = await client.baremeDocument.findMany({ where: { versionId } });
  const b = lignes.find((l) => l.statut === "BROUILLON");
  const p = lignes.find((l) => l.statut === "PUBLIE");
  return {
    brouillon: b ? { id: b.id, empreinte: b.empreinte, modifieLe: b.modifieLe, creePar: b.creePar } : null,
    publie: p && p.publieLe && p.publiePar ? { id: p.id, empreinte: p.empreinte, publieLe: p.publieLe, publiePar: p.publiePar, motif: p.motifPublication ?? "" } : null,
  };
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

/** État du barème d'une version, lu pour la fiche du produit. */
export async function etatDuBareme(versionId: number): Promise<EtatBareme> {
  return lireEtatBareme(obtenirPrisma(), versionId);
}

/** Codes des champs de tous les barèmes publiés d'un produit (B6b, D52) : vide si aucun barème n'est publié (aucun contrôle des balises `risque.<code>`). */
export async function codesRisqueDuProduit(client: Pick<Client, "baremeDocument">, produitId: number): Promise<Set<string>> {
  const lignes = await client.baremeDocument.findMany({ where: { statut: "PUBLIE", version: { produitId } }, select: { contenu: true } });
  return new Set(lignes.flatMap((l) => codesRisqueDuBareme(lireBareme(l.contenu))));
}

/**
 * Barème qui sert à l'aperçu d'un modèle d'un produit (H154) : celui de la version publiée en vigueur à `jour` (la plus récente dont la date d'effet est
 * passée), sinon la dernière version publiée, sinon le brouillon le plus récent. Un document illisible est écarté : jamais d'erreur, `null` si le produit
 * n'a pas de barème (FORMULE, GARANTIES).
 */
export async function baremePourApercu(client: Pick<Client, "baremeDocument">, produitId: number, jour: DateIso): Promise<Bareme | null> {
  const lignes = await client.baremeDocument.findMany({ where: { version: { produitId } }, include: { version: { select: { dateEffet: true } } } });
  const effet = (l: (typeof lignes)[number]) => l.version.dateEffet.toISOString().slice(0, 10);
  const recent = (a: (typeof lignes)[number], b: (typeof lignes)[number]) => effet(b).localeCompare(effet(a)) || b.id - a.id;
  const publies = lignes.filter((l) => l.statut === "PUBLIE").sort(recent);
  const candidats = [...publies.filter((l) => effet(l) <= jour), ...publies.filter((l) => effet(l) > jour).reverse(), ...lignes.filter((l) => l.statut === "BROUILLON").sort(recent)];
  for (const l of candidats) {
    const lu = schemaBareme.safeParse(l.contenu);
    if (lu.success) return lu.data;
  }
  return null;
}

/** `risque` et `risque_code` fictifs du barème d'un produit pour l'aperçu d'un modèle ; `null` si le produit n'a pas de barème. */
export async function risqueExempleDuProduit(client: Pick<Client, "baremeDocument">, produitId: number, jour: DateIso): Promise<RisqueDuDocument | null> {
  const bareme = await baremePourApercu(client, produitId, jour);
  return bareme ? risqueExempleDuBareme(bareme, jour) : null;
}

/** Valeurs de `risque.*` (libellés) et de `risque_code.*` (codes) d'un document. */
export type RisqueDuDocument = { risque: Record<string, string>; risqueCode: Record<string, string> };

/**
 * Barème figé avec un calcul d'origine BAREME, relu par sa version ET son empreinte (celle du barème publié au moment du calcul) et contrôlé (schéma,
 * empreinte recalculée) : `null` si le calcul n'est pas d'origine BAREME, ou si le barème est introuvable, d'un autre schéma ou altéré.
 */
async function baremeFigeDuCalcul(client: Pick<Client, "baremeDocument">, donneesCalcul: unknown): Promise<Bareme | null> {
  if (!estCompositionBareme(donneesCalcul)) return null;
  const { versionId, empreinte } = donneesCalcul.bareme;
  const ligne = await client.baremeDocument.findFirst({ where: { versionId, empreinte } });
  if (!ligne || ligne.schemaVersion !== VERSION_SCHEMA_BAREME || empreinteBareme(ligne.contenu) !== empreinte) return null;
  return lireBareme(ligne.contenu);
}

/**
 * `risque` et `risque_code` d'un document d'une cotation ou d'une police au barème (D55). Pour un calcul figé d'origine BAREME, les deux sont
 * recalculés depuis la SAISIE et le BARÈME FIGÉS de la cotation (barème lu par sa version ET son empreinte) : une cotation enregistrée avant
 * D55 stockait des CODES dans `risque.<champ>`, elle rend désormais des libellés comme les autres. Calcul pur : ni prime, ni ligne, ni
 * cotation n'est modifiée, rien n'est écrit. Les clés propres à la cotation (hors barème) sont gardées ; une valeur que la saisie ne permet pas
 * de donner est vide. Barème introuvable ou altéré : `risque` tel qu'enregistré, `risque_code` vide.
 */
export async function risqueDuDocument(client: Pick<Client, "baremeDocument">, risque: unknown, donneesCalcul: unknown): Promise<RisqueDuDocument> {
  const enregistre = (risque ?? {}) as Record<string, string>;
  if (!estCompositionBareme(donneesCalcul)) return { risque: enregistre, risqueCode: {} };
  const bareme = await baremeFigeDuCalcul(client, donneesCalcul);
  if (!bareme) return { risque: enregistre, risqueCode: {} };
  const { saisie } = donneesCalcul.bareme;
  return { risque: { ...enregistre, ...risqueDuBareme(bareme, saisie) }, risqueCode: risqueCodeDuBareme(bareme, saisie) };
}

/**
 * Calcul figé d'une cotation, d'une police ou d'une facture avec le détail de ses lignes (H173) : `code` de chaque garantie et `composantes`
 * souscrites. Un calcul fait depuis leur conservation les porte déjà ; un calcul antérieur les voit RECONSTITUER par le recalcul du barème figé sur la
 * saisie figée (même méthode que D54 / D55), à condition que le recalcul retombe sur les lignes figées. Calcul pur, rien n'est écrit ; impossible, le
 * calcul est rendu tel quel (les lignes s'affichent sans détail).
 */
export async function calculAvecDetail<T>(client: Pick<Client, "baremeDocument" | "produitVersion">, donneesCalcul: T): Promise<T> {
  if (!estCompositionBareme(donneesCalcul) || aDejaLeDetail(donneesCalcul.lignes)) return donneesCalcul;
  const bareme = await baremeFigeDuCalcul(client, donneesCalcul);
  if (!bareme) return donneesCalcul;
  const version = await client.produitVersion.findUnique({ where: { id: donneesCalcul.bareme.versionId }, select: { prorataActif: true } });
  if (!version) return donneesCalcul;
  return compositionAvecDetail(donneesCalcul, bareme, { actif: version.prorataActif });
}

/**
 * Une cotation ou une police chargée, avec `risque` (libellés) et `risqueCode` (codes) complétés pour le document, et le détail des garanties dans
 * `donneesCalcul` (en mémoire seulement) ; `null` reste `null`.
 */
export async function avecRisqueDuDocument<T extends { risque: unknown; donneesCalcul: unknown }>(
  client: Pick<Client, "baremeDocument" | "produitVersion">,
  ligne: T | null,
): Promise<(Omit<T, "risque"> & RisqueDuDocument) | null> {
  if (!ligne) return null;
  const { risque, risqueCode } = await risqueDuDocument(client, ligne.risque, ligne.donneesCalcul);
  return { ...ligne, risque, risqueCode, donneesCalcul: await calculAvecDetail(client, ligne.donneesCalcul) };
}

/** Codes des garanties de tous les barèmes publiés d'un produit (D61) : clés attendues de ses sous-modèles `bloc("garanties", g.code)` ; vide sans barème publié. */
export async function codesGarantiesDuProduit(client: Pick<Client, "baremeDocument">, produitId: number): Promise<Set<string>> {
  const lignes = await client.baremeDocument.findMany({ where: { statut: "PUBLIE", version: { produitId } }, select: { contenu: true } });
  return new Set(lignes.flatMap((l) => lireBareme(l.contenu).garanties.map((g) => g.code)));
}

/** `garanties_souscrites` fictives du barème d'un produit pour l'aperçu d'un modèle (D61) ; `null` si le produit n'a pas de barème. */
export async function garantiesExempleDuProduit(client: Pick<Client, "baremeDocument">, produitId: number, jour: DateIso): Promise<Record<string, unknown>[] | null> {
  const bareme = await baremePourApercu(client, produitId, jour);
  return bareme ? garantiesExempleDuBareme(bareme) : null;
}
