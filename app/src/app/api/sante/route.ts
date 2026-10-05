import { connection } from "next/server";

import { verifierSante } from "@/serveur/sante";

/**
 * GET /api/sante : état de l'application et de ses dépendances.
 *
 * Réponse : { statut: "ok" | "degrade", base: "ok" | "ko", generateur: "ok" | "ko" }
 * Code HTTP 200 si tout va bien, 503 sinon (utilisable par un outil de supervision).
 * Ne renvoie jamais de détail technique (chaîne de connexion, trace d'erreur).
 */
export async function GET() {
  // Toujours exécuté à la requête, jamais servi depuis un cache.
  await connection();

  const sante = await verifierSante();
  return Response.json(sante, {
    status: sante.statut === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
