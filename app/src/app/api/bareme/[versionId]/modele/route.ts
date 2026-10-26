import { modeleBaremeXlsx, TYPE_XLSX } from "@/serveur/bareme-excel";

import { telecharger } from "../../../modeles/telechargement";

/** GET /api/bareme/{versionId}/modele : classeur modèle du barème (SECURPRO inventé en exemple), B9. */
export async function GET(_requete: Request, ctx: RouteContext<"/api/bareme/[versionId]/modele">) {
  const { versionId } = await ctx.params;
  return telecharger((acteur) => modeleBaremeXlsx(acteur, Number.isInteger(Number(versionId)) ? Number(versionId) : -1), "attachment", TYPE_XLSX);
}
