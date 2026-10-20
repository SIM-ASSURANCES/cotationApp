"use server";

import type { EtatFormulaire } from "@/composants/types";
import { creerVersion, modifierBranchePrincipaleProduit } from "@/serveur/parametrage";

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

export async function renseignerBranchePrincipale(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const code = champ(donnees, "codeProduit");
  const branchePrincipale = champ(donnees, "branchePrincipale").toUpperCase();
  return executerAction(
    (acteur, ip) => modifierBranchePrincipaleProduit(acteur, code, branchePrincipale, ip),
    `Branche principale du produit ${code} enregistrée (${branchePrincipale}).`,
    `/parametrage/produits/${code}`,
  );
}
