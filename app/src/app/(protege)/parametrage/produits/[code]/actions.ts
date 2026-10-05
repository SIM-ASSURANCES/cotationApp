"use server";

import type { EtatFormulaire } from "@/composants/types";
import { creerVersion } from "@/serveur/parametrage";

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
