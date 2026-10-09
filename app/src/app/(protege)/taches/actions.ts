"use server";

import type { EtatFormulaire } from "@/composants/types";
import { fermerTache } from "@/serveur/taches-police";

import { champ, executerAction } from "../executer";

/** Fermeture manuelle d'une tâche d'import (H66) : motif obligatoire ; la page d'où vient la demande est rafraîchie. */
export async function fermerLaTache(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const tacheId = Number(champ(d, "tacheId"));
  const retour = champ(d, "retour");
  const chemin = /^\/cotations\/\d+(\/adherents)?$/.test(retour) ? retour : "/cotations";
  return executerAction((acteur, ip) => fermerTache(acteur, tacheId, champ(d, "motif"), ip), "Tâche fermée (motif journalisé).", chemin);
}
