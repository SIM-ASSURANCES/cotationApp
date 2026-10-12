import "server-only";

import ExcelJS from "exceljs";

import { Prisma } from "@/generated/prisma/client";

import { dateValide, type DateIso } from "@/domaine/calcul/dates";
import { estContratDeGroupe } from "@/domaine/cotation/adherents";
import { normaliserNumeroPolice, numeroCertificatParDefaut } from "@/domaine/cotation/police";
import type { Assure } from "@/domaine/cotation/saisie";
import { peutAgir, peutLire } from "@/domaine/droits";
import {
  COLONNES_IMPORT,
  NOMBRE_MAX_LIGNES_IMPORT,
  adherentDeLigne,
  cleDEntete,
  controlerLignes,
  type Cellule,
  type CleColonne,
  type ContexteControle,
  type DonneesLigne,
  type ErreurLigne,
  type LigneBrute,
  type LigneControlee,
} from "@/domaine/imports/adherents";

import { incorporerDansTransaction } from "./adherents";
import { journaliser, type ActeurAudit } from "./audit";
import { obtenirConfig } from "./config";
import { emettreCertificat } from "./documents";
import { niveauDuProfil } from "./droits";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ecrituresDifferees, lireDocumentEmis, zipStocker } from "./stockage";
import { creerTachesImport } from "./taches-police";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { versUtilisateurCourant } from "./utilisateurs";

/**
 * Import en masse des adhérents d'une police mère (CDC §13, session 5a, D24) :
 *   1. fichier modèle téléchargeable par produit (.xlsx) ;
 *   2. dépôt du fichier rempli (.xlsx ou .csv) → contrôle ligne par ligne, RIEN n'est encore créé (lot « CONTROLE ») ;
 *      rapport d'erreurs téléchargeable ;
 *   3. confirmation par l'utilisateur → UNE seule incorporation pour toutes les lignes valides (une version de la liste),
 *      puis la file de tâches produit un certificat d'adhésion par ligne (QR code, empreinte, stockage en ajout seul) ;
 *   4. fin : archive ZIP et récapitulatif (traités, en erreur, en échec, durée).
 * Droit : « Émettre un contrat » (celui des adhérents et des certificats, H21).
 */

const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const TAILLE_MAX_FICHIER = 10 * 1024 * 1024;

async function exiger(acteur: UtilisateurCourant, ecriture: boolean): Promise<void> {
  const niveau = await niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT");
  if (!(ecriture ? peutAgir(niveau) : peutLire(niveau))) throw new ErreurAcces("Droit insuffisant : import en masse des adhérents.");
}

// ---------------------------------------------------------------- Fichier modèle (par produit)

/** Formules de la version du produit en vigueur aujourd'hui, avec leurs âges limites. */
async function formulesEnVigueur(produitCode: string) {
  const produit = await obtenirPrisma().produit.findUnique({ where: { code: produitCode }, select: { id: true, code: true, libelle: true } });
  if (!produit) throw new ErreurMetier("Produit introuvable.");
  const version = await obtenirPrisma().produitVersion.findFirst({
    where: { produitId: produit.id, dateEffet: { lte: versDate(aujourdhui()) } },
    orderBy: { dateEffet: "desc" },
    include: { formules: { orderBy: { code: "asc" } } },
  });
  if (!version) throw new ErreurMetier(`Le produit ${produitCode} n'a pas de version en vigueur.`);
  return { produit, formules: version.formules.map((f) => ({ code: f.code, libelle: f.libelle, ageMin: f.ageMin, ageMax: f.ageMax })) };
}

const ENTETE = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A68" } } } as const;

/** Fichier modèle .xlsx d'un produit : colonnes du dictionnaire, une ligne d'exemple inventée, une feuille d'aide. */
export async function modeleImport(acteur: UtilisateurCourant, produitCode: string): Promise<{ nom: string; contenu: Uint8Array }> {
  await exiger(acteur, false);
  const { produit, formules } = await formulesEnVigueur(produitCode);
  const classeur = new ExcelJS.Workbook();
  classeur.creator = "SIM Documents";
  const feuille = classeur.addWorksheet("Adhérents");
  feuille.columns = COLONNES_IMPORT.map((c) => ({ header: c.cle, key: c.cle, width: Math.max(18, c.exemple.length + 4) }));
  feuille.getRow(1).eachCell((cellule) => Object.assign(cellule, { font: ENTETE.font, fill: ENTETE.fill }));
  // Ligne d'exemple, INVENTÉE : à remplacer par les vrais adhérents (elle serait contrôlée comme les autres).
  feuille.addRow(Object.fromEntries(COLONNES_IMPORT.map((c) => [c.cle, c.cle === "formule" ? (formules[0]?.code ?? c.exemple) : c.exemple])));
  feuille.views = [{ state: "frozen", ySplit: 1 }];
  const listeFormules = formules.map((f) => f.code).join(",");
  for (let ligne = 2; ligne <= 5001; ligne++) {
    feuille.getCell(`D${ligne}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"M,F"'] };
    if (listeFormules.length > 0 && listeFormules.length < 250) feuille.getCell(`F${ligne}`).dataValidation = { type: "list", allowBlank: false, formulae: [`"${listeFormules}"`] };
  }

  const aide = classeur.addWorksheet("Aide");
  aide.columns = [{ width: 22 }, { width: 14 }, { width: 60 }, { width: 50 }];
  aide.addRow([`Import des adhérents d'une police mère : ${produit.libelle} (${produit.code})`]).font = { bold: true, size: 13 };
  aide.addRow(["Une ligne par adhérent, à partir de la ligne 2 de la feuille « Adhérents ». La ligne 2 est un EXEMPLE INVENTÉ : remplacez-la."]);
  aide.addRow(["Les lignes en erreur sont listées dans le rapport ; les lignes valides peuvent être traitées après votre confirmation."]);
  aide.addRow([]);
  const t = aide.addRow(["Colonne", "Obligatoire", "Contenu", "Format"]);
  t.eachCell((c) => Object.assign(c, { font: ENTETE.font, fill: ENTETE.fill }));
  for (const c of COLONNES_IMPORT) aide.addRow([c.cle, c.obligatoire ? "oui" : "non", c.libelle, c.format]);
  aide.addRow([]);
  const tf = aide.addRow(["Formule", "Âges", "Libellé"]);
  tf.eachCell((c) => Object.assign(c, { font: ENTETE.font, fill: ENTETE.fill }));
  for (const f of formules) {
    const ages = f.ageMin === null && f.ageMax === null ? "sans limite" : `${f.ageMin ?? 0} à ${f.ageMax ?? "…"} ans`;
    aide.addRow([f.code, ages, f.libelle]);
  }
  aide.addRow([]);
  aide.addRow(["Âge : en années révolues à la date d'effet de l'incorporation, saisie au dépôt du fichier."]);
  aide.addRow(["Seules les formules retenues dans la police sont acceptées."]);
  return { nom: `modele_import_${produit.code}.xlsx`, contenu: new Uint8Array(await classeur.xlsx.writeBuffer()) };
}

// ---------------------------------------------------------------- Lecture du fichier

/** Valeur d'une cellule ExcelJS ramenée à un texte, un nombre, une date ou null (formule : son résultat). */
function cellule(v: ExcelJS.CellValue): Cellule {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellule((v.result ?? null) as ExcelJS.CellValue);
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("error" in v) return String(v.error);
  }
  return String(v);
}

/** Découpe une ligne CSV (guillemets doublés acceptés). */
function champsCsv(ligne: string, separateur: string): string[] {
  const champs: string[] = [];
  let courant = "";
  let guillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (guillemets) {
      if (c === '"' && ligne[i + 1] === '"') {
        courant += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else courant += c;
    } else if (c === '"') guillemets = true;
    else if (c === separateur) {
      champs.push(courant);
      courant = "";
    } else courant += c;
  }
  champs.push(courant);
  return champs;
}

type Tableau = { entetes: string[]; lignes: { numero: number; valeurs: Cellule[] }[] };

async function lireTableau(nom: string, contenu: Uint8Array): Promise<Tableau> {
  if (contenu.byteLength === 0) throw new ErreurMetier("Le fichier est vide.");
  if (contenu.byteLength > TAILLE_MAX_FICHIER) throw new ErreurMetier("Le fichier dépasse 10 Mo.");
  if (/\.csv$/i.test(nom)) {
    const texte = new TextDecoder("utf-8").decode(contenu).replace(/^﻿/, "");
    const brutes = texte.split(/\r?\n/);
    const separateur = (brutes[0] ?? "").split(";").length >= (brutes[0] ?? "").split(",").length ? ";" : ",";
    return {
      entetes: champsCsv(brutes[0] ?? "", separateur),
      lignes: brutes.slice(1).map((l, i) => ({ numero: i + 2, valeurs: champsCsv(l, separateur).map((v) => (v.trim() === "" ? null : v)) })),
    };
  }
  if (!/\.xlsx$/i.test(nom)) throw new ErreurMetier("Format non pris en charge : déposez un fichier .xlsx (Excel) ou .csv.");
  const classeur = new ExcelJS.Workbook();
  try {
    await classeur.xlsx.load(Buffer.from(contenu) as unknown as ArrayBuffer);
  } catch {
    throw new ErreurMetier("Fichier Excel illisible : enregistrez-le au format .xlsx (classeur Excel) et recommencez.");
  }
  const feuille = classeur.worksheets[0];
  if (!feuille) throw new ErreurMetier("Le classeur n'a aucune feuille.");
  const largeur = Math.max(feuille.columnCount, 1);
  const valeursDe = (r: ExcelJS.Row) => Array.from({ length: largeur }, (_, i) => cellule(r.getCell(i + 1).value));
  const lignes: Tableau["lignes"] = [];
  feuille.eachRow({ includeEmpty: false }, (r, numero) => {
    if (numero > 1) lignes.push({ numero, valeurs: valeursDe(r) });
  });
  return { entetes: valeursDe(feuille.getRow(1)).map((v) => (v === null ? "" : String(v))), lignes };
}

/** Lignes du fichier : colonnes reconnues par leur en-tête ; les lignes entièrement vides sont ignorées. */
export async function lireFichierImport(nom: string, contenu: Uint8Array): Promise<LigneBrute[]> {
  const { entetes, lignes } = await lireTableau(nom, contenu);
  const index = new Map<CleColonne, number>();
  entetes.forEach((e, i) => {
    const cle = cleDEntete(e);
    if (cle && !index.has(cle)) index.set(cle, i);
  });
  const manquantes = COLONNES_IMPORT.filter((c) => c.obligatoire && !index.has(c.cle)).map((c) => c.cle);
  if (manquantes.length > 0) {
    throw new ErreurMetier(`Colonnes absentes de la première ligne du fichier : ${manquantes.join(", ")}. Partez du fichier modèle du produit.`);
  }
  const utiles = lignes
    .map((l) => ({ numero: l.numero, cellules: Object.fromEntries([...index].map(([cle, i]) => [cle, l.valeurs[i] ?? null])) as LigneBrute["cellules"] }))
    .filter((l) => Object.values(l.cellules).some((v) => v !== null && String(v).trim() !== ""));
  if (utiles.length === 0) throw new ErreurMetier("Le fichier ne contient aucune ligne d'adhérent.");
  if (utiles.length > NOMBRE_MAX_LIGNES_IMPORT) throw new ErreurMetier(`Au plus ${NOMBRE_MAX_LIGNES_IMPORT} lignes par import.`);
  return utiles;
}

// ---------------------------------------------------------------- Contrôle

type PoliceAvecVersion = Prisma.PoliceGetPayload<{ include: { cotation: { select: { produitId: true; versionDateEffet: true } } } }>;

async function contexteControle(police: PoliceAvecVersion, dateEffet: DateIso, numeros: string[], lotEnCours: number | null = null, client: Prisma.TransactionClient = obtenirPrisma()): Promise<ContexteControle> {
  const version = await client.produitVersion.findUniqueOrThrow({
    where: { produitId_dateEffet: { produitId: police.cotation.produitId, dateEffet: police.cotation.versionDateEffet } },
    include: { formules: true },
  });
  const adherents = police.assures as unknown as Assure[];
  const versions = await client.adherentsVersion.findMany({ where: { policeId: police.id }, select: { adherents: true } });
  const prochainOrdre = Math.max(0, ...versions.flatMap((v) => (v.adherents as unknown as Assure[]).map((a) => a.ordre)), ...adherents.map((a) => a.ordre)) + 1;
  // Numéros à vérifier : ceux du fichier et ceux qui seraient proposés aux lignes sans numéro (session 6.0).
  const proposes = numeros.map((_, i) => numeroCertificatParDefaut(police.numero, prochainOrdre + i) ?? "");
  const uniques = [...new Set([...numeros.map(normaliserNumeroPolice), ...proposes].filter((n) => n !== ""))];
  const [polices, documents, lignes] = await Promise.all([
    client.police.findMany({ where: { numero: { in: uniques } }, select: { numero: true } }),
    client.documentEmis.findMany({ where: { numero: { in: uniques } }, select: { numero: true }, distinct: ["numero"] }),
    // Lignes d'un import confirmé dont le certificat n'est pas encore produit : leur numéro est réservé.
    client.ligneImport.findMany({
      where: { documentId: null, adherentOrdre: { not: null }, lot: { policeId: police.id, statut: { in: ["EN_COURS", "TERMINE"] }, ...(lotEnCours !== null ? { id: { not: lotEnCours } } : {}) } },
      select: { donnees: true },
    }),
  ]);
  const reserves = lignes.map((l) => (l.donnees as unknown as DonneesLigne).numero_certificat).filter((n) => uniques.includes(n));
  return {
    dateEffet,
    aujourdhui: aujourdhui(),
    formulesProduit: new Map(version.formules.map((f) => [f.code, { ageMin: f.ageMin, ageMax: f.ageMax }])),
    formulesPolice: police.formulesRetenues as unknown as string[],
    adherents,
    numerosPris: new Set([...polices, ...documents].map((x) => x.numero).concat(reserves)),
    numeroPolice: police.numero,
    prochainOrdre,
  };
}

async function policeMere(policeId: number, client: Prisma.TransactionClient = obtenirPrisma()): Promise<PoliceAvecVersion> {
  const police = await client.police.findUnique({ where: { id: policeId }, include: { cotation: { select: { produitId: true, versionDateEffet: true } } } });
  if (!police) throw new ErreurMetier("Police introuvable.");
  if (!estContratDeGroupe(police.typeContrat)) throw new ErreurMetier("L'import en masse ne concerne que les adhérents d'un contrat de groupe (police mère).");
  return police;
}

/** Date d'effet de l'incorporation : dans la période de la police, et jamais avant le dernier changement de la liste. */
async function verifierDate(police: PoliceAvecVersion, dateEffet: DateIso): Promise<void> {
  if (!dateValide(dateEffet)) throw new ErreurMetier("Date d'effet de l'incorporation invalide (AAAA-MM-JJ).");
  const debut = depuisDate(police.dateEffet);
  const fin = depuisDate(police.dateEcheance);
  if (dateEffet < debut || dateEffet > fin) throw new ErreurMetier(`La date d'effet de l'incorporation doit être comprise entre le ${debut} et le ${fin} (période de la police).`);
  const derniere = await obtenirPrisma().adherentsVersion.findFirst({ where: { policeId: police.id }, orderBy: { numero: "desc" }, select: { dateEffet: true } });
  if (!derniere) throw new ErreurMetier("Cette police n'a pas de liste initiale d'adhérents : elle date d'avant la session 4a.");
  if (dateEffet < depuisDate(derniere.dateEffet)) throw new ErreurMetier(`La date d'effet ne peut pas précéder le dernier changement de la liste (${depuisDate(derniere.dateEffet)}).`);
}

/**
 * Dépôt et contrôle d'un fichier : un lot « CONTROLE » est créé avec toutes ses lignes et leurs erreurs. Rien d'autre
 * n'est créé (ni adhérent, ni document) tant que l'utilisateur n'a pas confirmé.
 */
export async function controlerImport(acteur: UtilisateurCourant, policeId: number, dateEffet: DateIso, fichier: { nom: string; contenu: Uint8Array }, adresseIp: string | null): Promise<number> {
  await exiger(acteur, true);
  const police = await policeMere(policeId);
  await verifierDate(police, dateEffet);
  const brutes = await lireFichierImport(fichier.nom, fichier.contenu);
  const ctx = await contexteControle(police, dateEffet, brutes.map((l) => String(l.cellules.numero_certificat ?? "")));
  const controlees = controlerLignes(brutes, ctx);
  const erreurs = controlees.filter((l) => l.erreurs.length > 0).length;
  return obtenirPrisma().$transaction(async (tx) => {
    const lot = await tx.lotImport.create({
      data: {
        policeId,
        produitCode: police.produitCode,
        dateEffet: versDate(dateEffet),
        fichierNom: fichier.nom.slice(0, 200),
        statut: "CONTROLE",
        total: controlees.length,
        valides: controlees.length - erreurs,
        erreurs,
        creeParId: acteur.id,
        creePar: acteur.identifiant,
      },
    });
    await tx.ligneImport.createMany({
      data: controlees.map((l) => ({
        lotId: lot.id,
        numeroLigne: l.numero,
        donnees: l.donnees as unknown as Prisma.InputJsonValue,
        erreurs: l.erreurs as unknown as Prisma.InputJsonValue,
        statut: l.erreurs.length > 0 ? "ERREUR" : "VALIDE",
      })),
    });
    await journaliser(
      { acteur: auteur(acteur), action: "IMPORT_CONTROLE", objetType: "lot_import", objetId: lot.id, apres: { police: police.numero, fichier: lot.fichierNom, dateEffet, total: lot.total, valides: lot.valides, erreurs }, adresseIp },
      tx,
    );
    return lot.id;
  });
}

// ---------------------------------------------------------------- Lecture d'un lot, rapport d'erreurs

export type StatutLot = "CONTROLE" | "EN_COURS" | "TERMINE" | "ABANDONNE";

export type VueLot = {
  id: number;
  statut: StatutLot;
  police: { id: number; numero: string; cotationId: number };
  produitCode: string;
  dateEffet: DateIso;
  fichierNom: string;
  total: number;
  valides: number;
  erreurs: number;
  /** Avancement, lu dans les lignes. */
  produits: number;
  echecs: number;
  restants: number;
  versionAdherents: number | null;
  creePar: string;
  creeLe: Date;
  confirmePar: string | null;
  debut: Date | null;
  fin: Date | null;
  dureeSecondes: number | null;
  zip: { taille: number } | null;
  /** Certificats émis dont le fichier attend encore le stockage (T14) : absents de l'archive. */
  enAttenteEcriture: number;
  derniereErreur: string | null;
  lignesEnErreur: { numero: number; erreurs: ErreurLigne[] }[];
  lignesEnEchec: { numero: number; nom: string; erreur: string }[];
};

const avancement = async (lotId: number) => {
  const groupes = await obtenirPrisma().ligneImport.groupBy({ by: ["statut"], where: { lotId }, _count: { _all: true } });
  const n = (s: string) => groupes.find((g) => g.statut === s)?._count._all ?? 0;
  return { produits: n("PRODUIT"), echecs: n("ECHEC"), valides: n("VALIDE") };
};

export async function lireLot(acteur: UtilisateurCourant, lotId: number): Promise<VueLot | null> {
  await exiger(acteur, false);
  const prisma = obtenirPrisma();
  const lot = await prisma.lotImport.findUnique({ where: { id: lotId }, include: { police: { select: { id: true, numero: true, cotationId: true } } } });
  if (!lot) return null;
  const a = await avancement(lotId);
  const [enErreur, enEchec, produits] = await Promise.all([
    prisma.ligneImport.findMany({ where: { lotId, statut: "ERREUR" }, orderBy: { numeroLigne: "asc" }, take: 200, select: { numeroLigne: true, erreurs: true } }),
    prisma.ligneImport.findMany({ where: { lotId, statut: "ECHEC" }, orderBy: { numeroLigne: "asc" }, take: 200, select: { numeroLigne: true, donnees: true, derniereErreur: true } }),
    prisma.ligneImport.findMany({ where: { lotId, statut: "PRODUIT" }, select: { documentId: true } }),
  ]);
  const differes = await ecrituresDifferees(produits.map((p) => p.documentId!).filter((x) => x !== null));
  return {
    id: lot.id,
    statut: lot.statut as StatutLot,
    police: lot.police,
    produitCode: lot.produitCode,
    dateEffet: depuisDate(lot.dateEffet),
    fichierNom: lot.fichierNom,
    total: lot.total,
    valides: lot.valides,
    erreurs: lot.erreurs,
    produits: a.produits,
    echecs: a.echecs,
    restants: lot.statut === "EN_COURS" ? a.valides + a.echecs : 0,
    versionAdherents: lot.versionAdherents,
    creePar: lot.creePar,
    creeLe: lot.creeLe,
    confirmePar: lot.confirmePar,
    debut: lot.debut,
    fin: lot.fin,
    dureeSecondes: lot.debut && lot.fin ? Math.round((lot.fin.getTime() - lot.debut.getTime()) / 1000) : null,
    zip: lot.zipChemin && lot.zipTaille !== null ? { taille: lot.zipTaille } : null,
    enAttenteEcriture: differes.size,
    derniereErreur: lot.derniereErreur,
    lignesEnErreur: enErreur.map((l) => ({ numero: l.numeroLigne, erreurs: l.erreurs as unknown as ErreurLigne[] })),
    lignesEnEchec: enEchec.map((l) => ({ numero: l.numeroLigne, nom: (l.donnees as unknown as DonneesLigne).nom_prenoms, erreur: l.derniereErreur ?? "" })),
  };
}

export type ResumeLot = { id: number; statut: StatutLot; policeNumero: string; cotationId: number; fichierNom: string; total: number; erreurs: number; creeLe: Date; creePar: string };

export async function listerLots(acteur: UtilisateurCourant, critere: { policeId?: number } = {}): Promise<ResumeLot[]> {
  await exiger(acteur, false);
  const lots = await obtenirPrisma().lotImport.findMany({
    where: critere.policeId ? { policeId: critere.policeId } : {},
    orderBy: { id: "desc" },
    take: 100,
    include: { police: { select: { numero: true, cotationId: true } } },
  });
  return lots.map((l) => ({ id: l.id, statut: l.statut as StatutLot, policeNumero: l.police.numero, cotationId: l.police.cotationId, fichierNom: l.fichierNom, total: l.total, erreurs: l.erreurs, creeLe: l.creeLe, creePar: l.creePar }));
}

/** Rapport d'erreurs (.xlsx) : une ligne par erreur (numéro de ligne du fichier, colonne, valeur, message en français). */
export async function rapportErreurs(acteur: UtilisateurCourant, lotId: number): Promise<{ nom: string; contenu: Uint8Array }> {
  await exiger(acteur, false);
  const lot = await obtenirPrisma().lotImport.findUnique({ where: { id: lotId }, select: { id: true, fichierNom: true } });
  if (!lot) throw new ErreurMetier("Import introuvable.");
  const lignes = await obtenirPrisma().ligneImport.findMany({ where: { lotId, statut: { in: ["ERREUR", "ECHEC"] } }, orderBy: { numeroLigne: "asc" } });
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet("Erreurs");
  feuille.columns = [
    { header: "Ligne", key: "ligne", width: 8 },
    { header: "Colonne", key: "colonne", width: 20 },
    { header: "Valeur", key: "valeur", width: 30 },
    { header: "Message", key: "message", width: 90 },
  ];
  feuille.getRow(1).eachCell((c) => Object.assign(c, { font: ENTETE.font, fill: ENTETE.fill }));
  for (const l of lignes) {
    const erreurs: ErreurLigne[] = l.statut === "ERREUR" ? (l.erreurs as unknown as ErreurLigne[]) : [{ colonne: "ligne", valeur: "", message: `Certificat non produit : ${l.derniereErreur ?? "erreur inconnue"}` }];
    for (const e of erreurs) feuille.addRow({ ligne: l.numeroLigne, colonne: e.colonne, valeur: e.valeur, message: e.message });
  }
  feuille.views = [{ state: "frozen", ySplit: 1 }];
  return { nom: `rapport_erreurs_import_${lot.id}.xlsx`, contenu: new Uint8Array(await classeur.xlsx.writeBuffer()) };
}

// ---------------------------------------------------------------- Abandon, confirmation

export async function abandonnerImport(acteur: UtilisateurCourant, lotId: number, adresseIp: string | null): Promise<void> {
  await exiger(acteur, true);
  await obtenirPrisma().$transaction(async (tx) => {
    const fait = await tx.lotImport.updateMany({ where: { id: lotId, statut: "CONTROLE" }, data: { statut: "ABANDONNE" } });
    if (fait.count === 0) throw new ErreurMetier("Seul un import en attente de confirmation peut être abandonné.");
    await journaliser({ acteur: auteur(acteur), action: "IMPORT_ABANDONNE", objetType: "lot_import", objetId: lotId, adresseIp }, tx);
  });
}

/**
 * Confirmation (CDC §13 : « les lignes valides peuvent être traitées ») : dans UNE transaction, les lignes valides
 * sont recontrôlées contre l'état COURANT de la police (elle a pu changer depuis le contrôle), puis incorporées en
 * UNE seule nouvelle version de la liste ; chaque ligne reçoit le numéro d'ordre de son adhérent. Ensuite seulement,
 * la production des certificats est confiée à la file de tâches.
 * Renvoie false si la file de tâches n'a pas pu être jointe (le traitement démarrera au retour du travailleur).
 */
export async function confirmerImport(acteur: UtilisateurCourant, lotId: number, adresseIp: string | null): Promise<{ enFile: boolean }> {
  await exiger(acteur, true);
  const prisma = obtenirPrisma();
  try {
    await prisma.$transaction(
      async (tx) => {
        const lot = await tx.lotImport.findUnique({ where: { id: lotId } });
        if (!lot) throw new ErreurMetier("Import introuvable.");
        const pris = await tx.lotImport.updateMany({ where: { id: lotId, statut: "CONTROLE" }, data: { statut: "EN_COURS", confirmeParId: acteur.id, confirmePar: acteur.identifiant } });
        if (pris.count === 0) throw new ErreurMetier("Cet import a déjà été confirmé ou abandonné.");
        const valides = await tx.ligneImport.findMany({ where: { lotId, statut: "VALIDE" }, orderBy: { numeroLigne: "asc" } });
        if (valides.length === 0) throw new ErreurMetier("Aucune ligne valide à traiter : corrigez le fichier et déposez-le de nouveau.");

        const police = await policeMere(lot.policeId, tx);
        const dateEffet = depuisDate(lot.dateEffet);
        const donnees = valides.map((l) => l.donnees as unknown as DonneesLigne);
        const ctx = await contexteControle(police, dateEffet, donnees.map((d) => d.numero_certificat), lotId, tx);
        const recontrole: LigneControlee[] = controlerLignes(
          valides.map((l, i) => ({ numero: l.numeroLigne, cellules: donnees[i] })),
          ctx,
        );
        const nouvelles = recontrole.filter((l) => l.erreurs.length > 0);
        if (nouvelles.length > 0) {
          throw new ErreurMetier(
            "La police a changé depuis le contrôle du fichier : déposez-le de nouveau pour un nouveau contrôle.",
            nouvelles.slice(0, 10).map((l) => `Ligne ${l.numero} : ${l.erreurs.map((e) => e.message).join(" ")}`),
          );
        }

        const { numeroVersion, ordres } = await incorporerDansTransaction(tx, acteur, police.id, dateEffet, donnees.map(adherentDeLigne), adresseIp);
        for (let i = 0; i < valides.length; i++) {
          await tx.ligneImport.update({ where: { id: valides[i].id }, data: { adherentOrdre: ordres[i] } });
        }
        await tx.lotImport.update({ where: { id: lotId }, data: { versionAdherents: numeroVersion } });
        // H64 : pas d'émission automatique ; deux tâches visibles sur la police jusqu'à l'émission des pièces.
        await creerTachesImport(tx, { policeId: police.id, lotId, versionAdherents: numeroVersion, creePar: acteur.identifiant });
        await journaliser(
          { acteur: auteur(acteur), action: "IMPORT_CONFIRME", objetType: "lot_import", objetId: lotId, apres: { police: police.numero, versionAdherents: numeroVersion, lignes: valides.length }, adresseIp },
          tx,
        );
      },
      { timeout: 120_000 },
    );
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier("La liste des adhérents a été modifiée entre-temps : déposez le fichier de nouveau.");
    }
    throw erreur;
  }
  return { enFile: await confierALaFile(lotId) };
}

async function confierALaFile(lotId: number): Promise<boolean> {
  try {
    const { enfilerLot } = await import("./taches");
    await enfilerLot(lotId);
    return true;
  } catch (erreur) {
    console.error(`[imports] lot ${lotId} non confié à la file de tâches : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    return false;
  }
}

/** Relance des lignes en échec d'un lot terminé (même lot, mêmes adhérents : seuls les certificats manquants sont produits). */
export async function relancerEchecs(acteur: UtilisateurCourant, lotId: number, adresseIp: string | null): Promise<{ enFile: boolean }> {
  await exiger(acteur, true);
  await obtenirPrisma().$transaction(async (tx) => {
    const echecs = await tx.ligneImport.count({ where: { lotId, statut: "ECHEC" } });
    const fait = await tx.lotImport.updateMany({ where: { id: lotId, statut: { in: ["TERMINE", "EN_COURS"] } }, data: { statut: "EN_COURS", fin: null } });
    if (fait.count === 0 || echecs === 0) throw new ErreurMetier("Aucune ligne en échec à relancer pour cet import.");
    await journaliser({ acteur: auteur(acteur), action: "IMPORT_CONFIRME", objetType: "lot_import", objetId: lotId, apres: { relance: true, lignes: echecs }, adresseIp }, tx);
  });
  return { enFile: await confierALaFile(lotId) };
}

// ---------------------------------------------------------------- Traitement (travailleur)

/** Exécute f sur chaque élément, au plus n à la fois. */
async function enParallele<T>(elements: readonly T[], n: number, f: (e: T) => Promise<void>): Promise<void> {
  let suivant = 0;
  const fil = async () => {
    while (suivant < elements.length) await f(elements[suivant++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, elements.length)) }, fil));
}

const estDoublon = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Certificat d'une ligne : REJOUABLE. Une ligne déjà liée à un document n'est pas retraitée ; un certificat déjà émis
 * pour cet adhérent (tâche interrompue après l'émission) est rattaché à la ligne au lieu d'être émis une seconde fois ;
 * la base refuse de toute façon un second certificat pour le même adhérent (index unique).
 */
async function traiterLigne(acteur: UtilisateurCourant, policeId: number, ligne: { id: number; adherentOrdre: number | null; donnees: DonneesLigne }): Promise<void> {
  const prisma = obtenirPrisma();
  if (ligne.adherentOrdre === null) throw new Error(`ligne ${ligne.id} sans adhérent : import non confirmé`);
  const existant = () => prisma.documentEmis.findFirst({ where: { policeId, type: "CERTIFICAT", adherentOrdre: ligne.adherentOrdre, version: 1 }, select: { id: true } });
  const rattacher = (documentId: number) => prisma.ligneImport.update({ where: { id: ligne.id }, data: { statut: "PRODUIT", documentId, derniereErreur: null, tentatives: { increment: 1 } } });
  const deja = await existant();
  if (deja) {
    await rattacher(deja.id);
    return;
  }
  try {
    const document = await emettreCertificat(acteur, policeId, ligne.adherentOrdre, ligne.donnees.numero_certificat, null);
    await rattacher(document.id);
  } catch (erreur) {
    const concurrent = estDoublon(erreur) ? await existant() : null;
    if (concurrent) {
      await rattacher(concurrent.id);
      return;
    }
    // CDC §15.3 : une erreur sur un document d'un lot n'interrompt pas le lot.
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    console.error(`[imports] ligne ${ligne.id} : ${message}`);
    await prisma.ligneImport.update({ where: { id: ligne.id }, data: { statut: "ECHEC", derniereErreur: message.slice(0, 1000), tentatives: { increment: 1 } } });
  }
}

/**
 * Traitement d'un lot confirmé (tâche « lot-N » de la file « imports »). Peut être relancé à tout moment : seuls les
 * certificats manquants sont produits. CONVERSIONS_SIMULTANEES certificats à la fois (le générateur borne aussi).
 * Fin : archive ZIP des certificats produits (stockée, ajout seul), lot « TERMINE », récapitulatif au journal.
 */
export async function traiterLot(lotId: number): Promise<void> {
  const prisma = obtenirPrisma();
  const lot = await prisma.lotImport.findUnique({ where: { id: lotId } });
  if (!lot || lot.statut !== "EN_COURS") return;
  if (lot.confirmeParId === null) throw new Error(`lot ${lotId} sans auteur de confirmation`);
  const utilisateur = await prisma.utilisateur.findUniqueOrThrow({ where: { id: lot.confirmeParId }, include: { profil: true } });
  const acteur = versUtilisateurCourant(utilisateur);
  if (!lot.debut) await prisma.lotImport.update({ where: { id: lotId }, data: { debut: new Date() } });

  const aFaire = await prisma.ligneImport.findMany({ where: { lotId, statut: { in: ["VALIDE", "ECHEC"] } }, orderBy: { numeroLigne: "asc" } });
  await enParallele(aFaire, obtenirConfig().CONVERSIONS_SIMULTANEES, (l) =>
    traiterLigne(acteur, lot.policeId, { id: l.id, adherentOrdre: l.adherentOrdre, donnees: l.donnees as unknown as DonneesLigne }),
  );
  await finaliserLot(lotId);
}

/** Archive ZIP des certificats produits (sauf ceux dont le fichier attend le stockage, T14), puis lot TERMINE. */
async function finaliserLot(lotId: number): Promise<void> {
  const prisma = obtenirPrisma();
  const lot = await prisma.lotImport.findUniqueOrThrow({ where: { id: lotId }, include: { police: { select: { numero: true } } } });
  const produites = await prisma.ligneImport.findMany({ where: { lotId, statut: "PRODUIT" }, orderBy: { numeroLigne: "asc" }, include: { document: true } });
  const documents = produites.map((l) => l.document!).filter((d) => d !== null);
  const differes = await ecrituresDifferees(documents.map((d) => d.id));
  const dansLArchive = documents.filter((d) => !differes.has(d.id));

  let zip: { chemin: string; empreinte: string; taille: number } | null = null;
  let erreurZip: string | null = null;
  if (dansLArchive.length > 0) {
    // Stockage en ajout seul : chaque archive a son propre nom (horodaté à la milliseconde, avec la police). Un nom
    // fixe heurterait l'archive d'une finalisation interrompue après l'écriture, ou celle d'un lot de même numéro
    // d'une base restaurée : l'archive ne serait jamais refaite.
    const horodatage = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const chemin = `lots/${lot.police.numero.replace(/[^A-Za-z0-9_-]/g, "_")}/LOT-${lot.id}/certificats_lot_${lot.id}_${horodatage}.zip`;
    const fichiers = dansLArchive.map((d) => ({ chemin: d.chemin, nom: `${d.numero.replace(/[^A-Za-z0-9_-]/g, "_")}_CERTIFICAT_v${d.version}.pdf` }));
    try {
      zip = { chemin, ...(await zipStocker(fichiers, chemin)) };
    } catch (erreur) {
      // L'archive est un confort : les certificats sont émis et téléchargeables un par un. Elle se refera à la relance.
      erreurZip = erreur instanceof Error ? erreur.message : String(erreur);
      console.error(`[imports] lot ${lotId} : archive ZIP non écrite (${erreurZip})`);
    }
  }
  const a = await avancement(lotId);
  const fin = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.lotImport.update({
      where: { id: lotId },
      data: {
        statut: "TERMINE",
        fin,
        ...(zip ? { zipChemin: zip.chemin, zipEmpreinte: zip.empreinte, zipTaille: zip.taille } : {}),
        derniereErreur: erreurZip ? `Archive ZIP non écrite : ${erreurZip}`.slice(0, 1000) : null,
      },
    });
    await journaliser(
      {
        acteur: { id: lot.confirmeParId, identifiant: lot.confirmePar },
        action: "IMPORT_TERMINE",
        objetType: "lot_import",
        objetId: lotId,
        apres: {
          police: lot.police.numero,
          total: lot.total,
          produits: a.produits,
          enErreur: lot.erreurs,
          enEchec: a.echecs,
          dureeSecondes: lot.debut ? Math.round((fin.getTime() - lot.debut.getTime()) / 1000) : null,
          zip: zip?.chemin ?? null,
          enAttenteEcriture: differes.size,
        },
      },
      tx,
    );
  });
}

/** Archive ZIP d'un lot terminé. */
export async function zipDuLot(acteur: UtilisateurCourant, lotId: number, adresseIp: string | null): Promise<{ nom: string; contenu: Uint8Array }> {
  await exiger(acteur, false);
  const lot = await obtenirPrisma().lotImport.findUnique({ where: { id: lotId } });
  if (!lot?.zipChemin || !lot.zipEmpreinte) throw new ErreurMetier("Pas d'archive pour cet import (traitement en cours, ou aucun certificat produit).");
  // Même contrôle d'intégrité qu'un document émis (CDC §14.3).
  const contenu = await lireDocumentEmis({ id: -1, numero: `LOT-${lot.id}`, version: 1, chemin: lot.zipChemin, empreinte: lot.zipEmpreinte });
  await journaliser({ acteur: auteur(acteur), action: "DOCUMENT_TELECHARGE", objetType: "lot_import", objetId: lot.id, apres: { zip: lot.zipChemin }, adresseIp });
  return { nom: `certificats_import_${lot.id}.zip`, contenu };
}

/** Lots confirmés dont le traitement n'est pas terminé (le travailleur les reprend à son démarrage). */
export async function lotsEnCours(): Promise<number[]> {
  const lots = await obtenirPrisma().lotImport.findMany({ where: { statut: "EN_COURS" }, select: { id: true } });
  return lots.map((l) => l.id);
}
