import "server-only";

import { headers } from "next/headers";

/** Adresse du client pour le journal d'audit (transmise par le proxy HTTPS : à ne croire que derrière lui). */
export async function adresseIpCourante(): Promise<string | null> {
  const entetes = await headers();
  const adresse = entetes.get("x-forwarded-for")?.split(",")[0]?.trim() || entetes.get("x-real-ip");
  return adresse ? adresse.slice(0, 64) : null;
}
