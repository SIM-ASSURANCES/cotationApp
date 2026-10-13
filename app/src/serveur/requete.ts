import "server-only";

import { headers } from "next/headers";

import { adresseDuClient, proxiesDeConfiance } from "@/domaine/adresse-client";

/** Adresse du client pour le journal d'audit (transmise par le proxy HTTPS : à ne croire que derrière lui). */
export async function adresseIpCourante(): Promise<string | null> {
  const entetes = await headers();
  return adresseDuClient(entetes.get("x-forwarded-for"), proxiesDeConfiance(process.env.PROXIES_DE_CONFIANCE));
}
