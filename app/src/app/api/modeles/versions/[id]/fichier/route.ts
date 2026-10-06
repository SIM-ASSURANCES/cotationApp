import { fichierVersion } from "@/serveur/modeles";

import { idDeVersion, telecharger } from "../../../telechargement";

/** GET /api/modeles/versions/{id}/fichier : le .docx déposé, tel quel. */
export async function GET(_requete: Request, ctx: RouteContext<"/api/modeles/versions/[id]/fichier">) {
  const id = await idDeVersion(ctx.params);
  return telecharger((acteur, ip) => fichierVersion(acteur, id, ip), "attachment", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}
