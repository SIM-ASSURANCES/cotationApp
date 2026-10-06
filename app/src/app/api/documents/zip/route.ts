import { zipDocuments } from "@/serveur/documents";

import { telecharger } from "../../modeles/telechargement";

/** GET /api/documents/zip?id=1&id=2 : archive ZIP de la sélection. */
export async function GET(requete: Request) {
  const ids = new URL(requete.url).searchParams.getAll("id").map(Number);
  return telecharger((acteur, ip) => zipDocuments(acteur, ids, ip), "attachment", "application/zip");
}
