import { connection } from "next/server";

import { apercuCotation } from "@/serveur/documents";

import { telecharger } from "../../../modeles/telechargement";

/** GET /api/cotations/{id}/apercu : aperçu PDF de la cotation (filigrane « APERÇU », rien n'est stocké). */
export async function GET(_requete: Request, ctx: RouteContext<"/api/cotations/[id]/apercu">) {
  await connection();
  const { id } = await ctx.params;
  return telecharger((acteur) => apercuCotation(acteur, Number.isInteger(Number(id)) ? Number(id) : -1), "inline", "application/pdf");
}
