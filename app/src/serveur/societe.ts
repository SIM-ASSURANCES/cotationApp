import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { DateIso } from "@/domaine/calcul/dates";
import { peutAgir, peutLire } from "@/domaine/droits";
import {
  cleFormatNumero,
  estPrefixeNumero,
  FORMATS_NUMERO_DEFAUT,
  formaterSelon,
  LIBELLE_PREFIXE,
  PREFIXES_NUMERO,
  problemesFormatNumero,
  type PrefixeNumero,
} from "@/domaine/cotation/numerotation";
import { CLE_FORMAT_NUMERO_POLICE, FORMAT_NUMERO_POLICE_DEFAUT, problemesFormatNumeroPolice } from "@/domaine/cotation/police";
import { CLE_SOCIETE, cleImage, lireSociete, problemesSociete, type ImageSociete, type ParametresSociete } from "@/domaine/documents/societe";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Paramètres de la Société (societe.*, lieu d'émission, signataire) et images (signature scannée,
 * cachet). Historisés : une nouvelle valeur s'ajoute avec sa date d'effet, jamais dans le passé.
 */

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const TAILLE_MAX_IMAGE = 2 * 1024 * 1024;

export async function valeurEnVigueur(cle: string, date: DateIso): Promise<string | null> {
  const ligne = await obtenirPrisma().parametre.findFirst({ where: { cle, dateEffet: { lte: versDate(date) } }, orderBy: { dateEffet: "desc" } });
  return ligne?.valeur ?? null;
}

export async function lireParametresSociete(date: DateIso = aujourdhui()): Promise<ParametresSociete> {
  return lireSociete(await valeurEnVigueur(CLE_SOCIETE, date));
}

/** Image PNG en vigueur, ou null si elle n'est pas paramétrée. */
export async function lireImageSociete(nom: ImageSociete, date: DateIso = aujourdhui()): Promise<Uint8Array | null> {
  const valeur = await valeurEnVigueur(cleImage(nom), date);
  return valeur ? new Uint8Array(Buffer.from(valeur, "base64")) : null;
}

async function exigerParametrage(acteur: UtilisateurCourant, ecriture: boolean): Promise<void> {
  const niveau = await niveauDuProfil(acteur.profil, "PARAMETRER_PRODUITS");
  if (!(ecriture ? peutAgir(niveau) : peutLire(niveau))) throw new ErreurAcces("Droit insuffisant : paramétrage de la société.");
}

export async function consulterSociete(acteur: UtilisateurCourant): Promise<{ parametres: ParametresSociete; images: Record<ImageSociete, boolean> }> {
  await exigerParametrage(acteur, false);
  return {
    parametres: await lireParametresSociete(),
    images: { signature_sim: (await lireImageSociete("signature_sim")) !== null, cachet_sim: (await lireImageSociete("cachet_sim")) !== null },
  };
}

/** Ajoute une valeur historisée d'un paramètre (date d'effet jamais passée), journalisée dans la même transaction. */
export async function ajouterParametre(acteur: UtilisateurCourant, cle: string, valeur: string, dateEffet: DateIso, apres: Prisma.InputJsonValue, adresseIp: string | null): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEffet) || dateEffet < aujourdhui()) {
    throw new ErreurMetier("Date d'effet invalide ou passée : un paramètre ne se modifie jamais rétroactivement.");
  }
  try {
    await obtenirPrisma().$transaction(async (tx) => {
      await tx.parametre.create({ data: { cle, valeur, dateEffet: versDate(dateEffet), creePar: acteur.identifiant } });
      await journaliser({ acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "PARAMETRE_MODIFIE", objetType: "parametre", objetId: cle, apres, adresseIp }, tx);
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier("Une valeur est déjà enregistrée à cette date d'effet : choisissez une autre date.");
    }
    throw erreur;
  }
}

export async function enregistrerSociete(acteur: UtilisateurCourant, parametres: ParametresSociete, dateEffet: DateIso, adresseIp: string | null): Promise<void> {
  await exigerParametrage(acteur, true);
  const problemes = problemesSociete(parametres);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  await ajouterParametre(acteur, CLE_SOCIETE, JSON.stringify(parametres), dateEffet, { ...parametres, dateEffet } as unknown as Prisma.InputJsonValue, adresseIp);
}

export async function enregistrerImageSociete(acteur: UtilisateurCourant, nom: ImageSociete, png: Uint8Array, dateEffet: DateIso, adresseIp: string | null): Promise<void> {
  await exigerParametrage(acteur, true);
  const signature = [0x89, 0x50, 0x4e, 0x47];
  if (png.byteLength === 0 || png.byteLength > TAILLE_MAX_IMAGE || !signature.every((o, i) => png[i] === o)) {
    throw new ErreurMetier("Image PNG de 2 Mo au plus attendue.");
  }
  await ajouterParametre(acteur, cleImage(nom), Buffer.from(png).toString("base64"), dateEffet, { image: nom, octets: png.byteLength, dateEffet }, adresseIp);
}

// ---------------------------------------------------------------- Format du numéro de police (H10, H31)

/** Expression régulière en vigueur pour contrôler les numéros de police saisis (défaut : D18). */
export async function lireFormatNumeroPolice(date: DateIso = aujourdhui()): Promise<string> {
  return (await valeurEnVigueur(CLE_FORMAT_NUMERO_POLICE, date)) ?? FORMAT_NUMERO_POLICE_DEFAUT;
}

/** Consultation du format (écran Société) : valeur en vigueur et historique des modifications. */
export async function consulterFormatNumeroPolice(acteur: UtilisateurCourant): Promise<{ enVigueur: string; historique: { valeur: string; dateEffet: DateIso; creePar: string; creeLe: Date }[] }> {
  await exigerParametrage(acteur, false);
  const lignes = await obtenirPrisma().parametre.findMany({ where: { cle: CLE_FORMAT_NUMERO_POLICE }, orderBy: { dateEffet: "desc" } });
  return {
    enVigueur: await lireFormatNumeroPolice(),
    historique: lignes.map((l) => ({ valeur: l.valeur, dateEffet: l.dateEffet.toISOString().slice(0, 10), creePar: l.creePar, creeLe: l.creeLe })),
  };
}

/** Nouveau format, à une date d'effet (jamais rétroactive) : historisé et journalisé. */
export async function enregistrerFormatNumeroPolice(acteur: UtilisateurCourant, format: string, dateEffet: DateIso, adresseIp: string | null): Promise<void> {
  await exigerParametrage(acteur, true);
  const problemes = problemesFormatNumeroPolice(format.trim());
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  await ajouterParametre(acteur, CLE_FORMAT_NUMERO_POLICE, format.trim(), dateEffet, { formatNumeroPolice: format.trim(), avant: await lireFormatNumeroPolice(dateEffet), dateEffet }, adresseIp);
}

// ---------------------------------------------------------------- Formats des numéros de documents (session 4b, CDC §11.4)

export type FormatNumeroLu = { prefixe: PrefixeNumero; libelle: string; enVigueur: string; exemple: string; historique: { valeur: string; dateEffet: DateIso; creePar: string; creeLe: Date }[] };

/** Formats en vigueur des numéros COT, FAC, AV, REC, AVE et REL, avec leur historique (écran Société). */
export async function consulterFormatsNumero(acteur: UtilisateurCourant): Promise<FormatNumeroLu[]> {
  await exigerParametrage(acteur, false);
  const jour = aujourdhui();
  const resultat: FormatNumeroLu[] = [];
  for (const prefixe of PREFIXES_NUMERO) {
    const lignes = await obtenirPrisma().parametre.findMany({ where: { cle: cleFormatNumero(prefixe) }, orderBy: { dateEffet: "desc" } });
    const enVigueur = (await valeurEnVigueur(cleFormatNumero(prefixe), jour)) ?? FORMATS_NUMERO_DEFAUT[prefixe];
    resultat.push({
      prefixe,
      libelle: LIBELLE_PREFIXE[prefixe],
      enVigueur,
      exemple: formaterSelon(enVigueur, jour, 1),
      historique: lignes.map((l) => ({ valeur: l.valeur, dateEffet: l.dateEffet.toISOString().slice(0, 10), creePar: l.creePar, creeLe: l.creeLe })),
    });
  }
  return resultat;
}

/**
 * Nouveau format d'un type de numéro, à une date d'effet jamais rétroactive : historisé et journalisé (avant, après).
 * Le compteur ne change pas : il reste annuel et continu, quel que soit le format (pas de trou, pas de remise à zéro).
 */
export async function enregistrerFormatNumero(acteur: UtilisateurCourant, prefixe: string, format: string, dateEffet: DateIso, adresseIp: string | null): Promise<void> {
  await exigerParametrage(acteur, true);
  if (!estPrefixeNumero(prefixe)) throw new ErreurMetier("Type de numéro inconnu.");
  const propre = format.trim();
  const problemes = problemesFormatNumero(propre);
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const avant = (await valeurEnVigueur(cleFormatNumero(prefixe), dateEffet)) ?? FORMATS_NUMERO_DEFAUT[prefixe];
  await ajouterParametre(acteur, cleFormatNumero(prefixe), propre, dateEffet, { formatNumero: prefixe, avant, apres: propre, dateEffet }, adresseIp);
}
