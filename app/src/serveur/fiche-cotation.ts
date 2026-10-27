import "server-only";

import { peutLire } from "@/domaine/droits";

import { documentsDe } from "./documents";
import { niveauDuProfil } from "./droits";
import { facturesDePolice, peutLireFactures } from "./factures";
import { tachesDeCotation } from "./taches-police";
import type { UtilisateurCourant } from "./types";
import { lireValidationContrat } from "./validation-contrat";

/**
 * Parties liées à la fiche d'une cotation : documents, contrat (validation), tâches de la police, factures. Chaque service a son propre
 * droit et REFUSE sans lui (ErreurAcces) : un refus levé pendant le rendu ferait planter la fiche. Une partie n'est donc chargée que si
 * le profil a le droit de la lire ; sinon elle est absente (`null`) et la page affiche « Accès réservé ». Le contrôle reste au serveur.
 */
export async function chargerPartiesLiees(acteur: UtilisateurCourant, cotation: { id: number; numeroPolice: string | null }) {
  const [niveauContrat, peutFactures] = await Promise.all([niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT"), cotation.numeroPolice ? peutLireFactures(acteur) : false]);
  const [documents, vueFactures, etatContrat, taches] = await Promise.all([
    documentsDe(acteur, { cotationId: cotation.id }), // filtre lui-même les types de documents que le profil peut lire
    cotation.numeroPolice && peutFactures ? facturesDePolice(acteur, cotation.id) : null,
    // Contrat au-dessus du seuil de validation : demande en cours, ou validation exigée de ce profil (CDC §4.1).
    cotation.numeroPolice && peutLire(niveauContrat) ? lireValidationContrat(acteur, cotation.id) : null,
    cotation.numeroPolice ? tachesDeCotation(acteur, cotation.id) : [], // vide sans droit sur le contrat ni sur les factures
  ]);
  return { documents, vueFactures, accesFactures: peutFactures, etatContrat, taches };
}
