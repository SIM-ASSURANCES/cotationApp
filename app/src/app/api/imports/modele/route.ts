import { modeleImport } from "@/serveur/imports";

import { telecharger } from "../../modeles/telechargement";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/imports/modele?produit=CODE[&police=ID] : fichier modèle de l'import en masse des adhérents (CDC §13). */
export async function GET(requete: Request) {
  const parametres = new URL(requete.url).searchParams;
  const produit = parametres.get("produit") ?? "";
  const police = Number(parametres.get("police"));
  return telecharger((acteur) => modeleImport(acteur, produit, Number.isInteger(police) && police > 0 ? police : undefined), "attachment", XLSX);
}
