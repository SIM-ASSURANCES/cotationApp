import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { aujourdhui, dateValide, type DateIso } from "@/domaine/calcul/dates";
import { BRANCHES_PRINCIPALES, estBranchePrincipaleValide, type CodeBranchePrincipale } from "@/domaine/calcul/parametrage";
import { cgEnVigueurLe, problemesRattachementCg, type RattachementCg } from "@/domaine/documents/cg-branche";
import { peutAgir, peutLire } from "@/domaine/droits";

import { journaliser } from "./audit";
import { niveauDuProfil } from "./droits";
import { versionPublieeEnVigueur } from "./modeles";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";

// Conditions générales par branche principale (étape 6, D42) : droit du paramétrage des produits.

const versDate = (iso: DateIso) => new Date(`${iso}T00:00:00.000Z`);
const depuisDate = (d: Date): DateIso => d.toISOString().slice(0, 10);

/** CG de la branche en vigueur à une date (null : aucune). Sans contrôle de droit : usage interne des émissions. */
export async function cgDeLaBranche(
  client: Pick<Prisma.TransactionClient, "brancheCg">,
  branchePrincipale: string,
  date: DateIso,
): Promise<RattachementCg | null> {
  const lignes = await client.brancheCg.findMany({ where: { branchePrincipale, dateEffet: { lte: versDate(date) } }, orderBy: { dateEffet: "desc" }, take: 1 });
  return cgEnVigueurLe(
    lignes.map((l) => ({ dateEffet: depuisDate(l.dateEffet), modeleCode: l.modeleCode })),
    date,
  );
}

export type LigneHistoriqueCg = { dateEffet: DateIso; modeleCode: string; modeleLibelle: string; creePar: string; creeLe: Date };
export type BrancheAvecCg = {
  code: CodeBranchePrincipale;
  libelle: string;
  /** CG en vigueur aujourd'hui, avec le visa lu dans la version publiée du modèle (null : branche sans CG). */
  enVigueur: { modeleCode: string; modeleLibelle: string; dateEffet: DateIso; visa: string | null; version: number | null } | null;
  historique: LigneHistoriqueCg[];
};

export type ModeleCgChoix = { code: string; libelle: string; visa: string | null };

async function exigerLecture(acteur: UtilisateurCourant): Promise<void> {
  if (!peutLire(await niveauDuProfil(acteur.profil, "PARAMETRER_PRODUITS"))) throw new ErreurAcces("Droit insuffisant : consultation du paramétrage.");
}

async function exigerEcriture(acteur: UtilisateurCourant): Promise<void> {
  if (!peutAgir(await niveauDuProfil(acteur.profil, "PARAMETRER_PRODUITS"))) throw new ErreurAcces("Droit insuffisant : paramétrage des produits et des taxes.");
}

/** Les cinq branches principales, leur CG en vigueur et l'historique des rattachements. */
export async function listerCgBranches(acteur: UtilisateurCourant): Promise<BrancheAvecCg[]> {
  await exigerLecture(acteur);
  const prisma = obtenirPrisma();
  const [branches, lignes, modeles] = await Promise.all([
    prisma.branchePrincipale.findMany(),
    prisma.brancheCg.findMany({ orderBy: { dateEffet: "desc" } }),
    prisma.modele.findMany({ where: { type: "CG" }, select: { code: true, libelle: true } }),
  ]);
  const libelleBranche = new Map(branches.map((b) => [b.code, b.libelle]));
  const libelleModele = new Map(modeles.map((m) => [m.code, m.libelle]));
  const aujourd = aujourdhui();
  const resultat: BrancheAvecCg[] = [];
  for (const b of BRANCHES_PRINCIPALES) {
    const historique = lignes
      .filter((l) => l.branchePrincipale === b.code)
      .map((l) => ({ dateEffet: depuisDate(l.dateEffet), modeleCode: l.modeleCode, modeleLibelle: libelleModele.get(l.modeleCode) ?? l.modeleCode, creePar: l.creePar, creeLe: l.creeLe }));
    const retenu = cgEnVigueurLe(historique, aujourd);
    let enVigueur: BrancheAvecCg["enVigueur"] = null;
    if (retenu) {
      const publiee = await versionPublieeEnVigueur({ code: retenu.modeleCode }, aujourd);
      enVigueur = {
        modeleCode: retenu.modeleCode,
        modeleLibelle: libelleModele.get(retenu.modeleCode) ?? retenu.modeleCode,
        dateEffet: retenu.dateEffet,
        visa: publiee?.version.visa ?? null,
        version: publiee?.version.numero ?? null,
      };
    }
    resultat.push({ code: b.code, libelle: libelleBranche.get(b.code) ?? b.libelle, enVigueur, historique });
  }
  return resultat;
}

/** Modèles de CG proposés au rattachement, avec le visa de leur version publiée en vigueur (null : aucune version publiée). */
export async function listerModelesCg(acteur: UtilisateurCourant): Promise<ModeleCgChoix[]> {
  await exigerLecture(acteur);
  const modeles = await obtenirPrisma().modele.findMany({ where: { type: "CG" }, orderBy: { code: "asc" }, select: { code: true, libelle: true } });
  const aujourd = aujourdhui();
  const liste: ModeleCgChoix[] = [];
  for (const m of modeles) {
    const publiee = await versionPublieeEnVigueur({ code: m.code }, aujourd);
    liste.push({ code: m.code, libelle: m.libelle, visa: publiee?.version.visa ?? null });
  }
  return liste;
}

/**
 * Rattache un modèle de CG à une branche à partir d'une date d'effet (aujourd'hui ou plus tard). Jamais de modification
 * d'une ligne existante : une nouvelle CG est une nouvelle ligne datée. Le modèle doit être de type CG et avoir une version
 * publiée en vigueur à cette date, avec un visa (le visa est lu dans cette version).
 */
export async function rattacherCgBranche(
  acteur: UtilisateurCourant,
  saisie: { branchePrincipale: string; modeleCode: string; dateEffet: string },
  adresseIp: string | null,
): Promise<void> {
  await exigerEcriture(acteur);
  const problemes = problemesRattachementCg(saisie);
  if (!estBranchePrincipaleValide(saisie.branchePrincipale)) problemes.push("Branche principale inconnue.");
  if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));
  const dateEffet = saisie.dateEffet as DateIso;
  if (!dateValide(dateEffet) || dateEffet < aujourdhui()) {
    throw new ErreurMetier("La date d'effet ne peut pas être passée : les documents déjà émis gardent leurs CG, et une nouvelle CG s'applique à partir d'aujourd'hui.");
  }
  const { branchePrincipale, modeleCode } = saisie;
  await obtenirPrisma().$transaction(async (tx) => {
    const modele = await tx.modele.findUnique({ where: { code: modeleCode }, select: { type: true } });
    if (!modele || modele.type !== "CG") throw new ErreurMetier(`« ${modeleCode} » n'est pas un modèle de conditions générales (Modèles Word, type CG).`);
    if (await tx.brancheCg.findUnique({ where: { branchePrincipale_dateEffet: { branchePrincipale, dateEffet: versDate(dateEffet) } } })) {
      throw new ErreurMetier("Une CG est déjà rattachée à cette branche à cette date d'effet : une ligne ne se modifie pas, choisissez une autre date.");
    }
    const publiee = await versionPublieeEnVigueur({ code: modeleCode }, dateEffet);
    if (!publiee) throw new ErreurMetier(`Le modèle « ${modeleCode} » n'a aucune version publiée en vigueur au ${dateEffet} : faites-la publier avant de le rattacher.`);
    if (!publiee.version.visa || publiee.version.visa.trim() === "") throw new ErreurMetier(`La version publiée de « ${modeleCode} » n'a pas de visa : les CG exigent un code et un visa.`);
    const cree = await tx.brancheCg.create({ data: { branchePrincipale, modeleCode, dateEffet: versDate(dateEffet), creePar: acteur.identifiant } });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "branche_cg",
        objetId: String(cree.id),
        apres: { branchePrincipale, modeleCode, dateEffet, visa: publiee.version.visa },
        adresseIp,
      },
      tx,
    );
  });
}
