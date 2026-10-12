"use server";

import type { EtatFormulaire } from "@/composants/types";
import { enregistrerParametresRelance } from "@/serveur/echeances";

import { champ, executerAction } from "../../../../executer";

/** Lignes de niveaux saisies : les lignes vides sont ignorées ; un délai illisible est refusé par les contrôles du domaine. */
function niveaux(d: FormData) {
  const resultat: { niveau: number; jours: number; libelle: string }[] = [];
  for (let i = 1; i <= 9; i++) {
    const jours = champ(d, `jours${i}`);
    const libelle = champ(d, `libelle${i}`);
    if (jours === "" && libelle === "") continue;
    resultat.push({ niveau: resultat.length + 1, jours: /^\d+$/.test(jours) ? Number(jours) : Number.NaN, libelle });
  }
  return resultat;
}

export async function enregistrerLesRelances(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const code = champ(d, "produit");
  const delai = champ(d, "delaiAvisJours");
  return executerAction(
    (acteur, ip) => enregistrerParametresRelance(acteur, code, { delaiAvisJours: /^\d+$/.test(delai) ? Number(delai) : Number.NaN, niveaux: niveaux(d) }, champ(d, "dateEffet"), ip),
    "Paramètres enregistrés : ils s'appliquent à partir de leur date d'effet (historique ci-dessous).",
    `/parametrage/produits/${code}/relances`,
  );
}
