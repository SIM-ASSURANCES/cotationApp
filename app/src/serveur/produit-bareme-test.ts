// Aide des tests (D66) : un produit INVENTÉ tarifé au barème (SECURPRO), créé par le chemin normal « Au barème » dès la première version, avec le barème
// de démonstration (139 420 F à l'essai annuel). Jamais de donnée réelle.
import { lireBareme, type Bareme } from "@/domaine/bareme";
import { documentSecurpro } from "@/domaine/bareme/securpro-fixture";
import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import { DATE_EFFET_A_LA_PUBLICATION, type VersionSaisie } from "@/domaine/calcul/parametrage";

import { assurerBranche } from "./branches-test";
import { enregistrerBrouillonBareme, publierBareme } from "./bareme";
import { creerProduit, creerTaxe, creerVersion, creerVersionDansTransaction } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import type { UtilisateurCourant } from "./types";

export type BranchesFiscales = { incendie: string; iard: string };

/** Crée (une fois par fichier de test) deux branches fiscales propres au test et leurs taux (12,5 % et 7,25 %). */
export async function creerBranchesFiscales(technique: UtilisateurCourant, suffixe: string): Promise<BranchesFiscales> {
  const incendie = `INC_${suffixe}`;
  const iard = `IARD_${suffixe}`;
  await assurerBranche(incendie);
  await assurerBranche(iard);
  await creerTaxe(technique, { branche: incendie, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: iard, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  return { incendie, iard };
}

/** Le barème SECURPRO inventé, avec les catégories de taxe renommées en branches propres au test. */
export function baremeAuxBranches(b: BranchesFiscales): Bareme {
  const d = structuredClone(documentSecurpro) as unknown as { produit: { taxe: string }; garanties: { taxe?: string }[] };
  const carte: Record<string, string> = { IARD: b.iard, INCENDIE: b.incendie };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties) if (g.taxe) g.taxe = carte[g.taxe];
  return lireBareme(d);
}

/** Version « Au barème » de base, aux paramètres de SECURPRO (arrondi au franc, sans prorata). */
export const versionAuBareme = (dateEffet: string, extra: Partial<VersionSaisie> = {}): VersionSaisie => ({
  dateEffet,
  modeTarification: "BAREME",
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
  garantiesSaisieLibre: true,
  garanties: [],
  references: { csModeleCode: null, csVisa: null },
  ...extra,
});

/**
 * Ajoute une version SANS le contrôle « mode figé par produit » de `creerVersion` (D66) : c'est la forme des données d'avant D66 (versions de modes
 * différents dans un même historique, versions provisoires « Par garanties »), que plusieurs tests d'avant D66 mettent en scène. Même création, même
 * journal ; seul le contrôle du mode est laissé de côté.
 */
export async function ajouterVersionHeritee(acteur: UtilisateurCourant, code: string, saisie: VersionSaisie, adresseIp: string | null = null): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await creerVersionDansTransaction(tx, acteur, code, saisie, adresseIp);
  });
}

/** Remplace la date d'effet d'une version : le test simule l'ancienneté d'une version (les déclencheurs d'historisation sont suspendus le temps de l'écriture). */
export async function dateDeVersion(versionId: number, dateEffet: string): Promise<void> {
  await obtenirPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.$executeRawUnsafe(`UPDATE produit_versions SET date_effet = DATE '${dateEffet}' WHERE id = ${versionId}`);
  });
}

/**
 * Produit inventé AU BARÈME, créé par le chemin normal de D66 : première version « dès la publication » (en préparation), barème enregistré, publié
 * (la version entre en vigueur aujourd'hui). `joursDeVigueur` > 0 rajeunit ensuite artificiellement la version (« en vigueur depuis N jours »).
 */
export async function creerProduitAuBareme(technique: UtilisateurCourant, code: string, branches: BranchesFiscales, joursDeVigueur = 0): Promise<{ versionId: number }> {
  await creerProduit(technique, { code, libelle: "Sécur Pro (inventé, test D66)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: branches.iard }, null);
  await creerVersion(technique, code, versionAuBareme(DATE_EFFET_A_LA_PUBLICATION), null);
  const versionId = (await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } })).id;
  await enregistrerBrouillonBareme(technique, versionId, baremeAuxBranches(branches), null);
  await publierBareme(technique, versionId, "Barème SECURPRO inventé (test D66)", null);
  if (joursDeVigueur > 0) await dateDeVersion(versionId, ajouterJours(aujourdhui(), -joursDeVigueur));
  return { versionId };
}
