"use server";

import type { EtatFormulaire } from "@/composants/types";
import type { Assure } from "@/domaine/cotation/saisie";
import { incorporerAdherents, retirerAdherents } from "@/serveur/adherents";
import { emettreCertificat, mettreAJourCp } from "@/serveur/documents";

import { champ, executerAction } from "../../../executer";

const identifiants = (d: FormData) => ({ cotationId: Number(champ(d, "cotationId")), policeId: Number(champ(d, "policeId")) });
const colonne = (d: FormData, nom: string) => d.getAll(nom).map((v) => String(v).trim());

/** Nouveaux adhérents saisis (mêmes colonnes que les assurés d'une cotation) ; les lignes vides sont ignorées. */
function lireNouveaux(d: FormData): Omit<Assure, "ordre">[] {
  const [noms, naissances, sexes, liens, formules] = ["assure_nom", "assure_naissance", "assure_sexe", "assure_lien", "assure_formule"].map((n) => colonne(d, n));
  return noms
    .map((nom, i) => ({
      nom_prenoms: nom,
      date_naissance: (naissances[i] ?? "") as Assure["date_naissance"],
      sexe: (sexes[i] ?? "") as Assure["sexe"],
      lien: liens[i] ?? "",
      formule: formules[i] ?? "",
    }))
    .filter((a) => a.nom_prenoms !== "" || a.date_naissance !== "" || a.lien !== "");
}

export async function incorporerLesAdherents(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const { cotationId, policeId } = identifiants(d);
  return executerAction(
    async (acteur, ip) => void (await incorporerAdherents(acteur, policeId, champ(d, "dateEffet"), lireNouveaux(d), ip)),
    "Adhérents incorporés : nouvelle version de la liste.",
    `/cotations/${cotationId}/adherents`,
  );
}

export async function retirerLesAdherents(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const { cotationId, policeId } = identifiants(d);
  const ordres = d.getAll("retrait").map((v) => Number(v));
  return executerAction(
    async (acteur, ip) => void (await retirerAdherents(acteur, policeId, champ(d, "dateEffet"), ordres, ip)),
    "Adhérents retirés : nouvelle version de la liste.",
    `/cotations/${cotationId}/adherents`,
  );
}

export async function emettreLeCertificat(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const { cotationId, policeId } = identifiants(d);
  return executerAction(
    async (acteur, ip) => void (await emettreCertificat(acteur, policeId, Number(champ(d, "ordre")), champ(d, "numero"), ip)),
    "Certificat d'adhésion émis.",
    `/cotations/${cotationId}/adherents`,
  );
}

export async function mettreAJourLesCp(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  const { cotationId, policeId } = identifiants(d);
  return executerAction(async (acteur, ip) => void (await mettreAJourCp(acteur, policeId, ip)), "Nouvelle version des conditions particulières émise.", `/cotations/${cotationId}/adherents`);
}
