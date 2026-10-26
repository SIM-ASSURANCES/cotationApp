import { exporterBaremePublieXlsx, TYPE_XLSX } from "@/serveur/bareme-excel";

import { telecharger } from "../../../modeles/telechargement";

/** GET /api/bareme/{versionId}/export : classeur du barème PUBLIÉ de la version, avec son empreinte dans le Lisez-moi (B9). */
export async function GET(_requete: Request, ctx: RouteContext<"/api/bareme/[versionId]/export">) {
  const { versionId } = await ctx.params;
  return telecharger((acteur) => exporterBaremePublieXlsx(acteur, Number.isInteger(Number(versionId)) ? Number(versionId) : -1), "attachment", TYPE_XLSX);
}
