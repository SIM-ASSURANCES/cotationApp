import { telechargerDocument } from "@/serveur/documents";

import { telecharger } from "../../modeles/telechargement";

/** GET /api/documents/{id} : le PDF émis, dont l'empreinte est vérifiée à la lecture. */
export async function GET(_requete: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  return telecharger((acteur, ip) => telechargerDocument(acteur, Number.isInteger(Number(id)) ? Number(id) : -1, ip), "inline", "application/pdf");
}
