"use server";

import { redirect } from "next/navigation";

import type { EtatFormulaire } from "@/composants/types";
import { creerLotEcheances, genererAppel, LIBELLE_APPEL, type Appel, type TypeAppel } from "@/serveur/echeances";

import { avecMessage, champ, executerAction } from "../executer";

/** « AVIS_ECHEANCE|12|2|0 » : type, facture, n° d'échéance, niveau (0 pour un avis). */
function lireAppel(valeur: string): Appel | null {
  const [type, facture, echeance, niveau] = valeur.split("|");
  if (type !== "AVIS_ECHEANCE" && type !== "RELANCE") return null;
  const n = [facture, echeance, niveau].map(Number);
  if (!n.every(Number.isInteger)) return null;
  return { type: type as TypeAppel, factureId: n[0], echeanceNumero: n[1], niveau: type === "RELANCE" ? n[2] : null };
}

/**
 * Formulaire de la liste du jour : un bouton « Générer » par ligne (génération individuelle, valeur du bouton), ou le
 * bouton du formulaire pour générer les lignes cochées par lot, via la file de tâches.
 */
export async function genererDepuisLaListe(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const un = champ(d, "un");
  if (un !== "") {
    const appel = lireAppel(un);
    if (!appel) return { erreur: "Ligne illisible : rechargez la page." };
    let message = "";
    return executerAction(
      async (acteur, ip) => {
        const r = await genererAppel(acteur, appel, ip);
        const quoi = LIBELLE_APPEL[appel.type];
        message =
          r.statut === "PRODUIT"
            ? r.production.ok
              ? `${quoi[0].toUpperCase()}${quoi.slice(1)} ${r.numero} produit.`
              : `${r.numero} émis, PDF en attente : ${r.production.erreur}`
            : r.statut === "DEJA_PRODUIT"
              ? `Déjà produit : ${r.numero} (un seul document par échéance${appel.type === "RELANCE" ? " et par niveau" : ""}).`
              : `Rien à produire : ${r.message}`;
      },
      () => message,
      "/echeances",
    );
  }
  const selection = d.getAll("selection").map((v) => lireAppel(String(v)));
  if (selection.some((s) => s === null)) return { erreur: "Sélection illisible : rechargez la page." };
  const r = await avecMessage((acteur, ip) => creerLotEcheances(acteur, selection as Appel[], ip));
  if (!r.ok) return r.etat;
  redirect(`/echeances/lots/${r.valeur.lotId}${r.valeur.enFile ? "" : "?horsFile=1"}`);
}
