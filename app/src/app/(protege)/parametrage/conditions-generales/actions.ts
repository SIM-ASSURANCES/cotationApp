"use server";

import type { EtatFormulaire } from "@/composants/types";
import { rattacherCgBranche } from "@/serveur/cg-branches";

import { champ, executerAction } from "../../executer";

export async function rattacherUneCg(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const branchePrincipale = champ(donnees, "branchePrincipale");
  const modeleCode = champ(donnees, "modeleCode").toUpperCase();
  const dateEffet = champ(donnees, "dateEffet");
  return executerAction(
    (acteur, ip) => rattacherCgBranche(acteur, { branchePrincipale, modeleCode, dateEffet }, ip),
    `Conditions générales ${modeleCode} rattachées à la branche ${branchePrincipale} à partir du ${dateEffet}.`,
    "/parametrage/conditions-generales",
  );
}
