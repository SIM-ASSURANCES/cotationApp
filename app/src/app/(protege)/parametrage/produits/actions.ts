"use server";

import type { EtatFormulaire } from "@/composants/types";
import { creerProduit } from "@/serveur/parametrage";

import { champ, executerAction } from "../../executer";

export async function creerUnProduit(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const code = champ(donnees, "code").toUpperCase();
  return executerAction(
    (acteur, ip) =>
      creerProduit(
        acteur,
        { code, libelle: champ(donnees, "libelle"), gamme: champ(donnees, "gamme"), branche: champ(donnees, "branche").toUpperCase() },
        ip,
      ),
    `Produit ${code} créé : ajoutez-lui maintenant une première version (formules et règles de calcul).`,
    "/parametrage/produits",
  );
}
