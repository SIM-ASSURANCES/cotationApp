"use server";

import { ASSIETTES_TAXE, type AssietteTaxe } from "@/domaine/calcul/calcul";
import type { EtatFormulaire } from "@/composants/types";
import { creerTaxe } from "@/serveur/parametrage";

import { champ, champOuNull, executerAction } from "../../executer";

export async function creerUneTaxe(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const assiette = champ(donnees, "assiette");
  return executerAction(
    (acteur, ip) =>
      creerTaxe(
        acteur,
        {
          branche: champ(donnees, "branche").toUpperCase(),
          tauxPourcent: champ(donnees, "tauxPourcent"),
          assiette: (ASSIETTES_TAXE as readonly string[]).includes(assiette) ? (assiette as AssietteTaxe) : "NETTE_ACCESSOIRES",
          dateEffet: champ(donnees, "dateEffet"),
          dateFin: champOuNull(donnees, "dateFin"),
        },
        ip,
      ),
    "Taxe enregistrée. Une ligne en vigueur ne se modifie plus : pour changer le taux, ajoutez une ligne avec une nouvelle date d'effet.",
    "/parametrage/taxes",
  );
}
