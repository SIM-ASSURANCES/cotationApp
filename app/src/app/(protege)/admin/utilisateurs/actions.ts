"use server";

import { revalidatePath } from "next/cache";

import type { EtatFormulaire } from "@/composants/types";
import { adresseIpCourante } from "@/serveur/requete";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "@/serveur/types";
import { creerUtilisateur, modifierUtilisateur, reinitialiserMotDePasse } from "@/serveur/utilisateurs";

const texte = (donnees: FormData, nom: string) => String(donnees.get(nom) ?? "");

/** Exécute l'opération avec l'utilisateur connecté ; les refus métier deviennent un message à l'écran. */
async function executer(
  operation: (acteur: UtilisateurCourant, adresseIp: string | null) => Promise<void>,
  succes: string,
): Promise<EtatFormulaire> {
  const acteur = await exigerUtilisateur();
  try {
    await operation(acteur, await adresseIpCourante());
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) {
      return { erreur: erreur.message };
    }
    if (erreur instanceof ErreurAcces) {
      return { erreur: "Vous n'avez pas le droit d'effectuer cette action." };
    }
    throw erreur;
  }
  revalidatePath("/admin/utilisateurs");
  return { succes };
}

export async function creerUnUtilisateur(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  return executer(
    (acteur, ip) =>
      creerUtilisateur(
        acteur,
        {
          identifiant: texte(donnees, "identifiant"),
          nom: texte(donnees, "nom"),
          profil: texte(donnees, "profil"),
          motDePasse: texte(donnees, "motDePasse"),
        },
        ip,
      ),
    "Utilisateur créé : il devra changer son mot de passe à la première connexion.",
  );
}

export async function modifierUnUtilisateur(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  return executer(
    (acteur, ip) =>
      modifierUtilisateur(
        acteur,
        Number(texte(donnees, "id")),
        { nom: texte(donnees, "nom"), profil: texte(donnees, "profil"), actif: donnees.get("actif") === "on" },
        ip,
      ),
    "Enregistré.",
  );
}

export async function reinitialiserUnMotDePasse(_etat: EtatFormulaire, donnees: FormData): Promise<EtatFormulaire> {
  return executer(
    (acteur, ip) => reinitialiserMotDePasse(acteur, Number(texte(donnees, "id")), texte(donnees, "motDePasse"), ip),
    "Mot de passe provisoire défini : l'utilisateur devra le changer à sa prochaine connexion.",
  );
}
