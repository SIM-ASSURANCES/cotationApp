import { zipDuLot } from "@/serveur/imports";

import { telecharger } from "../../../modeles/telechargement";

/** GET /api/imports/{id}/zip : archive ZIP des certificats produits par l'import (empreinte vérifiée). */
export async function GET(_requete: Request, ctx: RouteContext<"/api/imports/[id]/zip">) {
  const { id } = await ctx.params;
  return telecharger((acteur, ip) => zipDuLot(acteur, Number.isInteger(Number(id)) ? Number(id) : -1, ip), "attachment", "application/zip");
}
