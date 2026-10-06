import type { CodeProfil } from "@/domaine/droits";

/** Utilisateur connecté, relu en base à chaque requête (jamais déduit du seul jeton de session). */
export type UtilisateurCourant = {
  id: number;
  identifiant: string;
  nom: string;
  profil: CodeProfil;
  libelleProfil: string;
  doitChangerMotDePasse: boolean;
};

/** Refus pour une raison que l'utilisateur peut lire (affichée telle quelle, avec ses détails éventuels). */
export class ErreurMetier extends Error {
  override name = "ErreurMetier";
  constructor(
    message: string,
    /** Liste à afficher sous le message (ex. chaque problème d'un modèle Word refusé, avec son emplacement). */
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

/** Droit insuffisant. */
export class ErreurAcces extends Error {
  override name = "ErreurAcces";
}
