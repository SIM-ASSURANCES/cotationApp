"use server";

import { ASSIETTES_TAXE, type AssietteTaxe } from "@/domaine/calcul/calcul";
import type { EtatFormulaire } from "@/composants/types";
import { normaliserMontantSaisi } from "@/domaine/calcul/montant";
import { estTypeContrat } from "@/domaine/calcul/taxes";
import { creerTaxe } from "@/serveur/parametrage";

import { champ, champOuNull, executerAction } from "../../executer";

export async function creerUneTaxe(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  const assiette = champ(donnees, "assiette");
  const type = champ(donnees, "typeContrat");
  if (type !== "" && !estTypeContrat(type)) return { erreur: "Type de contrat invalide." };
  const tauxMixte = donnees.get("tauxMixte") === "on";
  const taux = champOuNull(donnees, "tauxPourcent");
  return executerAction(
    (acteur, ip) =>
      creerTaxe(
        acteur,
        {
          branche: champ(donnees, "branche").toUpperCase(),
          typeContrat: estTypeContrat(type) ? type : null,
          tauxPourcent: taux === null ? null : normaliserMontantSaisi(taux),
          tauxMixte,
          commentaire: champOuNull(donnees, "commentaire"),
          assiette: (ASSIETTES_TAXE as readonly string[]).includes(assiette) ? (assiette as AssietteTaxe) : "NETTE_ACCESSOIRES",
          dateEffet: champ(donnees, "dateEffet"),
          dateFin: champOuNull(donnees, "dateFin"),
        },
        ip,
      ),
    "Taux enregistré. Une ligne en vigueur ne se modifie plus : pour changer le taux, ajoutez une version avec une nouvelle date d'effet (la version précédente est alors clôturée la veille).",
    "/parametrage/taxes",
  );
}
