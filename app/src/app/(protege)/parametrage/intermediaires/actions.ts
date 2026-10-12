"use server";

import type { EtatFormulaire } from "@/composants/types";
import { creerIntermediaire, modifierIntermediaire } from "@/serveur/intermediaires";

import { champ, executerAction } from "../../executer";

export async function creerUnIntermediaire(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const code = champ(donnees, "code").toUpperCase();
  return executerAction(
    (acteur, ip) => creerIntermediaire(acteur, { code, nom: champ(donnees, "nom"), role: champ(donnees, "role") }, ip),
    `Intermédiaire ${code} ajouté : il peut maintenant être choisi sur une cotation.`,
    "/parametrage/intermediaires",
  );
}

export async function modifierUnIntermediaire(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const code = champ(donnees, "code");
  return executerAction(
    (acteur, ip) => modifierIntermediaire(acteur, code, { nom: champ(donnees, "nom"), role: champ(donnees, "role"), actif: donnees.get("actif") === "on" }, ip),
    `Intermédiaire ${code} modifié.`,
    "/parametrage/intermediaires",
  );
}
