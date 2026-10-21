// Test de route (session 4.0, §2) : l'action serveur du formulaire de version, de la saisie à la base.
// Seules la session, l'adresse IP et le rafraîchissement de page de Next.js sont simulés.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assurerBranche } from "@/serveur/branches-test";
import { initialiserProfilsEtDroits } from "@/serveur/droits";
import { creerProduit } from "@/serveur/parametrage";
import { obtenirPrisma } from "@/serveur/prisma";
import type { UtilisateurCourant } from "@/serveur/types";
import { creerAdministrateurInitial, creerUtilisateur, versUtilisateurCourant } from "@/serveur/utilisateurs";

import { ajouterUneVersion } from "./actions";

let acteurConnecte: UtilisateurCourant;
vi.mock("@/serveur/session", () => ({ exigerUtilisateur: async () => acteurConnecte }));
vi.mock("@/serveur/requete", () => ({ adresseIpCourante: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const MDP = "phrase-de-passe-inventee-2026";
const unique = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const CODE = unique("MNT").toUpperCase().replace(/-/g, "_");

async function compte(identifiant: string): Promise<UtilisateurCourant> {
  return versUtilisateurCourant(await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } }));
}

/** Formulaire tel que le navigateur l'envoie ; `prime` est la prime de la formule SOLO, saisie librement. */
function formulaire(dateEffet: string, prime: string): FormData {
  const d = new FormData();
  const champs: Record<string, string> = {
    codeProduit: CODE, dateEffet, precision: "1", sens: "PROCHE", niveau: "LIGNE", 
    prorataActif: "on", primeMinimale: "", tranchesMax: "4", repartition: "", decalages: "", frais: "0",
    validiteMois: "3", formulesMax: "3", seuil: "20 000 000",
  };
  for (const [k, v] of Object.entries(champs)) d.append(k, v);
  for (const f of [["SOLO", "Solo", "", prime, "FIXE", "3 000"], ["FAMILLE", "Famille", "", "252657,63", "FIXE", "210000"]]) {
    d.append("formule_code", f[0]); d.append("formule_libelle", f[1]); d.append("formule_taux", f[2]);
    d.append("formule_prime", f[3]); d.append("formule_mode", f[4]); d.append("formule_valeur", f[5]);
  }
  return d;
}

const versions = () => obtenirPrisma().produitVersion.findMany({ where: { produit: { code: CODE } }, include: { formules: true } });

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  const admin = unique("admin");
  await creerAdministrateurInitial({ identifiant: admin, nom: "Admin", motDePasse: MDP });
  const technique = unique("technique");
  await creerUtilisateur(await compte(admin), { identifiant: technique, nom: "Technique", profil: "TECHNIQUE", motDePasse: MDP }, null);
  acteurConnecte = await compte(technique);
  await assurerBranche("SANTE");
  await creerProduit(acteurConnecte, { code: CODE, libelle: "Montants saisis (test)", gamme: "RELAX", branchePrincipale: "MALADIE", branche: "SANTE" }, null);
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("saisie des montants : analyseur unique, du formulaire à la base", () => {
  it.each([
    ["espace normale", "93 581,33"],
    ["espace insécable U+00A0", "93 581,33"],
    ["espace fine insécable U+202F", "93 581,33"],
  ])("accepte « %s » et enregistre 93581.33", async (_nom, saisie) => {
    const date = `2026-0${1 + ["93 581,33", "93 581,33", "93 581,33"].indexOf(saisie)}-01`;
    const etat = await ajouterUneVersion({}, formulaire(date, saisie));

    expect(etat.erreur).toBeUndefined();
    const v = (await versions()).find((x) => x.dateEffet.toISOString().startsWith(date))!;
    expect(v.formules.find((f) => f.code === "SOLO")!.primeUnitaire.toFixed()).toBe("93581.33");
    expect(v.seuilValidationTtc).toBeNull();
  });

  it.each(["1.234,5", "1,234.5", "1,2,3", "abc"])("refuse « %s » avec un message en français, sans erreur 500 ni enregistrement partiel", async (saisie) => {
    const avant = (await versions()).length;
    const etat = await ajouterUneVersion({}, formulaire("2026-06-01", saisie));

    expect(etat.erreur).toMatch(/[a-zé]/); // message lisible, renvoyé au formulaire (pas d'exception)
    expect(`${etat.erreur} ${(etat.details ?? []).join(" ")}`).toMatch(/prime/i);
    expect((await versions()).length).toBe(avant);
  });
});
