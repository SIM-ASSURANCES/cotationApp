import { modeleImport } from "@/serveur/imports";

import { telecharger } from "../../modeles/telechargement";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/imports/modele?produit=CODE : fichier modèle de l'import en masse des adhérents (CDC §13). */
export async function GET(requete: Request) {
  const produit = new URL(requete.url).searchParams.get("produit") ?? "";
  return telecharger((acteur) => modeleImport(acteur, produit), "attachment", XLSX);
}
