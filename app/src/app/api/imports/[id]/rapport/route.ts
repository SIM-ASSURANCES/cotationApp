import { rapportErreurs } from "@/serveur/imports";

import { telecharger } from "../../../modeles/telechargement";

/** GET /api/imports/{id}/rapport : rapport d'erreurs de l'import (.xlsx : ligne, colonne, valeur, message). */
export async function GET(_requete: Request, ctx: RouteContext<"/api/imports/[id]/rapport">) {
  const { id } = await ctx.params;
  return telecharger((acteur) => rapportErreurs(acteur, Number.isInteger(Number(id)) ? Number(id) : -1), "attachment", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
