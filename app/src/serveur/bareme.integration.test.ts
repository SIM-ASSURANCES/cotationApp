// Session B3 (D49) : stockage et publication du barème. Un brouillon par version, publication avec essais rejoués, journal, gel d'une
// ligne publiée par la base, verrou contre deux publications simultanées, mode BAREME refusé par les sites D31/D32 (B6 les ouvrira).
// Données de test INVENTÉES (SECURPRO du fixture, taux de taxe posés ici).
import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { composerBareme, jsonCanonique, type Saisie } from "@/domaine/bareme";
import { documentSecurpro, parametresEssai } from "@/domaine/bareme/securpro-fixture";
import { aujourdhui } from "@/domaine/calcul/dates";
import { MESSAGE_COMPOSITION_IMPOSSIBLE, MESSAGE_TARIFICATION_PAR_GARANTIES, type VersionSaisie } from "@/domaine/calcul/parametrage";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import {
  calculerAvecBaremePublie,
  empreinteBareme,
  enregistrerBrouillonBareme,
  ErreurBaremeInvalide,
  ErreurPublicationBareme,
  lireBaremePublie,
  MESSAGE_BAREME_NON_PUBLIE,
  publierBareme,
  rejouerLesEssaisBareme,
} from "./bareme";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion, exigerCalculAutomatiqueEnVigueur, exigerModeCoherent, exigerModeCoherentEnVigueur, resoudreContexte, resoudreContexteComposition } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let commercial: UtilisateurCourant;
let comptable: UtilisateurCourant;
let IARD: string;
let INCENDIE: string;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

/** SECURPRO inventé, dont les catégories de taxe sont celles (aléatoires) de ce fichier : les autres tests partagent la base. */
type DocumentJson = {
  produit: { taxe: string };
  garanties?: { taxe?: string }[];
  tables: { lignes: Record<string, string> }[];
  jeuxEssai: { nom: string; attendu: { ttc: string; lignes: { nette: string }[] } }[];
};
function documentAvecBranches(): DocumentJson {
  const d = structuredClone(documentSecurpro) as unknown as DocumentJson;
  const carte: Record<string, string> = { IARD, INCENDIE };
  d.produit.taxe = carte[d.produit.taxe];
  for (const g of d.garanties ?? []) if (g.taxe) g.taxe = carte[g.taxe];
  return d;
}

const versionBase = (mode: VersionSaisie["modeTarification"]): VersionSaisie => ({
  dateEffet: "2020-01-01",
  modeTarification: mode,
  arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "NETTE" },
  prorata: { actif: false, primeMinimale: null },
  fractionnement: { tranchesMax: 4, repartitionPourcent: null, decalagesMois: null, frais: "0" },
  cotation: { validiteMois: 3, formulesMax: 3 },
  seuilValidationTtc: null,
  formules: [],
  garantiesSaisieLibre: true,
  garanties: [],
  references: { csModeleCode: null, csVisa: null },
});

/** Un produit et sa version en vigueur depuis 2020, dans le mode demandé. */
async function nouvelleVersion(mode: VersionSaisie["modeTarification"]): Promise<{ code: string; versionId: number }> {
  const code = CODE("BAREME");
  await creerProduit(technique, { code, libelle: "Produit au barème (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(technique, code, versionBase(mode), null);
  const v = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } });
  return { code, versionId: v.id };
}

const lignesBareme = (versionId: number) => obtenirPrisma().baremeDocument.findMany({ where: { versionId }, orderBy: { id: "asc" } });

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  const admin = await compte(idAdmin);
  const nouveau = async (profil: string) => {
    const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: `${profil} Test`, profil, motDePasse: MDP }, null);
    return compte(identifiant);
  };
  [technique, dg, commercial, comptable] = [await nouveau("TECHNIQUE"), await nouveau("DIRECTION_GENERALE"), await nouveau("COMMERCIAL"), await nouveau("COMPTABILITE")];
  IARD = await assurerBranche(CODE("IARD"));
  INCENDIE = await assurerBranche(CODE("INCENDIE"));
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
});

describe("Mode BAREME de la version", () => {
  it("la base accepte BAREME et refuse toute autre valeur", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    expect((await obtenirPrisma().produitVersion.findUniqueOrThrow({ where: { id: versionId } })).modeTarification).toBe("BAREME");
    await expect(
      obtenirPrisma().$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
        await tx.$executeRawUnsafe(`UPDATE produit_versions SET mode_tarification = 'AUTRE' WHERE id = ${versionId}`);
      }),
    ).rejects.toThrow();
  });

  it("une version BAREME sans formule est acceptée (pas de tarif unitaire)", async () => {
    await expect(nouvelleVersion("BAREME")).resolves.toBeDefined();
  });

  it("D31/D32 : les cinq sites refusent le mode BAREME sans rien calculer (B6 les ouvrira)", async () => {
    const { code, versionId } = await nouvelleVersion("BAREME");
    const prisma = obtenirPrisma();
    const { produitId } = await prisma.produitVersion.findUniqueOrThrow({ where: { id: versionId } });
    const calcul = { type: "CALCUL" } as never;
    const composition = { type: "COMPOSITION", lignes: [{}] } as never;
    // resoudreContexte (calcul automatique) et resoudreContexteComposition
    await expect(resoudreContexte(prisma, code, aujourdhui(), aujourdhui(), "INDIVIDUEL")).rejects.toThrow(MESSAGE_TARIFICATION_PAR_GARANTIES);
    await expect(resoudreContexteComposition(prisma, code, aujourdhui())).rejects.toThrow(MESSAGE_COMPOSITION_IMPOSSIBLE);
    // exigerModeCoherent (émission) : ni calcul figé ni composition figée ne se rattache à une version BAREME
    expect(() => exigerModeCoherent("BAREME", calcul)).toThrow(ErreurMetier);
    expect(() => exigerModeCoherent("BAREME", composition)).toThrow(ErreurMetier);
    // variantes « en vigueur » (documents préparés avant une bascule)
    await expect(exigerCalculAutomatiqueEnVigueur(prisma, produitId, aujourdhui())).rejects.toThrow(ErreurMetier);
    await expect(exigerModeCoherentEnVigueur(prisma, produitId, aujourdhui(), calcul)).rejects.toThrow(ErreurMetier);
    await expect(exigerModeCoherentEnVigueur(prisma, produitId, aujourdhui(), composition)).rejects.toThrow(ErreurMetier);
  });
});

describe("Enregistrement du brouillon", () => {
  it("une version qui n'est pas en mode BAREME refuse le barème (service et base)", async () => {
    const { versionId } = await nouvelleVersion("GARANTIES");
    await expect(enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null)).rejects.toThrow(/pas tarifée au barème/);
    await expect(
      obtenirPrisma().$executeRawUnsafe(`INSERT INTO bareme_documents (version_id, statut, schema_version, contenu, empreinte, cree_par) VALUES (${versionId}, 'BROUILLON', 1, '{}', '${"a".repeat(64)}', 'test')`),
    ).rejects.toThrow(/pas en mode BAREME/);
  });

  it("un document qui échoue au schéma est refusé avec des erreurs nommées, sans rien écrire", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const faux = documentAvecBranches();
    delete faux.garanties;
    const e = await enregistrerBrouillonBareme(technique, versionId, faux, null).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurBaremeInvalide);
    expect((e as ErreurBaremeInvalide).problemes[0]).toMatchObject({ code: "SCHEMA" });
    expect((e as ErreurBaremeInvalide).details[0]).toMatch(/^\[SCHEMA\] garanties/);
    expect(await lignesBareme(versionId)).toHaveLength(0);
  });

  it("un document qui échoue à verifierBareme est refusé avec le code et le message du problème", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const faux = documentAvecBranches();
    delete faux.tables[0].lignes[Object.keys(faux.tables[0].lignes)[0]];
    const e = (await enregistrerBrouillonBareme(technique, versionId, faux, null).catch((x) => x)) as ErreurBaremeInvalide;
    expect(e).toBeInstanceOf(ErreurBaremeInvalide);
    expect(e.problemes.map((p) => p.code)).toContain("TABLE_INCOMPLETE");
    expect(e.details.join(" ")).toMatch(/\[TABLE_INCOMPLETE\].*manque/);
    expect(await lignesBareme(versionId)).toHaveLength(0);
  });

  it("un seul brouillon par version : le second enregistrement le remplace, le journal garde l'avant/après", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const premier = await enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null);
    const modifie = documentAvecBranches();
    modifie.jeuxEssai[0].nom = "Essai renommé (inventé)";
    const second = await enregistrerBrouillonBareme(technique, versionId, modifie, null);
    expect(second.id).toBe(premier.id);
    expect(second.empreinte).not.toBe(premier.empreinte);
    const lignes = await lignesBareme(versionId);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ statut: "BROUILLON", empreinte: second.empreinte, publiePar: null, publieLe: null, motifPublication: null, creePar: technique.identifiant });
    // La base elle-même refuse un second brouillon.
    await expect(
      obtenirPrisma().$executeRawUnsafe(`INSERT INTO bareme_documents (version_id, statut, schema_version, contenu, empreinte, cree_par) VALUES (${versionId}, 'BROUILLON', 1, '{}', '${"a".repeat(64)}', 'test')`),
    ).rejects.toThrow();
    const journal = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.find((l) => l.objet === `bareme_document ${second.id}` && l.avant !== null)!;
    expect(journal.avant).toMatchObject({ statut: "BROUILLON", empreinte: premier.empreinte });
    expect(journal.apres).toMatchObject({ statut: "BROUILLON", empreinte: second.empreinte, versionId });
  });

  it("l'empreinte est le SHA-256 du JSON canonique du contenu relu en base (l'ordre des clés de jsonb ne compte pas)", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const { empreinte } = await enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null);
    const [ligne] = await lignesBareme(versionId);
    expect(empreinteBareme(ligne.contenu)).toBe(empreinte);
    expect(createHash("sha256").update(jsonCanonique(ligne.contenu)).digest("hex")).toBe(empreinte);
  });

  it("le droit est celui du paramétrage des produits : Commercial et Comptabilité (lecture) refusés, Technique et DG admis", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    await expect(enregistrerBrouillonBareme(commercial, versionId, documentAvecBranches(), null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(enregistrerBrouillonBareme(comptable, versionId, documentAvecBranches(), null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(rejouerLesEssaisBareme(commercial, versionId)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(publierBareme(commercial, versionId, "motif", null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(enregistrerBrouillonBareme(dg, versionId, documentAvecBranches(), null)).resolves.toBeDefined();
  });
});

describe("Publication", () => {
  it("rejoue les essais, publie, journalise le publieur et l'avant/après ; le barème publié se relit et calcule 139 420 F TTC", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const { empreinte: empreinteBrouillon, id } = await enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null);
    expect(await rejouerLesEssaisBareme(technique, versionId)).toEqual([]);

    const publie = await publierBareme(technique, versionId, "Première publication du barème inventé", "10.0.0.1");
    expect(publie).toEqual({ id, empreinte: empreinteBrouillon });
    const [ligne] = await lignesBareme(versionId);
    expect(ligne).toMatchObject({ statut: "PUBLIE", publiePar: technique.identifiant, motifPublication: "Première publication du barème inventé", schemaVersion: 1 });
    expect(ligne.publieLe).toBeInstanceOf(Date);

    const journal = (await lireJournal({ action: "PARAMETRE_MODIFIE" })).lignes.find((l) => l.objet === `bareme_document ${id}` && (l.apres as { statut?: string }).statut === "PUBLIE")!;
    expect(journal.utilisateur).toBe(technique.identifiant);
    expect(journal.adresseIp).toBe("10.0.0.1");
    expect(journal.avant).toMatchObject({ statut: "BROUILLON", empreinte: empreinteBrouillon });
    expect(journal.apres).toMatchObject({ statut: "PUBLIE", empreinte: publie.empreinte, motif: "Première publication du barème inventé", publiePar: technique.identifiant });

    const lu = await lireBaremePublie(obtenirPrisma(), versionId);
    expect(lu.empreinte).toBe(publie.empreinte);
    const parametres = parametresEssai({
      taxes: { [IARD]: { tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES" }, [INCENDIE]: { tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES" } },
    });
    const essai = lu.bareme.jeuxEssai[0].entrees;
    const saisie: Saisie = { champs: essai.champs, souscrit: essai.souscrit };
    const { empreinte, resultat } = await calculerAvecBaremePublie(obtenirPrisma(), versionId, saisie, parametres);
    expect(empreinte).toBe(publie.empreinte);
    expect(resultat.ok).toBe(true);
    if (resultat.ok) expect(composerBareme(resultat.lignes, parametres).totaux.arrondi.ttc.toFixed()).toBe("139420");
  });

  it("le motif est obligatoire", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    await enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null);
    await expect(publierBareme(technique, versionId, "   ", null)).rejects.toThrow(/motif de publication est obligatoire/);
    expect((await lignesBareme(versionId))[0].statut).toBe("BROUILLON");
  });

  it("un essai qui échoue refuse la publication avec l'écart ligne à ligne, et le brouillon reste un brouillon", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const faux = documentAvecBranches();
    faux.jeuxEssai[0].attendu.lignes[1].nette = "20961"; // vol : 20960 attendu par le calcul
    faux.jeuxEssai[0].attendu.ttc = "139421";
    await enregistrerBrouillonBareme(technique, versionId, faux, null);

    const ecarts = await rejouerLesEssaisBareme(technique, versionId);
    expect(ecarts.length).toBeGreaterThanOrEqual(2);
    const e = (await publierBareme(technique, versionId, "Tentative", null).catch((x) => x)) as ErreurPublicationBareme;
    expect(e).toBeInstanceOf(ErreurPublicationBareme);
    expect(e.ecarts).toEqual(ecarts);
    expect(e.details).toContain(`Essai « ${faux.jeuxEssai[0].nom} », ligne « vol », nette : attendu 20961, obtenu 20960`);
    expect(e.details).toContain(`Essai « ${faux.jeuxEssai[0].nom} », ttc total : attendu 139421, obtenu 139420`);
    const lignes = await lignesBareme(versionId);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ statut: "BROUILLON", publiePar: null });
    await expect(lireBaremePublie(obtenirPrisma(), versionId)).rejects.toThrow(MESSAGE_BAREME_NON_PUBLIE);
  });

  it("un barème sans jeu d'essai ne se publie pas", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const sans = documentAvecBranches();
    sans.jeuxEssai = [];
    await enregistrerBrouillonBareme(technique, versionId, sans, null);
    const e = (await publierBareme(technique, versionId, "Sans essai", null).catch((x) => x)) as ErreurBaremeInvalide;
    expect(e.problemes.map((p) => p.code)).toContain("AUCUN_ESSAI");
  });

  it("sans brouillon, rien à publier", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    await expect(publierBareme(technique, versionId, "motif", null)).rejects.toThrow(/pas de brouillon/);
  });

  it("deux publications simultanées : une seule aboutit, l'autre voit le barème déjà publié", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    await enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null);
    const resultats = await Promise.allSettled([publierBareme(technique, versionId, "Publication A", null), publierBareme(dg, versionId, "Publication B", null)]);
    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refus = resultats.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refus.reason).toBeInstanceOf(ErreurMetier);
    expect(String(refus.reason.message)).toMatch(/déjà publié/);
    const lignes = await lignesBareme(versionId);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].statut).toBe("PUBLIE");
  });
});

describe("Gel d'un barème publié (déclencheur)", () => {
  it("ni modification, ni suppression, ni nouveau brouillon, ni second publié ; le service refuse aussi", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    await enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null);
    const { id } = await publierBareme(technique, versionId, "Publication à geler", null);
    const prisma = obtenirPrisma();

    await expect(prisma.baremeDocument.update({ where: { id }, data: { motifPublication: "réécrit" } })).rejects.toThrow(); // Prisma traduit restrict_violation en erreur de clé étrangère (refus-base.ts la reconnaît)
    await expect(prisma.$executeRawUnsafe(`UPDATE bareme_documents SET contenu = '{}' WHERE id = ${id}`)).rejects.toThrow(/barème publié/);
    await expect(prisma.$executeRawUnsafe(`UPDATE bareme_documents SET statut = 'BROUILLON', publie_par = NULL, publie_le = NULL, motif_publication = NULL WHERE id = ${id}`)).rejects.toThrow(/barème publié/);
    await expect(prisma.baremeDocument.delete({ where: { id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO bareme_documents (version_id, statut, schema_version, contenu, empreinte, cree_par) VALUES (${versionId}, 'BROUILLON', 1, '{}', '${"a".repeat(64)}', 'test')`)).rejects.toThrow(/déjà un barème publié/);
    await expect(enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null)).rejects.toThrow(/déjà un barème publié/);
    await expect(publierBareme(technique, versionId, "Encore", null)).rejects.toThrow(/déjà publié/);
    // La version elle-même ne peut pas disparaître sous son barème.
    await expect(prisma.produitVersion.delete({ where: { id: versionId } })).rejects.toThrow();
    expect((await lignesBareme(versionId))[0]).toMatchObject({ statut: "PUBLIE", motifPublication: "Publication à geler" });
  });

  it("la base impose la cohérence d'une publication (publieur, date et motif présents) et la naissance en brouillon", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    const sql = (statut: string, suite = "") => `INSERT INTO bareme_documents (version_id, statut, schema_version, contenu, empreinte, cree_par${suite ? ", publie_par, publie_le, motif_publication" : ""}) VALUES (${versionId}, '${statut}', 1, '{}', '${"a".repeat(64)}', 'test'${suite})`;
    await expect(obtenirPrisma().$executeRawUnsafe(sql("PUBLIE", ", 'x', now(), 'motif'"))).rejects.toThrow(/naît en brouillon/);
    await expect(obtenirPrisma().$executeRawUnsafe(sql("BROUILLON", ", 'x', now(), 'motif'"))).rejects.toThrow();
    await expect(obtenirPrisma().$executeRawUnsafe(sql("ARCHIVE"))).rejects.toThrow();
  });

  it("un contenu altéré hors application (déclencheurs contournés) est détecté à la lecture : aucun calcul", async () => {
    const { versionId } = await nouvelleVersion("BAREME");
    await enregistrerBrouillonBareme(technique, versionId, documentAvecBranches(), null);
    const { id } = await publierBareme(technique, versionId, "Publication à altérer", null);
    await obtenirPrisma().$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
      await tx.$executeRawUnsafe(`UPDATE bareme_documents SET contenu = jsonb_set(contenu, '{produit,taxe}', '"AUTRE"') WHERE id = ${id}`);
    });
    await expect(lireBaremePublie(obtenirPrisma(), versionId)).rejects.toThrow(/empreinte/);
  });
});
