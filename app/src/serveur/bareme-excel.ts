import "server-only";

import { baremeSecurpro } from "@/domaine/bareme/securpro-fixture";

import { journaliser } from "./audit";
import { construireClasseur } from "./bareme-classeur-ecriture";
import { analyserClasseur, ErreurImportBareme, TAILLE_MAX_CLASSEUR } from "./bareme-classeur-lecture";
import { enregistrerBrouillonBareme, lireBaremePublie } from "./bareme";
import { exigerEcriture } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Import / export Excel du barème d'une version (session B9, D50 ; propositions-bareme.md §4 option c). Droit : celui du paramétrage
 * des produits. L'import ne crée JAMAIS qu'un brouillon, avec le même schéma zod et le même `verifierBareme` que le service de
 * stockage ; la publication reste un acte séparé (rejeu des essais, motif, journal).
 */

export const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function versionEtProduit(versionId: number) {
  const v = await obtenirPrisma().produitVersion.findUnique({ where: { id: versionId }, include: { produit: { select: { code: true, libelle: true } } } });
  if (!v) throw new ErreurMetier("Version de produit introuvable.");
  return { code: v.produit.code, libelle: v.produit.libelle, dateEffet: v.dateEffet.toISOString().slice(0, 10) };
}

/** Modèle de classeur : le SECURPRO INVENTÉ en exemple, à remplacer par le barème du produit. */
export async function modeleBaremeXlsx(acteur: UtilisateurCourant, versionId: number): Promise<{ nom: string; contenu: Uint8Array }> {
  await exigerEcriture(acteur);
  const p = await versionEtProduit(versionId);
  const contenu = await construireClasseur(baremeSecurpro(), { titre: `Modèle de barème pour ${p.libelle} (${p.code}), version du ${p.dateEffet}`, modele: true });
  return { nom: `modele_bareme_${p.code}.xlsx`, contenu };
}

/** Export du barème PUBLIÉ de la version : l'empreinte est écrite dans le Lisez-moi. Réimporté, il redonne la même empreinte. */
export async function exporterBaremePublieXlsx(acteur: UtilisateurCourant, versionId: number): Promise<{ nom: string; contenu: Uint8Array }> {
  await exigerEcriture(acteur);
  const p = await versionEtProduit(versionId);
  const { bareme, empreinte } = await lireBaremePublie(obtenirPrisma(), versionId);
  const contenu = await construireClasseur(bareme, { titre: `Barème publié de ${p.libelle} (${p.code}), version du ${p.dateEffet}`, empreinte });
  return { nom: `bareme_${p.code}_${p.dateEffet}.xlsx`, contenu };
}

/**
 * Importe un classeur : le fichier est contrôlé (archive, taille, cellules, schéma, intégrité) ; s'il y a la moindre erreur,
 * `ErreurImportBareme` les liste toutes (feuille, cellule, règle) et rien n'est enregistré. Sinon le barème devient le BROUILLON
 * de la version (il remplace le brouillon précédent).
 */
export async function importerBaremeXlsx(acteur: UtilisateurCourant, versionId: number, nomFichier: string, contenu: Uint8Array, adresseIp: string | null): Promise<{ id: number; empreinte: string }> {
  await exigerEcriture(acteur);
  if (!/\.xlsx$/i.test(nomFichier)) throw new ErreurMetier("Format non pris en charge : déposez un classeur .xlsx (Excel).");
  if (contenu.byteLength > TAILLE_MAX_CLASSEUR) throw new ErreurMetier(`Le fichier dépasse ${TAILLE_MAX_CLASSEUR / 1024 / 1024} Mo.`);
  const lu = await analyserClasseur(contenu);
  if (lu.erreurs.length > 0 || !lu.bareme) throw new ErreurImportBareme(lu.erreurs);
  const brouillon = await enregistrerBrouillonBareme(acteur, versionId, lu.bareme, adresseIp);
  await journaliser({
    acteur: { id: acteur.id, identifiant: acteur.identifiant },
    action: "BAREME_IMPORTE",
    objetType: "bareme_document",
    objetId: brouillon.id,
    apres: { versionId, fichier: nomFichier.slice(0, 200), octets: contenu.byteLength, empreinte: brouillon.empreinte },
    adresseIp,
  });
  return brouillon;
}
