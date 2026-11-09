"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
import type { ControlesDePublication, Ecart } from "@/domaine/bareme";
import { formaterDate } from "@/domaine/calcul/dates";
import { DATE_EFFET_A_LA_PUBLICATION } from "@/domaine/calcul/parametrage";
import { basculerVersionAuBareme, controlerAvantPublication, decrireEcart, enregistrerBrouillonBareme, publierBaremeDetaille, rejouerLesEssaisBareme, type PublicationFaite } from "@/serveur/bareme";
import { creerBaremeVide, creerVersionDepuisBareme } from "@/serveur/bareme-edition";
import { importerBaremeXlsx } from "@/serveur/bareme-excel";
import { creerVersion, modifierBranchePrincipaleProduit, type VersionCreee } from "@/serveur/parametrage";

import { avecMessage, champ, executerAction } from "../../../executer";
import { lireVersion } from "./lire-version";

/** Date d'effet d'une version : « dès la publication » (choix `effet`, D66) vaut la date provisoire, sinon la date saisie. */
const dateDemandee = (donnees: FormData): string =>
  // Le choix `effet` est envoyé par la section « barème » même masquée : il ne compte que pour une version au barème (ou pour la correction d'un barème, sans mode).
  champ(donnees, "effet") === "PUBLICATION" && ["", "BAREME"].includes(champ(donnees, "modeTarification")) ? DATE_EFFET_A_LA_PUBLICATION : champ(donnees, "dateEffet");

export async function ajouterUneVersion(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const saisie = { ...lireVersion(donnees), dateEffet: dateDemandee(donnees) };
  const code = champ(donnees, "codeProduit");
  let creee: VersionCreee | undefined;
  return executerAction(
    async (acteur, ip) => {
      creee = await creerVersion(acteur, code, saisie, ip, { motifPublication: champ(donnees, "motifPublication") });
    },
    () =>
      creee?.modeTarification !== "BAREME"
        ? `Version du ${formaterDate(creee?.dateEffet ?? saisie.dateEffet)} enregistrée : elle s'applique aux documents datés à partir de ce jour.`
        : creee.baremePublie
          ? `Version au barème enregistrée avec le barème publié repris : elle s'applique à partir du ${formaterDate(creee.dateEffet)}.`
          : "Version au barème créée « en préparation » : créez ou importez son barème, puis publiez-le. D'ici là, la version précédente continue de servir.",
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

/** Message après une publication : une version au barème entre en vigueur par sa publication (D66) ; une version provisoire d'avant D66 se bascule encore. */
const messagePublication = (p: PublicationFaite): string =>
  p.modeTarification === "BAREME"
    ? `Barème publié : il ne se modifie plus. La version s'applique à partir du ${formaterDate(p.dateEffet)}.`
    : "Barème publié : il ne se modifie plus. Basculez maintenant la version au barème.";

export async function publierLeBareme(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  let faite: PublicationFaite | undefined;
  return executerAction(
    async (acteur, ip) => {
      faite = await publierBaremeDetaille(acteur, versionId(donnees), champ(donnees, "motif"), ip);
    },
    () => (faite ? messagePublication(faite) : "Barème publié."),
    chemin(donnees),
  );
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
  const r = await avecMessage((acteur, ip) => creerVersionDepuisBareme(acteur, versionId(donnees), dateDemandee(donnees), ip));
  if (!r.ok) return r.etat;
  redirect(cheminEditeur(r.valeur.codeProduit, r.valeur.versionId));
}

const ficheProduit = (codeProduit: string) => `/parametrage/produits/${codeProduit}`;

/**
 * Enregistre le document de l'éditeur comme brouillon de la version : le schéma est exigé, les problèmes d'intégrité sont rendus en
 * avertissements (ils bloquent la publication, pas l'enregistrement d'un travail en cours, H158). Rend aussi l'empreinte du brouillon.
 */
export async function enregistrerLeBaremeEcran(codeProduit: string, id: number, document: string): Promise<EtatFormulaire & { empreinte?: string }> {
  let contenu: unknown;
  try {
    contenu = JSON.parse(document);
  } catch {
    return { erreur: "Le document envoyé est illisible : rechargez la page." };
  }
  let nombre = 0;
  let empreinte: string | undefined;
  const etat = await executerAction(
    async (acteur, ip) => {
      const r = await enregistrerBrouillonBareme(acteur, id, contenu, ip, { toleranceIntegrite: true });
      nombre = r.problemes.length;
      empreinte = r.empreinte;
      return r.problemes.map((p) => `[${p.code}] ${p.message}`);
    },
    () => (nombre === 0 ? "Brouillon enregistré." : `Brouillon enregistré. ${nombre} problème(s) restent à corriger avant la publication :`),
    ficheProduit(codeProduit),
  );
  return etat.succes ? { ...etat, empreinte } : etat;
}

/** « Rejouer les essais » depuis l'éditeur : calcule le brouillon enregistré et rend les écarts ligne à ligne ; ne modifie rien. */
export async function rejouerLesEssaisEcran(codeProduit: string, id: number): Promise<{ etat: EtatFormulaire; ecarts?: Ecart[] }> {
  let ecarts: Ecart[] | undefined;
  const etat = await executerAction(
    async (acteur) => {
      ecarts = await rejouerLesEssaisBareme(acteur, id);
      return ecarts.map(decrireEcart);
    },
    () => (ecarts && ecarts.length === 0 ? "Tous les jeux d'essai sont verts." : `${ecarts?.length ?? 0} écart(s) entre les jeux d'essai et le calcul du barème (la publication serait refusée) :`),
    ficheProduit(codeProduit),
  );
  return { etat, ...(etat.erreur ? {} : { ecarts }) };
}

/** Onglet Publier : rejoue tous les essais et contrôle les balises des modèles publiés, comme le ferait la publication ; ne modifie rien. */
export async function controlerLaPublicationEcran(codeProduit: string, id: number): Promise<{ etat?: EtatFormulaire; controles?: ControlesDePublication }> {
  void codeProduit;
  const r = await avecMessage((acteur) => controlerAvantPublication(acteur, id));
  return r.ok ? { controles: r.valeur } : { etat: r.etat };
}

/** Onglet Publier : publication du brouillon enregistré (motif obligatoire), par le service existant. */
export async function publierLeBaremeEcran(codeProduit: string, id: number, motif: string): Promise<EtatFormulaire> {
  let faite: PublicationFaite | undefined;
  const etat = await executerAction(
    async (acteur, ip) => {
      faite = await publierBaremeDetaille(acteur, id, motif, ip);
    },
    () => (faite ? `${messagePublication(faite).replace("Barème publié :", `Barème publié (empreinte ${faite.empreinte}) :`)}` : "Barème publié."),
    cheminEditeur(codeProduit, id),
  );
  if (etat.succes) revalidatePath(ficheProduit(codeProduit));
  return etat;
}

/** Onglet Publier : bascule de la version au mode barème, par le service existant. */
export async function basculerLeBaremeEcran(codeProduit: string, id: number): Promise<EtatFormulaire> {
  const etat = await executerAction((acteur, ip) => basculerVersionAuBareme(acteur, id, ip), "Version basculée au barème.", cheminEditeur(codeProduit, id));
  if (etat.succes) revalidatePath(ficheProduit(codeProduit));
  return etat;
}
