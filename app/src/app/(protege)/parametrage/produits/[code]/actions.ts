"use server";

import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
import type { Ecart } from "@/domaine/bareme";
import { basculerVersionAuBareme, decrireEcart, enregistrerBrouillonBareme, publierBareme, rejouerLesEssaisBareme } from "@/serveur/bareme";
import { creerBaremeVide, creerVersionDepuisBareme } from "@/serveur/bareme-edition";
import { importerBaremeXlsx } from "@/serveur/bareme-excel";
import { creerVersion, modifierBranchePrincipaleProduit } from "@/serveur/parametrage";

import { avecMessage, champ, executerAction } from "../../../executer";
import { lireVersion } from "./lire-version";

export async function ajouterUneVersion(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const saisie = lireVersion(donnees);
  const code = champ(donnees, "codeProduit");
  return executerAction(
    (acteur, ip) => creerVersion(acteur, code, saisie, ip),
    `Version du ${saisie.dateEffet} enregistrée : elle s'applique aux documents datés à partir de ce jour.`,
    `/parametrage/produits/${code}`,
  );
}

export async function renseignerBranchePrincipale(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const code = champ(donnees, "codeProduit");
  const branchePrincipale = champ(donnees, "branchePrincipale").toUpperCase();
  return executerAction(
    (acteur, ip) => modifierBranchePrincipaleProduit(acteur, code, branchePrincipale, ip),
    `Branche principale du produit ${code} enregistrée (${branchePrincipale}).`,
    `/parametrage/produits/${code}`,
  );
}

// ---------------------------------------------------------------- Barème d'une version (B9, D50)

const TAILLE_MAX_BAREME = 5 * 1024 * 1024;
const versionId = (donnees: FormData) => Number(champ(donnees, "versionId"));
const chemin = (donnees: FormData) => `/parametrage/produits/${champ(donnees, "codeProduit")}`;

export async function importerLeBareme(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const fichier = donnees.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return { erreur: "Choisissez le classeur Excel (.xlsx) à importer." };
  if (fichier.size > TAILLE_MAX_BAREME) return { erreur: "Le fichier dépasse 5 Mo." };
  const contenu = new Uint8Array(await fichier.arrayBuffer());
  return executerAction((acteur, ip) => importerBaremeXlsx(acteur, versionId(donnees), fichier.name, contenu, ip).then(() => undefined), "Classeur importé : le barème est maintenant le brouillon de cette version. Rejouez les essais, puis publiez-le.", chemin(donnees));
}

export async function rejouerLesEssais(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  let ecarts: Ecart[] = [];
  return executerAction(
    async (acteur) => {
      ecarts = await rejouerLesEssaisBareme(acteur, versionId(donnees));
      return ecarts.map(decrireEcart);
    },
    () => (ecarts.length === 0 ? "Tous les jeux d'essai sont verts." : `${ecarts.length} écart(s) entre les jeux d'essai et le calcul du barème (la publication serait refusée) :`),
    chemin(donnees),
  );
}

export async function publierLeBareme(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => publierBareme(acteur, versionId(donnees), champ(donnees, "motif"), ip).then(() => undefined), "Barème publié : il ne se modifie plus. Basculez maintenant la version au barème.", chemin(donnees));
}

export async function basculerAuBareme(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => basculerVersionAuBareme(acteur, versionId(donnees), ip), "Version basculée au barème.", chemin(donnees));
}

// ---------------------------------------------------------------- Barème à l'écran (B4, D58)

const cheminEditeur = (codeProduit: string, id: number) => `/parametrage/produits/${codeProduit}/bareme/${id}`;

/** « Créer un barème vide » : un brouillon neuf sur la version, puis l'éditeur. */
export async function creerUnBaremeVide(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const r = await avecMessage((acteur, ip) => creerBaremeVide(acteur, versionId(donnees), ip));
  if (!r.ok) return r.etat;
  redirect(cheminEditeur(champ(donnees, "codeProduit"), versionId(donnees)));
}

/** Correction d'un barème publié : nouvelle version (date saisie) qui reçoit la copie en brouillon, puis l'éditeur de cette version (H157). */
export async function creerUneVersionDepuisLeBareme(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const r = await avecMessage((acteur, ip) => creerVersionDepuisBareme(acteur, versionId(donnees), champ(donnees, "dateEffet"), ip));
  if (!r.ok) return r.etat;
  redirect(cheminEditeur(r.valeur.codeProduit, r.valeur.versionId));
}

/**
 * Enregistre le document de l'éditeur comme brouillon de la version : le schéma est exigé, les problèmes d'intégrité sont rendus en
 * avertissements (ils bloquent la publication, pas l'enregistrement d'un travail en cours, H158).
 */
export async function enregistrerLeBaremeEcran(codeProduit: string, id: number, document: string): Promise<EtatFormulaire> {
  let contenu: unknown;
  try {
    contenu = JSON.parse(document);
  } catch {
    return { erreur: "Le document envoyé est illisible : rechargez la page." };
  }
  let nombre = 0;
  return executerAction(
    async (acteur, ip) => {
      const { problemes } = await enregistrerBrouillonBareme(acteur, id, contenu, ip, { toleranceIntegrite: true });
      nombre = problemes.length;
      return problemes.map((p) => `[${p.code}] ${p.message}`);
    },
    () => (nombre === 0 ? "Brouillon enregistré." : `Brouillon enregistré. ${nombre} problème(s) restent à corriger avant la publication :`),
    `/parametrage/produits/${codeProduit}`,
  );
}

/** « Rejouer les essais » depuis l'éditeur : calcule le brouillon enregistré, ne modifie rien. */
export async function rejouerLesEssaisEcran(codeProduit: string, id: number): Promise<EtatFormulaire> {
  let ecarts: Ecart[] = [];
  return executerAction(
    async (acteur) => {
      ecarts = await rejouerLesEssaisBareme(acteur, id);
      return ecarts.map(decrireEcart);
    },
    () => (ecarts.length === 0 ? "Tous les jeux d'essai sont verts." : `${ecarts.length} écart(s) entre les jeux d'essai et le calcul du barème (la publication serait refusée) :`),
    `/parametrage/produits/${codeProduit}`,
  );
}
