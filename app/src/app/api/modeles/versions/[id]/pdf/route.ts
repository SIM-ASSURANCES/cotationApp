import { pdfPublie } from "@/serveur/modeles";

import { idDeVersion, telecharger } from "../../../telechargement";

/** GET /api/modeles/versions/{id}/pdf : PDF des CG ou CS, produit une seule fois à la publication. */
export async function GET(_requete: Request, ctx: RouteContext<"/api/modeles/versions/[id]/pdf">) {
  const id = await idDeVersion(ctx.params);
  return telecharger((acteur, ip) => pdfPublie(acteur, id, ip), "inline", "application/pdf");
}
