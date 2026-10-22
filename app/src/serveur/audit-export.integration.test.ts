// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration). Export Excel du journal d'audit (étape 10, point 9).
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PROFILS } from "@/domaine/droits";

import { journaliser, lireJournal, lireJournalPourExport } from "./audit";
import { LIMITE_EXPORT_AUDIT, exporterJournal } from "./audit-export";
import { initialiserProfilsEtDroits } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, type UtilisateurCourant } from "./types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "./utilisateurs";

// Données de test inventées. Chaque test utilise ses propres identifiants (le journal ne s'efface pas).
const MDP = "phrase-de-passe-inventee-2026";
const unique = (prefixe: string) => `${prefixe}-${Math.random().toString(36).slice(2, 8)}`;

let admin: UtilisateurCourant;
const parProfil = {} as Record<string, UtilisateurCourant>;

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

async function lireClasseur(contenu: Uint8Array) {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(Buffer.from(contenu) as unknown as ArrayBuffer);
  return classeur;
}

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const identifiantAdmin = unique("admin");
  await creerAdministrateurInitial({ identifiant: identifiantAdmin, nom: "Admin de test", motDePasse: MDP });
  admin = await compte(identifiantAdmin);
  for (const profil of PROFILS) {
    if (profil.code === "ADMIN_SYSTEME") {
      parProfil[profil.code] = admin;
      continue;
    }
    const identifiant = unique(profil.code.toLowerCase().replace(/_/g, "-"));
    await creerUtilisateur(admin, { identifiant, nom: `Compte ${profil.code}`, profil: profil.code, motDePasse: MDP }, null);
    parProfil[profil.code] = await compte(identifiant);
  }
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("export Excel du journal d'audit : droits (CDC §15 : Admin, Technique et Direction Générale)", () => {
  it.each([
    ["ADMIN_SYSTEME", true],
    ["TECHNIQUE", true],
    ["DIRECTION_GENERALE", true],
    ["COMMERCIAL", false],
    ["GESTIONNAIRE_PRODUCTION", false],
    ["COMPTABILITE", false],
  ])("%s : export autorisé = %s (même droit que l'écran)", async (profil, autorise) => {
    const acteur = parProfil[profil];
    if (autorise) {
      const { nom, contenu } = await exporterJournal(acteur, {}, null);
      expect(nom).toMatch(/^journal_audit_\d{4}-\d{2}-\d{2}\.xlsx$/);
      expect(contenu.byteLength).toBeGreaterThan(1000);
    } else {
      await expect(exporterJournal(acteur, {}, null)).rejects.toBeInstanceOf(ErreurAcces);
    }
  });

  it("un export refusé ne laisse aucune trace d'export", async () => {
    const commercial = parProfil.COMMERCIAL;
    await expect(exporterJournal(commercial, {}, "203.0.113.7")).rejects.toBeInstanceOf(ErreurAcces);
    const traces = (await lireJournal({ action: "JOURNAL_EXPORTE" })).lignes.filter((l) => l.utilisateur === commercial.identifiant);
    expect(traces).toHaveLength(0);
  });
});

describe("export Excel du journal d'audit : contenu", () => {
  it("colonnes demandées, lignes du plus récent au plus ancien, avant / après en JSON, adresse IP", async () => {
    const identifiant = unique("cible");
    await journaliser({ acteur: { id: null, identifiant }, action: "PARAMETRE_MODIFIE", objetType: "parametre", objetId: "seuil", avant: { valeur: "10000000" }, apres: { valeur: "20000000" }, adresseIp: "198.51.100.23" });
    await journaliser({ acteur: { id: null, identifiant }, action: "DOCUMENT_EMIS", objetType: "document", objetId: 7, adresseIp: null });

    const classeur = await lireClasseur((await exporterJournal(parProfil.TECHNIQUE, {}, "203.0.113.8")).contenu);
    const feuille = classeur.getWorksheet("Journal")!;
    expect(feuille.getRow(1).values).toEqual([undefined, "Date", "Utilisateur", "Action", "Objet", "Avant", "Après", "Adresse IP"]);

    const lignes = feuille.getSheetValues().slice(2) as unknown as (string | Date)[][];
    const miennes = lignes.filter((l) => l[2] === identifiant);
    expect(miennes).toHaveLength(2);
    // Du plus récent au plus ancien : DOCUMENT_EMIS a été écrit après PARAMETRE_MODIFIE.
    expect(miennes.map((l) => l[3])).toEqual(["DOCUMENT_EMIS", "PARAMETRE_MODIFIE"]);
    expect(miennes[0][1]).toBeInstanceOf(Date);
    expect(miennes[0].slice(4)).toEqual(["document 7", "", "", ""]);
    expect(miennes[1].slice(4)).toEqual(["parametre seuil", JSON.stringify({ valeur: "10000000" }), JSON.stringify({ valeur: "20000000" }), "198.51.100.23"]);
    const dates = lignes.map((l) => (l[1] as Date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("le filtre « Action » de l'écran s'applique à l'export (une action inconnue est ignorée)", async () => {
    const identifiant = unique("filtre");
    await journaliser({ acteur: { id: null, identifiant }, action: "CLIENT_CREE", objetType: "client", objetId: 1 });
    await journaliser({ acteur: { id: null, identifiant }, action: "DOCUMENT_EMIS", objetType: "document", objetId: 2 });

    const filtre = await exporterJournal(parProfil.DIRECTION_GENERALE, { action: "CLIENT_CREE" }, null);
    expect(filtre.nom).toMatch(/_CLIENT_CREE\.xlsx$/);
    const classeur = await lireClasseur(filtre.contenu);
    const actions = (classeur.getWorksheet("Journal")!.getSheetValues().slice(2) as unknown as string[][]).map((l) => l[3]);
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions)).toEqual(new Set(["CLIENT_CREE"]));
    const infos = classeur.getWorksheet("Informations")!;
    expect(infos.getRow(4).values).toEqual([undefined, "Filtre « Action »", "CLIENT_CREE"]);
    expect(infos.getRow(7).values).toEqual([undefined, "Export tronqué", "Non"]);

    const inconnue = await exporterJournal(parProfil.DIRECTION_GENERALE, { action: "'; DROP TABLE journal_audit; --" }, null);
    expect(inconnue.nom).toMatch(/^journal_audit_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("les valeurs commençant par = + - @ restent du texte (aucune formule exécutable dans le classeur)", async () => {
    const identifiant = unique("=cmd");
    await journaliser({ acteur: { id: null, identifiant }, action: "CLIENT_CREE", objetType: "client", objetId: "=1+1", apres: { nom: "=HYPERLINK(\"http://exemple.invalide\")" } });
    const classeur = await lireClasseur((await exporterJournal(parProfil.TECHNIQUE, { action: "CLIENT_CREE" }, null)).contenu);
    const ligne = (classeur.getWorksheet("Journal")!.getSheetValues().slice(2) as unknown as string[][]).find((l) => l[2] === identifiant)!;
    expect(typeof ligne[2]).toBe("string");
    expect(typeof ligne[4]).toBe("string");
    classeur.getWorksheet("Journal")!.eachRow((r) => r.eachCell((c) => expect(c.formula).toBeUndefined()));
  });
});

describe("export Excel du journal d'audit : traçabilité et limite", () => {
  it("l'export est journalisé (qui, quel filtre, combien de lignes, tronqué ou non)", async () => {
    const technique = parProfil.TECHNIQUE;
    await exporterJournal(technique, { action: "CLIENT_CREE" }, "203.0.113.9");
    const trace = (await lireJournal({ action: "JOURNAL_EXPORTE" })).lignes.find((l) => l.utilisateur === technique.identifiant && l.adresseIp === "203.0.113.9")!;
    expect(trace).toBeDefined();
    expect(trace.apres).toMatchObject({ filtreAction: "CLIENT_CREE", tronque: false });
    expect((trace.apres as { lignes: number }).lignes).toBeGreaterThan(0);
  });

  it("la lecture s'arrête à la limite et signale s'il reste des entrées plus anciennes (limite exacte comprise)", async () => {
    // JOURNAL_EXPORTE n'est écrit que par ce fichier de tests : on peut compter. Au moins 3 lignes grâce aux tests précédents.
    const toutes = (await lireJournalPourExport({ action: "JOURNAL_EXPORTE", limite: 100_000 })).lignes;
    expect(toutes.length).toBeGreaterThanOrEqual(3);
    const total = toutes.length;

    const partiel = await lireJournalPourExport({ action: "JOURNAL_EXPORTE", limite: 2 });
    expect(partiel.lignes.map((l) => l.id)).toEqual(toutes.slice(0, 2).map((l) => l.id));
    expect(partiel.tronque).toBe(true);

    const exact = await lireJournalPourExport({ action: "JOURNAL_EXPORTE", limite: total });
    expect(exact.lignes).toHaveLength(total);
    expect(exact.tronque).toBe(false);

    const unDeMoins = await lireJournalPourExport({ action: "JOURNAL_EXPORTE", limite: total - 1 });
    expect(unDeMoins.lignes).toHaveLength(total - 1);
    expect(unDeMoins.tronque).toBe(true);
  });

  it("la limite d'un export est de 50 000 lignes", () => {
    expect(LIMITE_EXPORT_AUDIT).toBe(50_000);
  });
});
