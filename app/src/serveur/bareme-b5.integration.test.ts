// Session B5 (D59) : tables, sous-jacents et jeux d'essai édités à l'écran ; publication depuis l'écran ; contrôle des balises des modèles
// publiés (ajout 9) ; codes figés côté serveur (ajout 10). Même document que l'import (bareme_documents), mêmes schéma et verifierBareme.
// Données de test INVENTÉES : le SECURPRO est saisi par les opérations de l'éditeur (`secuproSaisiALEcran`), jamais lu d'un barème réel.
import { beforeAll, describe, expect, it } from "vitest";

import {
  ajouterLigneAttendue,
  poserCase,
  poserMontantAttendu,
  schemaBareme,
  supprimerChamp,
  verifierBareme,
  type Bareme,
  type Resultat,
} from "@/domaine/bareme";
import { secuproSaisiALEcran } from "@/domaine/bareme/securpro-ecran";
import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import type { VersionSaisie } from "@/domaine/calcul/parametrage";

import { lireJournal } from "./audit";
import { assurerBranche } from "./branches-test";
import {
  basculerVersionAuBareme,
  controlerAvantPublication,
  enregistrerBrouillonBareme,
  ErreurBalisesAbsentes,
  ErreurBaremeInvalide,
  ErreurPublicationBareme,
  lireBaremePublie,
  publierBareme,
} from "./bareme";
import { creerVersionDepuisBareme } from "./bareme-edition";
import { debutTest } from "./dates-test";
import { initialiserProfilsEtDroits } from "./droits";
import { creerProduit, creerTaxe, creerVersion } from "./parametrage";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

import { construireClasseur } from "./bareme-classeur-ecriture";
import { importerBaremeXlsx } from "./bareme-excel";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");

let technique: UtilisateurCourant;
let commercial: UtilisateurCourant;
let IARD: string;
let INCENDIE: string;

const compte = async (identifiant: string) => versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
const ok = (r: Resultat): Bareme => {
  if (!r.ok) throw new Error(r.refus.join(" | "));
  return r.bareme;
};
const secupro = (): Bareme => secuproSaisiALEcran({ taxe: IARD, taxeIncendie: INCENDIE });

const version = (dateEffet: string): VersionSaisie => ({
  dateEffet,
  modeTarification: "GARANTIES",
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

async function nouvelleVersion(): Promise<{ code: string; versionId: number }> {
  const code = CODE("B5");
  await creerProduit(technique, { code, libelle: "Produit B5 édité à l'écran (inventé)", gamme: "SECUR", branchePrincipale: "INCENDIE_DOMMAGES", branche: IARD }, null);
  await creerVersion(technique, code, version(debutTest()), null);
  const v = await obtenirPrisma().produitVersion.findFirstOrThrow({ where: { produit: { code } } });
  return { code, versionId: v.id };
}

const brouillonDe = async (versionId: number) => schemaBareme.parse((await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId, statut: "BROUILLON" } })).contenu);
const enregistrer = (versionId: number, b: Bareme) => enregistrerBrouillonBareme(technique, versionId, b, null, { toleranceIntegrite: true });

/** Un modèle PUBLIÉ du produit, avec les chemins de balises que son analyse a lus au dépôt (base de test : le déclencheur de publication est contourné). */
async function modelePublie(codeProduit: string, type: string, chemins: string[], options: { numero?: number; statut?: string; dateEffet?: string; modeleId?: number } = {}): Promise<number> {
  const prisma = obtenirPrisma();
  const produit = await prisma.produit.findUniqueOrThrow({ where: { code: codeProduit } });
  const modeleId = options.modeleId ?? (await prisma.modele.create({ data: { type, code: CODE(`M_${type}`), libelle: `Modèle ${type} de test`, produitId: produit.id, creePar: "test" } })).id;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica;");
    await tx.modeleVersion.create({
      data: {
        modeleId,
        numero: options.numero ?? 1,
        statut: options.statut ?? "PUBLIE",
        fichier: new Uint8Array([1]),
        nomFichier: "modele.docx",
        taille: 1,
        empreinte: "b".repeat(64),
        commentaire: "version de test",
        dateEffet: new Date(options.dateEffet ?? "2020-01-01"),
        analyse: { champs: chemins },
        auteurId: 1,
        auteurIdentifiant: "test",
      },
    });
  });
  return modeleId;
}

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
  [technique, commercial] = [await nouveau("TECHNIQUE"), await nouveau("COMMERCIAL")];
  INCENDIE = `INC_${CODE("T")}`.slice(0, 20);
  IARD = `IARD_${CODE("T")}`.slice(0, 20);
  await assurerBranche(INCENDIE);
  await assurerBranche(IARD);
  await creerTaxe(technique, { branche: INCENDIE, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "12.5", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
  await creerTaxe(technique, { branche: IARD, typeContrat: null, tauxMixte: false, commentaire: null, tauxPourcent: "7.25", assiette: "NETTE_ACCESSOIRES", dateEffet: "2020-01-01", dateFin: null }, null);
});

describe("Une table incomplète bloque la publication", () => {
  it("la case vidée est signalée à l'enregistrement, la publication est refusée et journalisée ; la case remplie, elle passe", async () => {
    const { versionId } = await nouvelleVersion();
    const complet = secupro();
    const casse = ok(poserCase(complet, "securite", "OUI|NON", ""));
    expect(casse.tables.find((t) => t.code === "securite")!.lignes).not.toHaveProperty("OUI|NON");

    const r = await enregistrer(versionId, casse);
    expect(r.problemes.map((p) => p.code)).toEqual(["TABLE_INCOMPLETE"]);
    expect(r.problemes[0].message).toBe("Table « securite » : la ligne « OUI|NON » manque.");

    const refus = (await publierBareme(technique, versionId, "Table incomplète", null).catch((e) => e)) as ErreurBaremeInvalide;
    expect(refus).toBeInstanceOf(ErreurBaremeInvalide);
    expect(refus.problemes.map((p) => p.code)).toContain("TABLE_INCOMPLETE");
    const brouillon = await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId } });
    expect(brouillon.statut).toBe("BROUILLON");
    const journal = (await lireJournal({ action: "BAREME_PUBLICATION_REFUSEE" })).lignes.find((l) => l.objet === `bareme_document ${brouillon.id}`);
    expect(journal).toBeDefined();

    await enregistrer(versionId, ok(poserCase(casse, "securite", "OUI|NON", "0,9")));
    await expect(publierBareme(technique, versionId, "Table complète", null)).resolves.toMatchObject({ id: brouillon.id });
  });
});

describe("Un sous-jacent sur un champ supprimé bloque", () => {
  it("l'éditeur refuse la suppression en nommant la table qui lit le champ ; un document forcé est signalé et la publication refusée", async () => {
    const b = secupro();
    const refus = supprimerChamp(b, "gardien");
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.refus.join(" ")).toContain("table « securite »");

    // Un document qui contourne l'écran (client ancien, appel direct) : le champ n'existe plus, la table le lit encore.
    const { versionId } = await nouvelleVersion();
    const force: Bareme = { ...b, champs: b.champs.filter((c) => c.code !== "gardien") };
    const r = await enregistrer(versionId, force);
    expect(r.problemes.map((p) => p.code)).toContain("REFERENCE_INCONNUE");
    expect(r.problemes.map((p) => p.message).join(" ")).toContain("le champ « gardien » n'existe pas");
    const e = (await publierBareme(technique, versionId, "Champ supprimé", null).catch((x) => x)) as ErreurBaremeInvalide;
    expect(e).toBeInstanceOf(ErreurBaremeInvalide);
    expect(e.problemes.map((p) => p.code)).toContain("REFERENCE_INCONNUE");
  });
});

describe("Un essai à l'attendu faux bloque la publication", () => {
  it("l'écart est donné ligne à ligne par l'onglet Publier ET par la publication ; corrigé, tout passe", async () => {
    const { versionId } = await nouvelleVersion();
    const juste = secupro();
    // La Technique TAPE une valeur fausse (14 000 au lieu de 12 000 pour la dde) : l'application ne la corrige pas.
    const faux = ok(poserMontantAttendu(juste, "Électronique, locataire, boutique", "dde", "nette", "14 000"));
    await enregistrer(versionId, faux);

    const controles = await controlerAvantPublication(technique, versionId);
    expect(controles.nombreEssais).toBe(3);
    expect(controles.balises).toEqual([]);
    expect(controles.ecarts).toEqual([{ essai: "Électronique, locataire, boutique", ligne: "dde", champ: "nette", attendu: "14000", obtenu: "12000" }]);

    const refus = (await publierBareme(technique, versionId, "Attendu faux", null).catch((e) => e)) as ErreurPublicationBareme;
    expect(refus).toBeInstanceOf(ErreurPublicationBareme);
    expect(refus.details).toEqual(["Essai « Électronique, locataire, boutique », ligne « dde », nette : attendu 14000, obtenu 12000"]);
    const ligne = await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId } });
    expect(ligne.statut).toBe("BROUILLON");
    const entree = (await lireJournal({ action: "BAREME_PUBLICATION_REFUSEE" })).lignes.find((l) => l.objet === `bareme_document ${ligne.id}`)!;
    expect(entree.apres).toMatchObject({ raison: "ESSAIS_EN_ECART" });

    await enregistrer(versionId, juste);
    expect((await controlerAvantPublication(technique, versionId)).ecarts).toEqual([]);
    const { empreinte } = await publierBareme(technique, versionId, "Attendu corrigé", null);
    expect((await lireBaremePublie(obtenirPrisma(), versionId)).empreinte).toBe(empreinte);
  });

  it("une ligne attendue ajoutée pour une garantie non souscrite est attrapée (ligne absente), jamais ignorée", async () => {
    const { versionId } = await nouvelleVersion();
    let b = secupro();
    b = ok(ajouterLigneAttendue(b, "Bureau, propriétaire, minimum de la caisse", "dde"));
    b = ok(poserMontantAttendu(b, "Bureau, propriétaire, minimum de la caisse", "dde", "nette", "1"));
    await enregistrer(versionId, b);
    const c = await controlerAvantPublication(technique, versionId);
    expect(c.ecarts).toEqual([{ essai: "Bureau, propriétaire, minimum de la caisse", ligne: "dde", champ: "ligne", attendu: "présente", obtenu: "absente" }]);
  });
});

describe("Un barème publié est intouchable", () => {
  it("ni enregistrement, ni contrôle, ni nouvelle publication ; la base elle-même refuse la modification du contenu", async () => {
    const { versionId } = await nouvelleVersion();
    await enregistrer(versionId, secupro());
    const { id } = await publierBareme(technique, versionId, "Publication de test", null);

    await expect(enregistrer(versionId, secupro())).rejects.toThrow(/déjà un barème publié/);
    await expect(controlerAvantPublication(technique, versionId)).rejects.toThrow(/pas de brouillon/);
    await expect(publierBareme(technique, versionId, "Deuxième fois", null)).rejects.toThrow(/déjà publié/);
    await expect(obtenirPrisma().$executeRawUnsafe(`UPDATE bareme_documents SET contenu = '{}' WHERE id = ${id}`)).rejects.toThrow(/barème publié/);
    expect((await lireBaremePublie(obtenirPrisma(), versionId)).bareme.jeuxEssai).toHaveLength(3);
  });
});

describe("Refus sans droit", () => {
  it("un Commercial ne peut ni enregistrer, ni contrôler, ni publier, ni basculer", async () => {
    const { versionId } = await nouvelleVersion();
    await enregistrer(versionId, secupro());
    await expect(enregistrerBrouillonBareme(commercial, versionId, secupro(), null, { toleranceIntegrite: true })).rejects.toBeInstanceOf(ErreurAcces);
    await expect(controlerAvantPublication(commercial, versionId)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(publierBareme(commercial, versionId, "Sans droit", null)).rejects.toBeInstanceOf(ErreurAcces);
    await expect(basculerVersionAuBareme(commercial, versionId, null)).rejects.toBeInstanceOf(ErreurAcces);
    expect((await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId } })).statut).toBe("BROUILLON");
  });
});

describe("Ajout 9 : une balise de modèle publié sans clé dans le barème refuse la publication", () => {
  it("nomme le modèle, sa version et la balise ; le contrôle de l'onglet Publier dit la même chose sans rien écrire", async () => {
    const { code, versionId } = await nouvelleVersion();
    const modeleCp = await modelePublie(code, "CP", ["risque.type_commerce", "risque_code.situation", "risque.type_commerce_classe", "risque.capitaux_totaux", "risque.contenu_inconnu", "police.numero"]);
    await enregistrer(versionId, secupro());
    const cp = await obtenirPrisma().modele.findUniqueOrThrow({ where: { id: modeleCp } });

    const attendu = `Le modèle CP ${cp.code} v1 cite risque.contenu_inconnu, absent du barème`;
    const controles = await controlerAvantPublication(technique, versionId);
    expect(controles.balises).toEqual([`modèle CP ${cp.code} v1 cite risque.contenu_inconnu, absent du barème`]);

    const refus = (await publierBareme(technique, versionId, "Balise absente", null).catch((e) => e)) as ErreurBalisesAbsentes;
    expect(refus).toBeInstanceOf(ErreurBalisesAbsentes);
    expect(refus).toBeInstanceOf(ErreurMetier);
    expect(refus.details).toEqual([attendu]);
    expect(refus.message).toContain("1 balise(s)");
    const ligne = await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId } });
    expect(ligne.statut).toBe("BROUILLON");
    const entree = (await lireJournal({ action: "BAREME_PUBLICATION_REFUSEE" })).lignes.find((l) => l.objet === `bareme_document ${ligne.id}`)!;
    expect(entree.apres).toMatchObject({ raison: "BALISES_ABSENTES", ecarts: [attendu] });

    // La balise retrouve un champ du barème (ici : un champ « contenu_inconnu » facultatif non imprimable n'est pas requis : on l'ajoute) : la publication passe.
    const avecChamp: Bareme = { ...secupro(), champs: [...secupro().champs, { code: "contenu_inconnu", type: "TEXTE", libelle: "Contenu", obligatoire: false }] };
    await enregistrer(versionId, avecChamp);
    await expect(publierBareme(technique, versionId, "Champ rétabli", null)).resolves.toBeDefined();
  });

  it("les trois types sont contrôlés (CP, cotation, certificat) ; la facture n'est pas concernée ; chaque entrée nomme son modèle", async () => {
    const { code, versionId } = await nouvelleVersion();
    const cp = await modelePublie(code, "CP", ["risque.cp_absent"]);
    const cotation = await modelePublie(code, "COTATION", ["risque_code.cotation_absent"]);
    const certificat = await modelePublie(code, "CERTIFICAT", ["risque.certificat_absent"]);
    await modelePublie(code, "FACTURE", ["risque.facture_absent"]);
    await enregistrer(versionId, secupro());
    const codes = Object.fromEntries(
      (await obtenirPrisma().modele.findMany({ where: { id: { in: [cp, cotation, certificat] } } })).map((m) => [m.id, m.code]),
    );
    const { balises } = await controlerAvantPublication(technique, versionId);
    expect(balises.sort()).toEqual(
      [
        `modèle CP ${codes[cp]} v1 cite risque.cp_absent, absent du barème`,
        `modèle COTATION ${codes[cotation]} v1 cite risque_code.cotation_absent, absent du barème`,
        `modèle CERTIFICAT ${codes[certificat]} v1 cite risque.certificat_absent, absent du barème`,
      ].sort(),
    );
  });

  it("seule la version PUBLIÉE EN VIGUEUR compte : brouillon, soumise, remplacée, programmée plus tard et modèle d'un autre produit sont ignorés", async () => {
    const { code, versionId } = await nouvelleVersion();
    const autre = await nouvelleVersion();
    const modele = await modelePublie(code, "CP", ["risque.ancienne_balise"], { numero: 1, dateEffet: "2020-01-01" }); // remplacée par la v2
    await modelePublie(code, "CP", ["risque.stocks"], { numero: 2, dateEffet: "2021-01-01", modeleId: modele }); // en vigueur : valide
    await modelePublie(code, "CP", ["risque.brouillon_absent"], { numero: 3, statut: "BROUILLON", dateEffet: "2022-01-01", modeleId: modele });
    await modelePublie(code, "CP", ["risque.soumise_absente"], { numero: 4, statut: "SOUMIS", dateEffet: "2022-01-01", modeleId: modele });
    await modelePublie(code, "CP", ["risque.programmee_absente"], { numero: 5, dateEffet: ajouterJours(aujourdhui(), 400), modeleId: modele }); // pas encore en vigueur à la date d'effet
    await modelePublie(autre.code, "CP", ["risque.autre_produit_absent"]);
    await enregistrer(versionId, secupro());
    expect((await controlerAvantPublication(technique, versionId)).balises).toEqual([]);
    await expect(publierBareme(technique, versionId, "Modèles en règle", null)).resolves.toBeDefined();
  });
});

describe("Ajout 10 : un code de champ du publié d'origine ne change pas côté serveur", () => {
  async function versionDeuxDepuisPublie(): Promise<{ code: string; v1: number; v2: number }> {
    const { code, versionId: v1 } = await nouvelleVersion();
    await enregistrer(v1, secupro());
    await publierBareme(technique, v1, "Version 1 (test)", null);
    const { versionId: v2 } = await creerVersionDepuisBareme(technique, v1, ajouterJours(aujourdhui(), 30), null);
    return { code, v1, v2 };
  }

  it("renommer un champ (ou une valeur intermédiaire) du publié est refusé, le brouillon n'est pas touché ; l'import suit la même règle", async () => {
    const { v2 } = await versionDeuxDepuisPublie();
    const copie = await brouillonDe(v2);
    const avant = await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId: v2 } });

    const renommeChamp: Bareme = { ...copie, champs: copie.champs.map((c) => (c.code === "stocks" ? { ...c, code: "stocks_marchandises" } : c)) };
    const e = (await enregistrer(v2, renommeChamp).catch((x) => x)) as ErreurMetier;
    expect(e).toBeInstanceOf(ErreurMetier);
    expect(e.message).toContain("Enregistrement refusé");
    expect(e.details.join(" ")).toContain("« stocks »");
    expect(e.details.join(" ")).toContain("« stocks_marchandises »");

    const renommeInter: Bareme = { ...copie, intermediaires: copie.intermediaires.map((i) => (i.code === "contenu" ? { ...i, code: "contenu_total" } : i)) };
    await expect(enregistrer(v2, renommeInter)).rejects.toThrow(/Enregistrement refusé/);
    // Sans tolérance (chemin de l'import) : même refus.
    await expect(enregistrerBrouillonBareme(technique, v2, renommeChamp, null)).rejects.toThrow();

    const apres = await obtenirPrisma().baremeDocument.findFirstOrThrow({ where: { versionId: v2 } });
    expect(apres.empreinte).toBe(avant.empreinte);
  });

  it("D64 : une liste de montants devient un montant borné dans la nouvelle version, à l'écran comme à l'import, sans refus de la garde des codes", async () => {
    const { v2 } = await versionDeuxDepuisPublie();
    const copie = await brouillonDe(v2);
    const enMontant = (b: Bareme, code: string): Bareme => ({
      ...b,
      champs: b.champs.map((c) => (c.code === "vol_caisse_montant" ? { code, type: "MONTANT" as const, bloc: c.bloc, si: c.si, libelle: c.libelle, min: "50000", max: "200000" } : c)),
      jeuxEssai: b.jeuxEssai.map((e) => ({ ...e, entrees: { ...e.entrees, champs: Object.fromEntries(Object.entries(e.entrees.champs).map(([k, v]) => [k === "vol_caisse_montant" ? code : k, v])) } })),
    });
    // À l'écran : même code, puis autre code.
    await expect(enregistrer(v2, enMontant(copie, "vol_caisse_montant"))).resolves.toMatchObject({ problemes: [] });
    expect((await brouillonDe(v2)).champs.find((c) => c.code === "vol_caisse_montant")).toMatchObject({ type: "MONTANT", min: "50000", max: "200000" });
    await expect(enregistrer(v2, enMontant(copie, "vol_caisse_saisie"))).resolves.toBeDefined();
    // À l'import : même service, sans tolérance d'intégrité.
    const classeur = await construireClasseur(enMontant(copie, "vol_caisse_montant"), { titre: "Import (test D64)" });
    await expect(importerBaremeXlsx(technique, v2, "montant.xlsx", classeur, null)).resolves.toBeDefined();
    expect((await brouillonDe(v2)).champs.find((c) => c.code === "vol_caisse_montant")?.type).toBe("MONTANT");
  });

  it("supprimer un champ reste permis (le contrôle des balises protège les modèles) ; ajouter un champ aussi", async () => {
    const { code, v2 } = await versionDeuxDepuisPublie();
    const copie = await brouillonDe(v2);
    const sans: Bareme = { ...copie, champs: [...copie.champs.filter((c) => c.code !== "camera"), { code: "zone", type: "TEXTE", libelle: "Zone", obligatoire: false }] };
    await expect(enregistrer(v2, sans)).resolves.toMatchObject({ problemes: [] });
    expect((await brouillonDe(v2)).champs.some((c) => c.code === "camera")).toBe(false);

    // Un modèle publié cite encore risque.camera : la publication de la version 2 le refuse, en nommant la balise.
    await modelePublie(code, "COTATION", ["risque.camera"]);
    const refus = (await publierBareme(technique, v2, "Camera supprimée", null).catch((x) => x)) as ErreurBalisesAbsentes;
    expect(refus).toBeInstanceOf(ErreurBalisesAbsentes);
    expect(refus.details.join(" ")).toContain("cite risque.camera, absent du barème");
  });

  it("sans barème publié avant elle, une version renomme librement ses champs (rien n'est encore figé)", async () => {
    const { versionId } = await nouvelleVersion();
    const b = secupro();
    await enregistrer(versionId, b);
    const renomme: Bareme = { ...b, champs: b.champs.map((c) => (c.code === "stocks" ? { ...c, code: "stocks_marchandises" } : c)) };
    await expect(enregistrer(versionId, renomme)).resolves.toBeDefined();
  });

  it("la règle s'appuie sur le publié le plus récent AVANT la version, pas sur une version plus tardive", async () => {
    const { code, v1, v2 } = await versionDeuxDepuisPublie();
    void code;
    void v1;
    const copie = await brouillonDe(v2);
    // Le brouillon de la version 2 peut garder tous les codes du publié et en ajouter d'autres.
    await expect(enregistrer(v2, { ...copie, champs: [...copie.champs, { code: "nouveau", type: "MONTANT", libelle: "Nouveau", obligatoire: false }] })).resolves.toBeDefined();
    // Et la version 1 (publiée) reste ce qu'elle était.
    expect((await lireBaremePublie(obtenirPrisma(), v1)).bareme.champs.some((c) => c.code === "nouveau")).toBe(false);
    expect(verifierBareme(await brouillonDe(v2)).filter((p) => p.code !== "AUCUN_ESSAI")).toEqual([]);
  });
});
