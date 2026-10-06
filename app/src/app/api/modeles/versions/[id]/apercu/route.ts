import { connection } from "next/server";

import { apercuVersion } from "@/serveur/modeles";

import { idDeVersion, telecharger } from "../../../telechargement";

/** GET /api/modeles/versions/{id}/apercu?assures=N : aperçu PDF avec des données fictives. */
export async function GET(requete: Request, ctx: RouteContext<"/api/modeles/versions/[id]/apercu">) {
  await connection();
  const id = await idDeVersion(ctx.params);
  const assures = Number(new URL(requete.url).searchParams.get("assures") ?? "2");
  return telecharger((acteur, ip) => apercuVersion(acteur, id, { nombreAssures: assures }, ip), "inline", "application/pdf");
}
