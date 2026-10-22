import "server-only";

import ExcelJS from "exceljs";

import { ACTIONS_AUDIT } from "@/domaine/audit";
import { peutLire } from "@/domaine/droits";

import { journaliser, lireJournalPourExport, type LigneJournal } from "./audit";
import { exigerNiveau } from "./droits";
import type { UtilisateurCourant } from "./types";

/** Nombre maximal de lignes d'un export : au-delà, les plus anciennes sont laissées de côté et la feuille « Informations » le dit. */
export const LIMITE_EXPORT_AUDIT = 50_000;

/** Excel refuse une cellule de plus de 32 767 caractères. */
const LONGUEUR_MAX_CELLULE = 32_000;

const texteJson = (valeur: unknown): string => {
  if (valeur === null || valeur === undefined) return "";
  const texte = JSON.stringify(valeur);
  return texte.length > LONGUEUR_MAX_CELLULE ? `${texte.slice(0, LONGUEUR_MAX_CELLULE)}… (tronqué)` : texte;
};

/** Ligne de la feuille « Journal » : date, utilisateur, action, objet, avant, après, adresse IP. */
export const ligneExport = (l: LigneJournal) => ({
  date: l.horodatage,
  utilisateur: l.utilisateur ?? "",
  action: l.action,
  objet: l.objet ?? "",
  avant: texteJson(l.avant),
  apres: texteJson(l.apres),
  adresseIp: l.adresseIp ?? "",
});

/**
 * Journal d'audit en Excel (CDC §15 : consultable par l'Admin système, la Technique et la Direction Générale). Même droit que l'écran
 * (consultation du journal), même filtre (l'action), du plus récent au plus ancien, 50 000 lignes au plus. L'export est lui-même
 * journalisé (JOURNAL_EXPORTE) : qui a sorti quoi, et si le résultat a été tronqué.
 */
export async function exporterJournal(acteur: UtilisateurCourant, filtre: { action?: string | null }, adresseIp: string | null): Promise<{ nom: string; contenu: Uint8Array }> {
  await exigerNiveau(acteur, "CONSULTER_AUDIT", peutLire);
  const action = ACTIONS_AUDIT.find((a) => a === filtre.action);
  const { lignes, tronque } = await lireJournalPourExport({ action, limite: LIMITE_EXPORT_AUDIT });

  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet("Journal");
  feuille.columns = [
    { header: "Date", key: "date", width: 21, style: { numFmt: "dd/mm/yyyy hh:mm:ss" } },
    { header: "Utilisateur", key: "utilisateur", width: 22 },
    { header: "Action", key: "action", width: 34 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Avant", key: "avant", width: 50 },
    { header: "Après", key: "apres", width: 50 },
    { header: "Adresse IP", key: "adresseIp", width: 18 },
  ];
  feuille.getRow(1).font = { bold: true };
  feuille.views = [{ state: "frozen", ySplit: 1 }];
  for (const l of lignes) feuille.addRow(ligneExport(l));
  feuille.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };

  const infos = classeur.addWorksheet("Informations");
  infos.columns = [{ width: 28 }, { width: 80 }];
  infos.addRows([
    ["Journal d'audit SIM Documents", ""],
    ["Exporté par", acteur.identifiant],
    ["Exporté le", new Date().toISOString()],
    ["Filtre « Action »", action ?? "Toutes"],
    ["Lignes exportées", lignes.length],
    ["Ordre", "Du plus récent au plus ancien"],
    ["Export tronqué", tronque ? `Oui : seules les ${LIMITE_EXPORT_AUDIT} entrées les plus récentes sont exportées` : "Non"],
  ]);
  infos.getRow(1).font = { bold: true };

  await journaliser({
    acteur: { id: acteur.id, identifiant: acteur.identifiant },
    action: "JOURNAL_EXPORTE",
    apres: { filtreAction: action ?? null, lignes: lignes.length, tronque },
    adresseIp,
  });
  const jour = new Date().toISOString().slice(0, 10);
  return { nom: `journal_audit_${jour}${action ? `_${action}` : ""}.xlsx`, contenu: new Uint8Array(await classeur.xlsx.writeBuffer()) };
}
