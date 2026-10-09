"use server";

import type { EtatFormulaire } from "@/composants/types";
import { relancerEcritures } from "@/serveur/surveillance";

import { executerAction } from "../../executer";

export async function relancerLesEcritures(): Promise<EtatFormulaire> {
  let nombre = 0;
  return executerAction(
    async (acteur, ip) => {
      nombre = await relancerEcritures(acteur, ip);
    },
    () => `${nombre} écriture(s) relancée(s) : le travailleur les reprend maintenant.`,
    "/admin/stockage",
  );
}
