"use server";

import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
import { avertissementNumeroContrat } from "@/domaine/cotation/police";
import { accepter, composerLaPrime, creerBrouillon, modifierBrouillon, refuser, renvoyerEnBrouillon, soumettre, valider } from "@/serveur/cotations";
import { emettreCotation, reediter, soumettreCp } from "@/serveur/documents";
import { ErreurMetier, type UtilisateurCourant } from "@/serveur/types";

import { avecMessage, champ, executerAction } from "../executer";
import { lireBeneficiaires, lireComplementsSouscripteur, lireContactsUrgence } from "../lire-complements";
import { lireCotation } from "./lire-cotation";
import { lireLignesDePrime } from "./lire-composition";

/** Crée ou modifie un brouillon, puis ouvre sa fiche. */
export async function enregistrerCotation(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const saisie = lireCotation(donnees);
  const r = await avecMessage(async (acteur, ip) => {
    if (saisie.id !== null) {
      await modifierBrouillon(acteur, saisie.id, saisie, ip);
      return saisie.id;
    }
    return creerBrouillon(acteur, saisie, ip);
  });
  if (!r.ok) return r.etat;
  redirect(`/cotations/${r.valeur}`);
}

const idDe = (d: FormData) => Number(champ(d, "id"));

/**
 * Après l'émission d'une cotation, son PDF est émis aussitôt. S'il ne peut pas l'être (modèle non
 * publié, générateur indisponible…), la cotation reste émise et le motif est affiché : le bouton
 * « Émettre le PDF » permet de recommencer.
 */
async function pdfApresEmission(acteur: UtilisateurCourant, id: number, ip: string | null): Promise<string[]> {
  try {
    const doc = await emettreCotation(acteur, id, ip);
    return [`PDF émis : ${doc.numero} (empreinte ${doc.empreinte.slice(0, 16)}…).`];
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return [`PDF non émis : ${erreur.message}`];
    throw erreur;
  }
}

export async function soumettreCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction(
    async (acteur, ip) => {
      const r = await soumettre(acteur, id, ip);
      return r.statut === "EMISE" ? pdfApresEmission(acteur, id, ip) : undefined;
    },
    "Cotation soumise.",
    `/cotations/${id}`,
  );
}

export async function validerCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction(
    async (acteur, ip) => {
      await valider(acteur, id, ip);
      return pdfApresEmission(acteur, id, ip);
    },
    "Cotation validée et émise.",
    `/cotations/${id}`,
  );
}

export async function emettrePdfDeCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction(async (acteur, ip) => void (await emettreCotation(acteur, id, ip)), "PDF de la cotation émis.", `/cotations/${id}`);
}

/**
 * Émission des conditions particulières. Au-dessus du seuil du produit, un profil « Oui (sous seuil) » ne peut pas
 * émettre : le contrat passe en validation (CDC §4 et §4.1) et un profil « Oui » l'émettra.
 */
export async function emettreCpDeCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  let enValidation = false;
  return executerAction(
    async (acteur, ip) => {
      enValidation = (await soumettreCp(acteur, id, ip)).statut === "A_VALIDER";
    },
    () => (enValidation ? "Le TTC dépasse le seuil du produit : le contrat est en attente de validation." : "Conditions particulières émises."),
    `/cotations/${id}`,
  );
}

export async function reediterDocument(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  const documentId = Number(champ(d, "documentId"));
  return executerAction(async (acteur, ip) => void (await reediter(acteur, documentId, ip)), "Document réédité : nouvelle version.", `/cotations/${id}`);
}

/** La Technique compose la prime d'un brouillon d'un produit tarifé par garanties (session 6.2b) : lignes de prime et motif obligatoire. */
export async function composerPrime(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  const lignes = lireLignesDePrime(d);
  const motif = champ(d, "motif");
  return executerAction(async (acteur, ip) => void (await composerLaPrime(acteur, id, lignes, motif, ip)), "Prime composée : les taxes sont calculées par ligne, les totaux sont à jour.", `/cotations/${id}`);
}

export async function renvoyerCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction((acteur, ip) => renvoyerEnBrouillon(acteur, id, champ(d, "commentaire"), ip), "Cotation renvoyée en brouillon.", `/cotations/${id}`);
}

export async function accepterCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  const retenues = d.getAll("retenue").map(String);
  // Compléments saisis à la souscription (souscripteur, bénéficiaires, contacts d'urgence), repris de la cotation.
  const complements = { souscripteur: lireComplementsSouscripteur(d), beneficiaires: lireBeneficiaires(d), contactsUrgence: lireContactsUrgence(d) };
  return executerAction(
    async (acteur, ip) => {
      const { numeroPolice } = await accepter(acteur, id, retenues, champ(d, "numeroPolice"), ip, complements);
      // Avertissement sans blocage (D27) : le numéro de contrat se termine normalement par 00000 après G ou I.
      const avertissement = avertissementNumeroContrat(numeroPolice);
      return avertissement ? [avertissement] : [];
    },
    "Cotation acceptée : la police est créée.",
    `/cotations/${id}`,
  );
}

export async function refuserCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction((acteur, ip) => refuser(acteur, id, champ(d, "motif"), champ(d, "commentaire"), ip), "Refus enregistré.", `/cotations/${id}`);
}
