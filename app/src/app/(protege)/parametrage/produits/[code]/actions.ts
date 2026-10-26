"use server";

import type { EtatFormulaire } from "@/composants/types";
import type { Ecart } from "@/domaine/bareme";
import { basculerVersionAuBareme, decrireEcart, publierBareme, rejouerLesEssaisBareme } from "@/serveur/bareme";
import { importerBaremeXlsx } from "@/serveur/bareme-excel";
import { creerVersion, modifierBranchePrincipaleProduit } from "@/serveur/parametrage";

import { champ, executerAction } from "../../../executer";
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
