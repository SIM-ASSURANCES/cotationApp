import "server-only";

import { baremeVide, schemaBareme, VERSION_SCHEMA_BAREME, verifierBareme, type Bareme, type Probleme } from "@/domaine/bareme";
import { aujourdhui, dateValide, formaterDate, type DateIso } from "@/domaine/calcul/dates";
import { problemesVersion, type VersionSaisie } from "@/domaine/calcul/parametrage";

import { journaliser } from "./audit";
import { depuisDate, empreinteBareme, enJson, exigerPreparable, resume, verrouillerVersion } from "./bareme";
import { creerVersionDansTransaction, exigerEcriture, versVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurMetier, type UtilisateurCourant } from "./types";

/**
 * Barème d'une version, côté ÉCRAN d'édition (session B4, D58). L'écran édite le même document que l'import (`bareme_documents`,
 * BROUILLON), validé par le même schéma et la même `verifierBareme` : ce fichier n'a aucune règle de barème, seulement des gardes de
 * parcours (qui peut éditer quoi, quand) et la copie d'un barème publié dans une NOUVELLE version (H157, D49).
 */

export type BaremePourEdition = {
  produit: { code: string; libelle: string; branche: string };
  version: { id: number; dateEffet: DateIso; modeTarification: string };
  /** La version peut encore recevoir un barème (pas en vigueur dans un autre mode). */
  preparable: boolean;
  brouillon: { id: number; contenu: unknown; empreinte: string; modifieLe: Date; creePar: string } | null;
  publie: { id: number; contenu: unknown; empreinte: string; publieLe: Date; publiePar: string; motif: string } | null;
  /** Codes de champs et de valeurs intermédiaires qui figurent dans un barème PUBLIÉ de ce produit (toutes versions) : ils ne se renomment plus. */
  codesFiges: string[];
  /** Catégories de taxe (branches fiscales) proposées aux garanties. */
  categoriesTaxe: string[];
  /** Problèmes d'intégrité du brouillon tel qu'enregistré (les contrôles se recalculent ensuite à l'écran, à chaque modification). */
  problemes: Probleme[];
};

/** Barème d'une version pour l'écran : brouillon (modifiable) et/ou publié (lecture), plus de quoi savoir quels codes sont figés. */
export async function lireBaremePourEdition(acteur: UtilisateurCourant, versionId: number): Promise<BaremePourEdition | null> {
  await exigerEcriture(acteur);
  const prisma = obtenirPrisma();
  const v = await prisma.produitVersion.findUnique({ where: { id: versionId }, include: { produit: true } });
  if (!v) return null;
  const [lignes, publiesDuProduit, branches] = await Promise.all([
    prisma.baremeDocument.findMany({ where: { versionId } }),
    prisma.baremeDocument.findMany({ where: { statut: "PUBLIE", version: { produitId: v.produitId } }, select: { contenu: true } }),
    prisma.branche.findMany({ select: { code: true }, orderBy: { code: "asc" } }),
  ]);
  const b = lignes.find((l) => l.statut === "BROUILLON");
  const p = lignes.find((l) => l.statut === "PUBLIE");
  const codesFiges = new Set<string>();
  for (const l of publiesDuProduit) {
    const lu = schemaBareme.safeParse(l.contenu);
    if (!lu.success) continue;
    for (const c of lu.data.champs) codesFiges.add(c.code);
    for (const i of lu.data.intermediaires) codesFiges.add(i.code);
  }
  const lu = b ? schemaBareme.safeParse(b.contenu) : null;
  return {
    produit: { code: v.produit.code, libelle: v.produit.libelle, branche: v.produit.branche },
    version: { id: v.id, dateEffet: depuisDate(v.dateEffet), modeTarification: v.modeTarification },
    preparable: v.modeTarification === "BAREME" || depuisDate(v.dateEffet) > aujourdhui(),
    brouillon: b ? { id: b.id, contenu: b.contenu, empreinte: b.empreinte, modifieLe: b.modifieLe, creePar: b.creePar } : null,
    publie: p && p.publieLe && p.publiePar ? { id: p.id, contenu: p.contenu, empreinte: p.empreinte, publieLe: p.publieLe, publiePar: p.publiePar, motif: p.motifPublication ?? "" } : null,
    codesFiges: [...codesFiges],
    categoriesTaxe: branches.map((x) => x.code),
    problemes: lu?.success ? verifierBareme(lu.data) : [],
  };
}

/**
 * « Créer un barème vide » : un brouillon neuf sur une version qui n'a encore AUCUN barème (ni brouillon, ni publié) et qui peut en
 * recevoir un. Le document vide est celui de `baremeVide` (une garantie sans montant, la catégorie de taxe du produit).
 */
export async function creerBaremeVide(acteur: UtilisateurCourant, versionId: number, adresseIp: string | null): Promise<{ id: number; empreinte: string }> {
  await exigerEcriture(acteur);
  return obtenirPrisma().$transaction(async (tx) => {
    const version = await verrouillerVersion(tx, versionId);
    exigerPreparable(version);
    if (await tx.baremeDocument.findFirst({ where: { versionId }, select: { id: true } })) {
      throw new ErreurMetier("Cette version a déjà un barème : ouvrez-le pour le modifier à l'écran.");
    }
    const produit = await tx.produit.findUniqueOrThrow({ where: { id: version.produitId }, select: { branche: true } });
    const bareme: Bareme = schemaBareme.parse(baremeVide(produit.branche));
    const empreinte = empreinteBareme(bareme);
    const ligne = await tx.baremeDocument.create({
      data: { versionId, statut: "BROUILLON", contenu: enJson(bareme), empreinte, schemaVersion: VERSION_SCHEMA_BAREME, creePar: acteur.identifiant },
    });
    await journaliser(
      { acteur: { id: acteur.id, identifiant: acteur.identifiant }, action: "PARAMETRE_MODIFIE", objetType: "bareme_document", objetId: ligne.id, apres: { versionId, statut: "BROUILLON", empreinte, origine: "BAREME_VIDE", ...resume(bareme) }, adresseIp },
      tx,
    );
    return { id: ligne.id, empreinte };
  });
}

/**
 * Un barème PUBLIÉ ne se modifie jamais (D49) : sa correction est une NOUVELLE version du produit (H157). Crée cette version par le service
 * de création de version existant (mêmes contrôles, même journal, paramètres de la dernière version comme un ajout ordinaire), à une date
 * d'effet SAISIE et postérieure à aujourd'hui, puis y copie le barème publié en BROUILLON. Tout dans une transaction : la version n'existe
 * pas sans sa copie. Le publié d'origine et les cotations qui le citent ne sont pas touchés.
 */
export async function creerVersionDepuisBareme(acteur: UtilisateurCourant, versionSourceId: number, dateEffet: string, adresseIp: string | null): Promise<{ versionId: number; codeProduit: string }> {
  await exigerEcriture(acteur);
  const date = dateEffet.trim();
  if (!dateValide(date)) throw new ErreurMetier("La date d'effet est invalide : saisissez-la en JJ/MM/AAAA.");
  if (date <= aujourdhui()) {
    throw new ErreurMetier("La date d'effet doit être postérieure à aujourd'hui : un barème ne se prépare que sur une version qui n'est pas encore en vigueur.");
  }

  return obtenirPrisma().$transaction(async (tx) => {
    const source = await tx.produitVersion.findUnique({ where: { id: versionSourceId }, include: { produit: true } });
    if (!source) throw new ErreurMetier("Version de produit introuvable.");
    const publie = await tx.baremeDocument.findFirst({ where: { versionId: versionSourceId, statut: "PUBLIE" } });
    if (!publie) throw new ErreurMetier("Seul un barème publié se corrige par une nouvelle version : un brouillon se modifie directement.");
    if (publie.schemaVersion !== VERSION_SCHEMA_BAREME || empreinteBareme(publie.contenu) !== publie.empreinte) {
      throw new ErreurMetier("Le barème publié ne correspond plus à son empreinte : il a été altéré hors de l'application. Aucune copie n'est faite.");
    }
    const bareme = schemaBareme.parse(publie.contenu);

    // Une version à venir qui a déjà un barème (brouillon ou publié) : on l'ouvre, on n'en crée pas une autre.
    const avenir = await tx.produitVersion.findMany({
      where: { produitId: source.produitId, id: { not: versionSourceId }, baremes: { some: {} } },
      include: { baremes: { select: { statut: true } } },
      orderBy: { dateEffet: "asc" },
    });
    const deja = avenir.find((x) => depuisDate(x.dateEffet) > aujourdhui());
    if (deja) {
      const etat = deja.baremes.some((x) => x.statut === "PUBLIE") ? "un barème publié" : "un brouillon de barème";
      throw new ErreurMetier(`La version du ${formaterDate(depuisDate(deja.dateEffet))} (à venir) a déjà ${etat} : ouvrez-la sur la fiche du produit plutôt que d'en créer une autre.`);
    }

    const derniere = await tx.produitVersion.findFirstOrThrow({ where: { produitId: source.produitId }, orderBy: { dateEffet: "desc" }, include: { formules: true } });
    // Mêmes paramètres qu'un ajout ordinaire (pré-remplissage par la dernière version), en mode provisoire « Par garanties » (D50, H140).
    const saisie: VersionSaisie = { ...versVersion(derniere), dateEffet: date, modeTarification: "GARANTIES" };
    const problemes = problemesVersion(saisie);
    if (problemes.length > 0) throw new ErreurMetier(problemes.join(" "));

    const versionId = await creerVersionDansTransaction(tx, acteur, source.produit.code, saisie, adresseIp);
    const ligne = await tx.baremeDocument.create({
      data: { versionId, statut: "BROUILLON", contenu: enJson(bareme), empreinte: empreinteBareme(bareme), schemaVersion: VERSION_SCHEMA_BAREME, creePar: acteur.identifiant },
    });
    await journaliser(
      {
        acteur: { id: acteur.id, identifiant: acteur.identifiant },
        action: "PARAMETRE_MODIFIE",
        objetType: "bareme_document",
        objetId: ligne.id,
        apres: { versionId, statut: "BROUILLON", empreinte: ligne.empreinte, origine: "COPIE_DU_PUBLIE", copieDe: { versionId: versionSourceId, empreinte: publie.empreinte }, ...resume(bareme) },
        adresseIp,
      },
      tx,
    );
    return { versionId, codeProduit: source.produit.code };
  });
}
