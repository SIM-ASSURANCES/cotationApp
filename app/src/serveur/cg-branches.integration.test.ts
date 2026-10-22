// Étape 6 (D42) : conditions générales par branche principale, historisées par date d'effet. Données de test inventées.
import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { ajouterJours, aujourdhui } from "@/domaine/calcul/dates";
import type { Analyse } from "@/domaine/documents/analyse";

import { viderCgDeTest } from "./branches-test";
import { lireJournal } from "./audit";
import { cgDeLaBranche, listerCgBranches, listerModelesCg, rattacherCgBranche } from "./cg-branches";
import { initialiserProfilsEtDroits } from "./droits";
import { remplacerGenerateur } from "./generateur";
import { creerModele, deposerVersion, publierVersion, soumettreVersion } from "./modeles";
import { obtenirPrisma } from "./prisma";
import { remplacerStockage } from "./stockage";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = (p: string) => unique(p).toUpperCase().replace(/-/g, "_");
const texte = (t: string) => new TextEncoder().encode(t);

let admin: UtilisateurCourant;
let technique: UtilisateurCourant;
let dg: UtilisateurCourant;
let comptable: UtilisateurCourant;
let commercial: UtilisateurCourant;

const ici = { partie: "corps", paragraphe: 1, tableau: null, ligne: null, colonne: null, extrait: "" };
const analyseCg: Analyse = {
  docx_valide: true,
  erreur: null,
  nombre_balises: 1,
  references: [{ chemin: "produit.cg_visa", balise: "{{ produit.cg_visa }}", emplacement: ici }],
  problemes: [],
  champs_word: [],
  blocs: [],
  filtres: [],
  polices: [],
  polices_absentes: [],
  textes: [],
};
const sans = { niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null };

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}
async function nouveauCompte(profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: `${profil} Test`, profil, motDePasse: MDP }, null);
  return compte(identifiant);
}

/** Modèle de CG déposé avec son visa, puis soumis et publié (ou laissé en brouillon). */
async function modeleCg(visa: string, publie = true): Promise<string> {
  const id = await creerModele(technique, { type: "CG", code: CODE("CG_BR"), libelle: "CG de test", produitCode: null, ...sans }, null);
  await deposerVersion(technique, id, { fichier: texte("docx CG"), nomFichier: "cg.docx", commentaire: "inventée", dateEffet: aujourdhui(), visa, dateDocument: "2025-06-19" }, null);
  if (publie) {
    const v = await obtenirPrisma().modeleVersion.findFirstOrThrow({ where: { modeleId: id }, orderBy: { numero: "desc" } });
    await soumettreVersion(technique, v.id, null);
    await publierVersion(dg, v.id, aujourdhui(), null);
  }
  return (await obtenirPrisma().modele.findUniqueOrThrow({ where: { id } })).code;
}

beforeAll(async () => {
  remplacerGenerateur({
    analyser: async () => analyseCg,
    genererPdf: async () => texte("%PDF-1.7 simulé"),
  });
  remplacerStockage({
    async ecrire(_chemin, contenu) {
      return { empreinte: createHash("sha256").update(contenu).digest("hex") };
    },
    async lire() {
      throw new ErreurMetier("Stockage : introuvable.");
    },
    async zip() {
      return texte("PK");
    },
  });
  await initialiserProfilsEtDroits();
  const idAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: idAdmin, nom: "Admin", motDePasse: MDP });
  admin = await compte(idAdmin);
  [technique, dg, comptable, commercial] = [await nouveauCompte("TECHNIQUE"), await nouveauCompte("DIRECTION_GENERALE"), await nouveauCompte("COMPTABILITE"), await nouveauCompte("COMMERCIAL")];
});

describe("rattachement d'une CG à une branche (historisé, journalisé)", () => {
  it("rattache un modèle publié : le visa est lu dans la version publiée, le rattachement est journalisé", async () => {
    await viderCgDeTest("RECOLTE");
    const cg = await modeleCg("VISA-INVENTE-R1");
    await rattacherCgBranche(technique, { branchePrincipale: "RECOLTE", modeleCode: cg, dateEffet: aujourdhui() }, null);

    const branche = (await listerCgBranches(technique)).find((b) => b.code === "RECOLTE")!;
    expect(branche.enVigueur).toMatchObject({ modeleCode: cg, visa: "VISA-INVENTE-R1", dateEffet: aujourdhui() });
    expect(branche.historique).toHaveLength(1);
    const { lignes } = await lireJournal({ action: "PARAMETRE_MODIFIE" });
    expect(lignes.some((l) => l.objet?.startsWith("branche_cg") && JSON.stringify(l.apres).includes(cg) && l.utilisateur === technique.identifiant)).toBe(true);
    expect((await listerModelesCg(technique)).find((m) => m.code === cg)?.visa).toBe("VISA-INVENTE-R1");
  });

  it("une nouvelle CG est une nouvelle ligne datée : l'ancienne reste en vigueur jusqu'à la date d'effet, jamais modifiée", async () => {
    await viderCgDeTest("DECES");
    const ancienne = await modeleCg("VISA-INVENTE-D1");
    const nouvelle = await modeleCg("VISA-INVENTE-D2");
    const demain = ajouterJours(aujourdhui(), 1);
    await rattacherCgBranche(technique, { branchePrincipale: "DECES", modeleCode: ancienne, dateEffet: aujourdhui() }, null);
    await rattacherCgBranche(technique, { branchePrincipale: "DECES", modeleCode: nouvelle, dateEffet: demain }, null);

    expect((await cgDeLaBranche(obtenirPrisma(), "DECES", aujourdhui()))?.modeleCode).toBe(ancienne);
    expect((await cgDeLaBranche(obtenirPrisma(), "DECES", demain))?.modeleCode).toBe(nouvelle);
    expect((await listerCgBranches(technique)).find((b) => b.code === "DECES")!.historique).toHaveLength(2);

    // La ligne en vigueur ne se modifie ni ne se supprime (déclencheur d'historique) ; une même date d'effet est refusée.
    await expect(obtenirPrisma().brancheCg.updateMany({ where: { branchePrincipale: "DECES", modeleCode: ancienne }, data: { modeleCode: nouvelle } })).rejects.toThrow();
    await expect(obtenirPrisma().brancheCg.deleteMany({ where: { branchePrincipale: "DECES", modeleCode: ancienne } })).rejects.toThrow();
    await expect(rattacherCgBranche(technique, { branchePrincipale: "DECES", modeleCode: nouvelle, dateEffet: demain }, null)).rejects.toThrow(/déjà rattachée à cette branche à cette date/);
  });

  it("refus : date passée, modèle d'un autre type ou inconnu, version non publiée, branche inconnue", async () => {
    await viderCgDeTest("ACCIDENTS_CORPORELS");
    const brouillon = await modeleCg("VISA-INVENTE-A1", false);
    const cg = await modeleCg("VISA-INVENTE-A2");
    const hier = ajouterJours(aujourdhui(), -1);
    const cible = (modeleCode: string, dateEffet = aujourdhui()) => rattacherCgBranche(technique, { branchePrincipale: "ACCIDENTS_CORPORELS", modeleCode, dateEffet }, null);
    await expect(cible(cg, hier)).rejects.toThrow(/date d'effet ne peut pas être passée/);
    await expect(cible(brouillon)).rejects.toThrow(/aucune version publiée en vigueur/);
    await expect(cible("N_EXISTE_PAS")).rejects.toThrow(/n'est pas un modèle de conditions générales/);
    await expect(rattacherCgBranche(technique, { branchePrincipale: "SANTE", modeleCode: cg, dateEffet: aujourdhui() }, null)).rejects.toThrow(/Branche principale inconnue/);
    const cp = await creerModele(technique, { type: "CS", code: CODE("CS_BR"), libelle: "Une CS", produitCode: null, ...sans }, null);
    await expect(cible((await obtenirPrisma().modele.findUniqueOrThrow({ where: { id: cp } })).code)).rejects.toThrow(/n'est pas un modèle de conditions générales/);
    expect((await listerCgBranches(technique)).find((b) => b.code === "ACCIDENTS_CORPORELS")!.enVigueur).toBeNull();
  });

  it("droits : la Technique écrit, la Comptabilité (lecture) consulte sans écrire, le Commercial n'a pas accès", async () => {
    await viderCgDeTest("RECOLTE");
    const cg = await modeleCg("VISA-INVENTE-R2");
    await expect(rattacherCgBranche(comptable, { branchePrincipale: "RECOLTE", modeleCode: cg, dateEffet: aujourdhui() }, null)).rejects.toThrow(ErreurAcces);
    await expect(listerCgBranches(comptable)).resolves.toHaveLength(5);
    await expect(listerCgBranches(commercial)).rejects.toThrow(ErreurAcces);
    await expect(rattacherCgBranche(commercial, { branchePrincipale: "RECOLTE", modeleCode: cg, dateEffet: aujourdhui() }, null)).rejects.toThrow(ErreurAcces);
  });
});
