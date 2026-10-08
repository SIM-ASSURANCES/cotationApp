"use server";

import type { EtatFormulaire } from "@/composants/types";
import { creerBranche, modifierBranche } from "@/serveur/parametrage";

import { champ, executerAction } from "../../executer";

export async function creerUneBranche(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const code = champ(donnees, "code").toUpperCase();
  return executerAction(
    (acteur, ip) => creerBranche(acteur, { code, libelle: champ(donnees, "libelle") }, ip),
    `Branche ${code} ajoutée : vous pouvez maintenant lui paramétrer des taux de taxe et lui rattacher des produits.`,
    "/parametrage/branches",
  );
}

export async function modifierUneBranche(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const code = champ(donnees, "code");
  return executerAction(
    (acteur, ip) => modifierBranche(acteur, code, { libelle: champ(donnees, "libelle"), actif: donnees.get("actif") === "on" }, ip),
    `Branche ${code} modifiée.`,
    "/parametrage/branches",
  );
}
