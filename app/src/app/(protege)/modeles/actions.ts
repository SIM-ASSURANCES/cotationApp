"use server";

import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
import { LISTES_ANNEXE, TAILLE_MAX_MODELE, estTypeModele, type ListeAnnexe } from "@/domaine/documents/modeles";
import { creerModele, deposerVersion, enregistrerSeuilListe, publierVersion, renvoyerVersion, soumettreVersion } from "@/serveur/modeles";

import { avecMessage, champ, champOuNull, executerAction } from "../executer";

export async function creerUnModele(_etat: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const type = champ(d, "type");
  if (!estTypeModele(type)) return { erreur: "Choisissez le type de modèle." };
  const liste = champOuNull(d, "listeAnnexe");
  const niveau = champOuNull(d, "niveauRelance");
  const r = await avecMessage((acteur, ip) =>
    creerModele(
      acteur,
      {
        type,
        code: champ(d, "code").toUpperCase(),
        libelle: champ(d, "libelle"),
        produitCode: champOuNull(d, "produitCode"),
        niveauRelance: type === "RELANCE" && niveau !== null ? Number(niveau) : null,
        listeAnnexe: type === "ANNEXE" && liste !== null && (LISTES_ANNEXE as readonly string[]).includes(liste) ? (liste as ListeAnnexe) : null,
        blocNom: type === "SOUS_MODELE" ? champ(d, "blocNom") || null : null,
        blocCle: type === "SOUS_MODELE" ? champ(d, "blocCle") || null : null,
      },
      ip,
    ),
  );
  if (!r.ok) return r.etat;
  redirect(`/modeles/${r.valeur}`);
}

export async function deposerUneVersion(_etat: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const modeleId = Number(champ(d, "modeleId"));
  const fichier = d.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return { erreur: "Choisissez le fichier Word (.docx) à déposer." };
  if (fichier.size > TAILLE_MAX_MODELE) return { erreur: "Le fichier dépasse 15 Mo." };
  const contenu = new Uint8Array(await fichier.arrayBuffer());
  return executerAction(
    async (acteur, ip) => {
      const r = await deposerVersion(
        acteur,
        modeleId,
        {
          fichier: contenu,
          nomFichier: fichier.name,
          commentaire: champ(d, "commentaire"),
          dateEffet: champ(d, "dateEffet"),
          visa: champOuNull(d, "visa"),
          dateDocument: champOuNull(d, "dateDocument"),
        },
        ip,
      );
      return r.avertissements.map((a) => `Avertissement : ${a.message}${a.emplacement ? ` — ${a.emplacement}` : ""}`);
    },
    "Fichier contrôlé et déposé : nouvelle version en brouillon. Vérifiez son aperçu, puis soumettez-la.",
    `/modeles/${modeleId}`,
  );
}

const versionDe = (d: FormData) => Number(champ(d, "versionId"));
const cheminDe = (d: FormData) => `/modeles/${Number(champ(d, "modeleId"))}`;

export async function soumettreUneVersion(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => soumettreVersion(acteur, versionDe(d), ip), "Version soumise : elle attend sa publication par un autre profil.", cheminDe(d));
}

export async function publierUneVersion(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => publierVersion(acteur, versionDe(d), champ(d, "dateEffet"), ip), "Version publiée.", cheminDe(d));
}

export async function renvoyerUneVersion(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => renvoyerVersion(acteur, versionDe(d), champ(d, "motif"), ip), "Version renvoyée en brouillon.", cheminDe(d));
}

export async function enregistrerLeSeuil(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const valeur = Number(champ(d, "seuil"));
  return executerAction((acteur, ip) => enregistrerSeuilListe(acteur, valeur, champ(d, "dateEffet"), ip), "Seuil enregistré.", "/modeles");
}
