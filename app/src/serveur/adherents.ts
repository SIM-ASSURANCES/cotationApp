import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { DateIso } from "@/domaine/calcul/dates";
import { estContratDeGroupe, incorporer, problemesDateChangement, retirer, type MotifAdherents, type VersionAdherents } from "@/domaine/cotation/adherents";
import type { Assure } from "@/domaine/cotation/saisie";
import { peutAgir, peutLire } from "@/domaine/droits";

import { journaliser, type ActeurAudit } from "./audit";
import { niveauDuProfil } from "./droits";
import { aujourdhui } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Adhérents d'une police de groupe (CDC §10.2, D22). La liste évolue par versions en ajout seul
 * (table adherents_versions, que la base protège) : incorporation, retrait. `police.assures` porte toujours
 * la liste COURANTE ; l'historique est dans les versions. Droit « Émettre un contrat ».
 */

const auteur = (u: UtilisateurCourant): ActeurAudit => ({ id: u.id, identifiant: u.identifiant });
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);
const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);

async function exiger(acteur: UtilisateurCourant, ecriture: boolean): Promise<void> {
  const niveau = await niveauDuProfil(acteur.profil, "EMETTRE_CONTRAT");
  if (!(ecriture ? peutAgir(niveau) : peutLire(niveau))) throw new ErreurAcces("Droit insuffisant : adhérents d'un contrat de groupe.");
}

export type VersionLue = VersionAdherents & { creeLe: Date; creePar: string };

export type VueAdherents = {
  police: { id: number; numero: string; typeContrat: string; dateEffet: DateIso; dateEcheance: DateIso; cotationId: number };
  courants: Assure[];
  versions: VersionLue[];
  /** Formules de la police : celles que peut choisir un adhérent incorporé. */
  formules: string[];
  /** Conditions particulières émises : dernière version et liste d'adhérents qu'elle reprend. */
  cp: { numero: string; version: number; versionAdherents: number | null } | null;
  /** Certificat émis par adhérent (ordre → numéro et version la plus récente). */
  certificats: Record<number, { id: number; numero: string; version: number }>;
};

export async function lireAdherents(acteur: UtilisateurCourant, policeId: number): Promise<VueAdherents | null> {
  await exiger(acteur, false);
  const prisma = obtenirPrisma();
  const police = await prisma.police.findUnique({ where: { id: policeId }, include: { adherents: { orderBy: { numero: "asc" } } } });
  if (!police || !estContratDeGroupe(police.typeContrat)) return null;
  const documents = await prisma.documentEmis.findMany({ where: { policeId, type: { in: ["CP", "CERTIFICAT"] } }, orderBy: { version: "asc" } });
  const certificats: VueAdherents["certificats"] = {};
  let cp: VueAdherents["cp"] = null;
  for (const d of documents) {
    if (d.type === "CERTIFICAT" && d.adherentOrdre !== null) certificats[d.adherentOrdre] = { id: d.id, numero: d.numero, version: d.version };
    if (d.type === "CP") cp = { numero: d.numero, version: d.version, versionAdherents: (d.versionsAssociees as { versionAdherents?: number | null }).versionAdherents ?? null };
  }
  return {
    police: { id: police.id, numero: police.numero, typeContrat: police.typeContrat ?? "", dateEffet: depuisDate(police.dateEffet), dateEcheance: depuisDate(police.dateEcheance), cotationId: police.cotationId },
    courants: police.assures as unknown as Assure[],
    versions: police.adherents.map((v) => ({
      numero: v.numero,
      motif: v.motif as MotifAdherents,
      dateEffet: depuisDate(v.dateEffet),
      adherents: v.adherents as unknown as Assure[],
      concernes: v.concernes as unknown as number[],
      creeLe: v.creeLe,
      creePar: v.creePar,
    })),
    formules: police.formulesRetenues as unknown as string[],
    cp,
    certificats,
  };
}

/** Enregistre une nouvelle version de la liste (dans la transaction) et met à jour la liste courante de la police. */
async function changer(
  acteur: UtilisateurCourant,
  policeId: number,
  dateEffet: DateIso,
  adresseIp: string | null,
  motif: Exclude<MotifAdherents, "INITIALE">,
  appliquer: (courants: Assure[], dejaAttribues: number[], formules: string[]) => { liste: Assure[]; ordres: number[] } | { problemes: string[] },
): Promise<{ numeroVersion: number; ordres: number[] }> {
  await exiger(acteur, true);
  try {
    return await obtenirPrisma().$transaction(async (tx) => {
      const police = await tx.police.findUnique({ where: { id: policeId }, include: { adherents: { orderBy: { numero: "asc" } } } });
      if (!police) throw new ErreurMetier("Police introuvable.");
      if (!estContratDeGroupe(police.typeContrat)) throw new ErreurMetier("Seul un contrat de groupe a des adhérents.");
      const derniere = police.adherents[police.adherents.length - 1];
      if (!derniere) throw new ErreurMetier("Cette police n'a pas de liste initiale d'adhérents : elle date d'avant la session 4a.");
      const problemesDate = problemesDateChangement(dateEffet, { dateEffet: depuisDate(police.dateEffet), dateEcheance: depuisDate(police.dateEcheance) }, depuisDate(derniere.dateEffet));
      if (problemesDate.length > 0) throw new ErreurMetier(problemesDate.join(" "));

      const dejaAttribues = police.adherents.flatMap((v) => (v.adherents as unknown as Assure[]).map((a) => a.ordre));
      const r = appliquer(police.assures as unknown as Assure[], dejaAttribues, police.formulesRetenues as unknown as string[]);
      if ("problemes" in r) throw new ErreurMetier(r.problemes.join(" "));

      const numeroVersion = derniere.numero + 1;
      await tx.adherentsVersion.create({
        data: { policeId, numero: numeroVersion, motif, dateEffet: versDate(dateEffet), adherents: r.liste as unknown as Prisma.InputJsonValue, concernes: r.ordres, creePar: acteur.identifiant },
      });
      await tx.police.update({ where: { id: policeId }, data: { assures: r.liste as unknown as Prisma.InputJsonValue } });
      await journaliser(
        {
          acteur: auteur(acteur),
          action: motif === "INCORPORATION" ? "ADHERENTS_INCORPORES" : "ADHERENTS_RETIRES",
          objetType: "police",
          objetId: police.numero,
          apres: { version: numeroVersion, dateEffet, adherents: r.ordres, total: r.liste.length },
          adresseIp,
        },
        tx,
      );
      return { numeroVersion, ordres: r.ordres };
    });
  } catch (erreur) {
    // Deux changements simultanés visent le même numéro de version : la base n'en garde qu'un.
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier("La liste des adhérents a été modifiée entre-temps : rechargez la page et recommencez.");
    }
    throw erreur;
  }
}

export type NouvelAdherent = Omit<Assure, "ordre">;

/** Incorporation : les nouveaux adhérents prennent les numéros d'ordre qui suivent le plus grand numéro jamais attribué. */
export function incorporerAdherents(acteur: UtilisateurCourant, policeId: number, dateEffet: DateIso, nouveaux: NouvelAdherent[], adresseIp: string | null) {
  return changer(acteur, policeId, dateEffet, adresseIp, "INCORPORATION", (courants, dejaAttribues, formules) => incorporer(courants, dejaAttribues, nouveaux, formules, aujourdhui()));
}

/** Retrait : les adhérents retirés quittent la liste courante ; leur historique et leurs certificats émis restent. */
export function retirerAdherents(acteur: UtilisateurCourant, policeId: number, dateEffet: DateIso, ordres: number[], adresseIp: string | null) {
  return changer(acteur, policeId, dateEffet, adresseIp, "RETRAIT", (courants) => retirer(courants, ordres));
}

/** Police créée à partir d'une cotation (pour l'écran des adhérents, qui se retrouve par la cotation). */
export async function policeDeCotation(acteur: UtilisateurCourant, cotationId: number): Promise<number | null> {
  await exiger(acteur, false);
  const police = await obtenirPrisma().police.findUnique({ where: { cotationId }, select: { id: true } });
  return police?.id ?? null;
}
