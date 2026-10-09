"use server";

import type { EtatFormulaire } from "@/composants/types";
import { abandonnerImport, confirmerImport, relancerEchecs } from "@/serveur/imports";

import { champ, executerAction } from "../executer";

const lot = (d: FormData) => Number(champ(d, "lotId"));
const messageFile = (enFile: boolean) =>
  enFile
    ? "Traitement lancé en tâche de fond : vous pouvez continuer à travailler, l'avancement s'affiche ici."
    : "Adhérents incorporés, mais la file de tâches est injoignable : les certificats seront produits dès le retour du travailleur. Prévenez l'administrateur.";

export async function confirmerLImport(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  let enFile = true;
  return executerAction(
    async (acteur, ip) => {
      enFile = (await confirmerImport(acteur, lot(d), ip)).enFile;
    },
    () => messageFile(enFile),
    `/imports/${lot(d)}`,
  );
}

export async function abandonnerLImport(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  return executerAction((acteur, ip) => abandonnerImport(acteur, lot(d), ip), "Import abandonné : rien n'a été créé.", `/imports/${lot(d)}`);
}

export async function relancerLesEchecs(_e: EtatFormulaire, d: FormData): Promise<EtatFormulaire> {
  let enFile = true;
  return executerAction(
    async (acteur, ip) => {
      enFile = (await relancerEchecs(acteur, lot(d), ip)).enFile;
    },
    () => messageFile(enFile),
    `/imports/${lot(d)}`,
  );
}
