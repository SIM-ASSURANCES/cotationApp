"use server";

import type { EtatFormulaire } from "@/composants/types";
import { creerClient } from "@/serveur/clients";

import { champ, executerAction } from "../executer";

export async function creerUnClient(_etat: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  return executerAction(
    async (acteur, ip) =>
      void (await creerClient(
        acteur,
        {
          type: champ(d, "souscripteur_type") === "MORALE" ? "MORALE" : "PHYSIQUE",
          nom: champ(d, "souscripteur_nom"),
          prenoms: champ(d, "souscripteur_prenoms"),
          raison_sociale: champ(d, "souscripteur_raison_sociale"),
          telephone: champ(d, "souscripteur_telephone"),
          email: champ(d, "souscripteur_email"),
          adresse: champ(d, "souscripteur_adresse"),
        },
        ip,
      )),
    "Client ajouté.",
    "/clients",
  );
}
