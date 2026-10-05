"use server";

import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
import { accepter, creerBrouillon, modifierBrouillon, refuser, renvoyerEnBrouillon, soumettre, valider } from "@/serveur/cotations";

import { avecMessage, champ, executerAction } from "../executer";
import { lireCotation } from "./lire-cotation";

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

export async function soumettreCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction(async (acteur, ip) => void (await soumettre(acteur, id, ip)), "Cotation soumise.", `/cotations/${id}`);
}

export async function validerCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction(async (acteur, ip) => void (await valider(acteur, id, ip)), "Cotation validée et émise.", `/cotations/${id}`);
}

export async function renvoyerCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction((acteur, ip) => renvoyerEnBrouillon(acteur, id, champ(d, "commentaire"), ip), "Cotation renvoyée en brouillon.", `/cotations/${id}`);
}

export async function accepterCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  const retenues = d.getAll("retenue").map(String);
  return executerAction(async (acteur, ip) => void (await accepter(acteur, id, retenues, ip)), "Cotation acceptée : la police est créée.", `/cotations/${id}`);
}

export async function refuserCotation(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const id = idDe(d);
  return executerAction((acteur, ip) => refuser(acteur, id, champ(d, "motif"), champ(d, "commentaire"), ip), "Refus enregistré.", `/cotations/${id}`);
}
