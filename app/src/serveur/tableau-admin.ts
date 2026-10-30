import "server-only";

import { compterJournalDepuis, lireJournal } from "./audit";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { exigerLectureTableau } from "./tableaux-de-bord";
import type { UtilisateurCourant } from "./types";

export type UtilisateurRecentAdmin = {
  id: number;
  identifiant: string;
  nom: string;
  profil: string;
  actif: boolean;
  verrouille: boolean;
  creeLe: string;
};

export type EntreeAuditAdmin = {
  id: string;
  instant: string;
  action: string;
  objet: string | null;
  acteurIdentifiant: string;
};

export type TableauAdmin = {
  aujourdhui: string;
  utilisateurs: {
    total: number;
    actifs: number;
    verrouilles: number;
    mdpAChanger: number;
    recents: UtilisateurRecentAdmin[];
  };
  stockage: {
    ecrituresDiffereesEnAttente: number;
    totalDocumentsEmis: number;
  };
  audit: {
    entrees24h: number;
    dernieresActions: EntreeAuditAdmin[];
  };
};

/**
 * Tableau de bord Admin Système : surveillance des comptes, alertes de verrouillage,
 * intégrité du stockage persistant et dernières activités d'audit.
 */
export async function tableauAdmin(acteur: UtilisateurCourant): Promise<TableauAdmin> {
  await exigerLectureTableau(acteur, "admin");
  const jour = aujourdhui();
  const prisma = obtenirPrisma();
  const ilYA24h = new Date(Date.now() - 24 * 3600 * 1000);

  // 1. Utilisateurs
  const tous = await prisma.utilisateur.findMany({
    select: {
      id: true,
      identifiant: true,
      nom: true,
      profil: { select: { code: true } },
      actif: true,
      verrouilleJusqua: true,
      doitChangerMotDePasse: true,
      creeLe: true,
    },
    orderBy: { creeLe: "desc" },
  });

  const maintenant = new Date();
  const total = tous.length;
  const actifs = tous.filter((u) => u.actif).length;
  const verrouilles = tous.filter((u) => u.verrouilleJusqua !== null && u.verrouilleJusqua > maintenant).length;
  const mdpAChanger = tous.filter((u) => u.doitChangerMotDePasse).length;
  const recents = tous.slice(0, 8).map((u) => ({
    id: u.id,
    identifiant: u.identifiant,
    nom: u.nom,
    profil: u.profil.code,
    actif: u.actif,
    verrouille: u.verrouilleJusqua !== null && u.verrouilleJusqua > maintenant,
    creeLe: u.creeLe.toISOString().slice(0, 10),
  }));

  // 2. Stockage
  const ecrituresDiffereesEnAttente = await prisma.ecritureDifferee.count();
  const totalDocumentsEmis = await prisma.documentEmis.count();

  // 3. Audit via src/serveur/audit.ts
  const entrees24h = await compterJournalDepuis(ilYA24h);
  const { lignes } = await lireJournal({});
  const dernieresActions = lignes.slice(0, 10).map((l) => ({
    id: l.id,
    instant: l.horodatage.toISOString().replace("T", " ").slice(0, 19),
    action: l.action,
    objet: l.objet,
    acteurIdentifiant: l.utilisateur ?? "système",
  }));

  return {
    aujourdhui: jour,
    utilisateurs: {
      total,
      actifs,
      verrouilles,
      mdpAChanger,
      recents,
    },
    stockage: {
      ecrituresDiffereesEnAttente,
      totalDocumentsEmis,
    },
    audit: {
      entrees24h,
      dernieresActions,
    },
  };
}
