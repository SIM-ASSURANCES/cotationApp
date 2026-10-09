"use server";

import type { EtatFormulaire } from "@/composants/types";
import { IMAGES_SOCIETE, lireLignes, type ImageSociete, type ParametresSociete } from "@/domaine/documents/societe";
import { enregistrerFormatNumero, enregistrerFormatNumeroPolice, enregistrerImageSociete, enregistrerSociete } from "@/serveur/societe";

import { champ, executerAction } from "../../executer";

export async function enregistrerLaSociete(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const parametres: ParametresSociete = {
    societe: {
      raison_sociale: champ(d, "raison_sociale"),
      forme: champ(d, "forme"),
      capital: champ(d, "capital"),
      capital_libere: champ(d, "capital_libere"),
      adresse: champ(d, "adresse"),
      bp: champ(d, "bp"),
      telephone: champ(d, "telephone"),
      email_reclamation: champ(d, "email_reclamation"),
      site: champ(d, "site"),
      rccm: champ(d, "rccm"),
      ncc: champ(d, "ncc"),
      agrement: champ(d, "agrement"),
      rib: lireLignes(champ(d, "rib"), ["banque", "numero"] as const),
      mobile_money: lireLignes(champ(d, "mobile_money"), ["operateur", "numero_marchand"] as const),
      recours: lireLignes(champ(d, "recours"), ["libelle", "url"] as const),
    },
    document: { lieu_emission: champ(d, "lieu_emission"), signataire_nom: champ(d, "signataire_nom"), signataire_fonction: champ(d, "signataire_fonction") },
  };
  return executerAction((acteur, ip) => enregistrerSociete(acteur, parametres, champ(d, "dateEffet"), ip), "Paramètres de la société enregistrés.", "/parametrage/societe");
}

export async function enregistrerUneImage(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const nom = champ(d, "nom") as ImageSociete;
  const fichier = d.get("fichier");
  if (!(IMAGES_SOCIETE as readonly string[]).includes(nom) || !(fichier instanceof File) || fichier.size === 0) return { erreur: "Choisissez une image PNG." };
  const png = new Uint8Array(await fichier.arrayBuffer());
  return executerAction((acteur, ip) => enregistrerImageSociete(acteur, nom, png, champ(d, "dateEffet"), ip), "Image enregistrée.", "/parametrage/societe");
}

/** Format du numéro de police (H10, H31) : historisé, journalisé. */
export async function enregistrerLeFormatPolice(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => enregistrerFormatNumeroPolice(acteur, champ(d, "format"), champ(d, "dateEffet"), ip), "Format du numéro de police enregistré.", "/parametrage/societe");
}

/** Format des numéros de cotation, facture, avoir, reçu (session 4b) : historisé, journalisé (avant, après). */
export async function enregistrerLeFormatNumero(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => enregistrerFormatNumero(acteur, champ(d, "prefixe"), champ(d, "format"), champ(d, "dateEffet"), ip), "Format de numéro enregistré.", "/parametrage/societe");
}
