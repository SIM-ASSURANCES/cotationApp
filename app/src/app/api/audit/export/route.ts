import { exporterJournal } from "@/serveur/audit-export";

import { telecharger } from "../../modeles/telechargement";

/** GET /api/audit/export?action=… : journal d'audit en Excel (.xlsx), même droit et même filtre que l'écran « Journal d'audit ». */
export async function GET(requete: Request) {
  const action = new URL(requete.url).searchParams.get("action");
  return telecharger((acteur, ip) => exporterJournal(acteur, { action }, ip), "attachment", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
