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

/** Refus pour une raison que l'utilisateur peut lire (affichée telle quelle). */
export class ErreurMetier extends Error {
  override name = "ErreurMetier";
}

/** Droit insuffisant. */
export class ErreurAcces extends Error {
  override name = "ErreurAcces";
}
