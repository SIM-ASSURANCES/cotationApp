// Tests d'intégration : vraie base PostgreSQL de test (npm run test:integration).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { droitsParDefaut } from "@/domaine/droits";

import { journaliser, lireJournal } from "./audit";
import { enregistrerDroit, initialiserProfilsEtDroits, lireMatrice } from "./droits";
import { obtenirPrisma } from "./prisma";
import { ErreurAcces, ErreurMetier, type UtilisateurCourant } from "./types";
import {
  changerMotDePasse,
  creerAdministrateurInitial,
  creerUtilisateur,
  modifierUtilisateur,
  reinitialiserMotDePasse,
  verifierIdentifiants,
  versUtilisateurCourant,
} from "./utilisateurs";

// Données de test inventées. Chaque test utilise ses propres identifiants (le journal ne s'efface pas).
const MDP = "phrase-de-passe-inventee-2026";
const unique = (prefixe: string) => `${prefixe}-${Math.random().toString(36).slice(2, 8)}`;

async function acteurDepuisBase(identifiant: string): Promise<UtilisateurCourant> {
  const u = await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { identifiant }, include: { profil: true } });
  return versUtilisateurCourant(u);
}

async function nouvelAdmin(): Promise<UtilisateurCourant> {
  const identifiant = unique("admin");
  await creerAdministrateurInitial({ identifiant, nom: "Admin de test", motDePasse: MDP });
  return acteurDepuisBase(identifiant);
}

async function nouveauCompte(admin: UtilisateurCourant, profil: string): Promise<UtilisateurCourant> {
  const identifiant = unique(profil.toLowerCase().replace(/_/g, "-"));
  await creerUtilisateur(admin, { identifiant, nom: `Compte ${profil}`, profil, motDePasse: MDP }, null);
  return acteurDepuisBase(identifiant);
}

async function evenements(action: string, identifiant: string) {
  const { lignes } = await lireJournal({ action });
  return lignes.filter((l) => l.utilisateur === identifiant);
}

beforeAll(async () => {
  await initialiserProfilsEtDroits();
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("journal d'audit en ajout seul (déclencheur PostgreSQL)", () => {
  it("accepte l'ajout d'une ligne", async () => {
    const identifiant = unique("ajout");
    await journaliser({ acteur: { id: null, identifiant }, action: "DOCUMENT_EMIS", apres: { x: 1 } });

    expect(await evenements("DOCUMENT_EMIS", identifiant)).toHaveLength(1);
  });

  it("refuse UPDATE, DELETE et TRUNCATE, même en SQL direct", async () => {
    const prisma = obtenirPrisma();
    await expect(prisma.$executeRawUnsafe(`UPDATE journal_audit SET action = 'TRUQUE'`)).rejects.toThrow(/ajout seul/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM journal_audit`)).rejects.toThrow(/ajout seul/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE journal_audit`)).rejects.toThrow(/ajout seul/);
  });
});

describe("connexion : journal des identifiants inconnus (audit M4)", () => {
  it("un mot de passe tapé dans le champ identifiant n'est jamais écrit au journal ; un identifiant de forme normale l'est", async () => {
    const phrase = `ma phrase de passe inventee ${Math.random().toString(36).slice(2, 8)}`;
    expect(await verifierIdentifiants({ identifiant: phrase, motDePasse: "x" }, "10.0.0.9")).toBeNull();
    const inconnu = unique("inconnu");
    expect(await verifierIdentifiants({ identifiant: inconnu, motDePasse: "x" }, "10.0.0.9")).toBeNull();

    const { lignes } = await lireJournal({ action: "CONNEXION_ECHEC" });
    const saisies = lignes.map((l) => (l.apres as { identifiantSaisi?: string } | null)?.identifiantSaisi);
    expect(saisies).toContain(inconnu);
    expect(saisies.some((s) => s?.includes("phrase de passe"))).toBe(false);
    expect(saisies).toContain("(saisie qui n'a pas la forme d'un identifiant)");
  });
});

describe("connexion", () => {
  it("accepte le bon mot de passe, refuse le mauvais et journalise les deux", async () => {
    const admin = await nouvelAdmin();

    expect(await verifierIdentifiants({ identifiant: admin.identifiant, motDePasse: "mauvais-mot-de-passe" }, "10.0.0.1")).toBeNull();
    const connecte = await verifierIdentifiants({ identifiant: ` ${admin.identifiant.toUpperCase()} `, motDePasse: MDP }, "10.0.0.1");

    expect(connecte?.id).toBe(admin.id);
    expect(await evenements("CONNEXION_ECHEC", admin.identifiant)).toHaveLength(1);
    const reussies = await evenements("CONNEXION_REUSSIE", admin.identifiant);
    expect(reussies).toHaveLength(1);
    expect(reussies[0].adresseIp).toBe("10.0.0.1");
  });

  it("refuse un identifiant inconnu, sans le distinguer d'un mauvais mot de passe", async () => {
    expect(await verifierIdentifiants({ identifiant: unique("inconnu"), motDePasse: MDP }, null)).toBeNull();
  });

  it("verrouille le compte au 5e échec, y compris pour le bon mot de passe, puis le libère après 15 minutes", async () => {
    const admin = await nouvelAdmin();
    const maintenant = new Date();

    for (let i = 0; i < 5; i += 1) {
      expect(await verifierIdentifiants({ identifiant: admin.identifiant, motDePasse: `faux-${i}-xxxxxxxx` }, null, maintenant)).toBeNull();
    }
    expect(await evenements("COMPTE_VERROUILLE", admin.identifiant)).toHaveLength(1);

    expect(await verifierIdentifiants({ identifiant: admin.identifiant, motDePasse: MDP }, null, maintenant)).toBeNull();
    expect(await evenements("CONNEXION_REFUSEE_COMPTE_VERROUILLE", admin.identifiant)).toHaveLength(1);

    const plusTard = new Date(maintenant.getTime() + 16 * 60_000);
    expect((await verifierIdentifiants({ identifiant: admin.identifiant, motDePasse: MDP }, null, plusTard))?.id).toBe(admin.id);
  });

  it("refuse un compte désactivé même avec le bon mot de passe", async () => {
    const admin = await nouvelAdmin();
    const autreAdmin = await nouvelAdmin(); // il doit rester un Admin actif
    const commercial = await nouveauCompte(admin, "COMMERCIAL");
    await modifierUtilisateur(admin, commercial.id, { actif: false }, null);

    expect(await verifierIdentifiants({ identifiant: commercial.identifiant, motDePasse: MDP }, null)).toBeNull();
    expect(await evenements("CONNEXION_REFUSEE_COMPTE_INACTIF", commercial.identifiant)).toHaveLength(1);
    expect(autreAdmin.id).not.toBe(admin.id);
  });

  it("n'enregistre jamais de mot de passe ni d'empreinte dans le journal", async () => {
    const admin = await nouvelAdmin();
    await nouveauCompte(admin, "TECHNIQUE");

    const { lignes } = await lireJournal({});
    const tout = JSON.stringify(lignes);
    expect(tout).not.toContain(MDP);
    expect(tout).not.toContain("scrypt$");
  });
});

describe("droits et gestion des utilisateurs", () => {
  it("réserve la gestion des utilisateurs à l'Admin système", async () => {
    const admin = await nouvelAdmin();
    const technique = await nouveauCompte(admin, "TECHNIQUE");

    await expect(
      creerUtilisateur(technique, { identifiant: unique("x"), nom: "X", profil: "COMMERCIAL", motDePasse: MDP }, null),
    ).rejects.toBeInstanceOf(ErreurAcces);
    await expect(reinitialiserMotDePasse(technique, admin.id, MDP + "bis", null)).rejects.toBeInstanceOf(ErreurAcces);
  });

  it("refuse un mot de passe qui ne respecte pas la politique, et un identifiant en double", async () => {
    const admin = await nouvelAdmin();
    const identifiant = unique("dbl");

    await expect(
      creerUtilisateur(admin, { identifiant, nom: "A", profil: "COMMERCIAL", motDePasse: "court" }, null),
    ).rejects.toBeInstanceOf(ErreurMetier);
    await creerUtilisateur(admin, { identifiant, nom: "A", profil: "COMMERCIAL", motDePasse: MDP }, null);
    await expect(
      creerUtilisateur(admin, { identifiant, nom: "B", profil: "COMMERCIAL", motDePasse: MDP }, null),
    ).rejects.toThrow(/déjà utilisé/);
  });

  it("garde toujours un Admin actif et interdit de se désactiver soi-même", async () => {
    const admin = await nouvelAdmin();
    await expect(modifierUtilisateur(admin, admin.id, { actif: false }, null)).rejects.toBeInstanceOf(ErreurMetier);

    // Le seul Admin actif de la base de test ne peut pas passer à un autre profil non plus (si d'autres
    // Admins existent, ce test ne vérifie que la règle sur soi-même).
    const commercial = await nouveauCompte(admin, "COMMERCIAL");
    await expect(modifierUtilisateur(admin, commercial.id, { profil: "TECHNIQUE" }, null)).resolves.toBeUndefined();
    expect((await acteurDepuisBase(commercial.identifiant)).profil).toBe("TECHNIQUE");
  });

  it("modifie un droit, le journalise avec avant/après, et refuse de retirer la gestion à l'Admin système", async () => {
    const admin = await nouvelAdmin();
    try {
      expect(await enregistrerDroit(admin, { profil: "COMMERCIAL", action: "CREER_COTATION", niveau: "LECTURE" }, "10.0.0.2")).toBe(true);
      expect((await lireMatrice()).COMMERCIAL.CREER_COTATION).toBe("LECTURE");
      expect(await enregistrerDroit(admin, { profil: "COMMERCIAL", action: "CREER_COTATION", niveau: "LECTURE" }, null)).toBe(false);

      const [entree] = await evenements("DROIT_MODIFIE", admin.identifiant);
      expect(entree.avant).toEqual({ action: "CREER_COTATION", niveau: "OUI" });
      expect(entree.apres).toEqual({ action: "CREER_COTATION", niveau: "LECTURE" });

      await expect(
        enregistrerDroit(admin, { profil: "ADMIN_SYSTEME", action: "GERER_UTILISATEURS", niveau: "AUCUN" }, null),
      ).rejects.toBeInstanceOf(ErreurMetier);
      const commercial = await nouveauCompte(admin, "COMMERCIAL");
      await expect(
        enregistrerDroit(commercial, { profil: "COMMERCIAL", action: "FORCER_PRIME", niveau: "VALIDE" }, null),
      ).rejects.toBeInstanceOf(ErreurAcces);
    } finally {
      await enregistrerDroit(admin, { profil: "COMMERCIAL", action: "CREER_COTATION", niveau: "OUI" }, null);
    }
  });

  it("l'initialisation est idempotente et n'écrase pas un droit modifié", async () => {
    const admin = await nouvelAdmin();
    try {
      await enregistrerDroit(admin, { profil: "TECHNIQUE", action: "DEPOSER_MODELE", niveau: "LECTURE" }, null);
      const resultat = await initialiserProfilsEtDroits();

      expect(resultat).toEqual({ profilsCrees: 0, droitsCrees: 0 });
      expect((await lireMatrice()).TECHNIQUE.DEPOSER_MODELE).toBe("LECTURE");
    } finally {
      await enregistrerDroit(admin, { profil: "TECHNIQUE", action: "DEPOSER_MODELE", niveau: droitsParDefaut().TECHNIQUE.DEPOSER_MODELE }, null);
    }
  });
});

describe("mot de passe", () => {
  it("impose le changement après une création, puis l'ancien mot de passe ne marche plus", async () => {
    const admin = await nouvelAdmin();
    const compte = await nouveauCompte(admin, "COMPTABILITE");
    expect(compte.doitChangerMotDePasse).toBe(true);

    const nouveau = "autre-phrase-de-passe-2026";
    await changerMotDePasse(compte, MDP, nouveau, null);

    expect((await acteurDepuisBase(compte.identifiant)).doitChangerMotDePasse).toBe(false);
    expect(await verifierIdentifiants({ identifiant: compte.identifiant, motDePasse: MDP }, null)).toBeNull();
    expect(await verifierIdentifiants({ identifiant: compte.identifiant, motDePasse: nouveau }, null)).not.toBeNull();
  });

  it("refuse un mauvais mot de passe actuel, et le compte comme un échec de connexion", async () => {
    const admin = await nouvelAdmin();
    const compte = await nouveauCompte(admin, "COMPTABILITE");

    await expect(changerMotDePasse(compte, "pas-le-bon-mot-de-passe", "nouvelle-phrase-2026-x", null)).rejects.toThrow(/actuel est incorrect/);

    const enBase = await obtenirPrisma().utilisateur.findUniqueOrThrow({ where: { id: compte.id } });
    expect(enBase.echecsConsecutifs).toBe(1);
  });

  it("la réinitialisation par l'admin déverrouille le compte et impose un nouveau changement", async () => {
    const admin = await nouvelAdmin();
    const compte = await nouveauCompte(admin, "COMMERCIAL");
    for (let i = 0; i < 5; i += 1) {
      await verifierIdentifiants({ identifiant: compte.identifiant, motDePasse: `faux-${i}-xxxxxxxx` }, null);
    }

    await reinitialiserMotDePasse(admin, compte.id, "mot-provisoire-inventé-2026", null);

    const connecte = await verifierIdentifiants({ identifiant: compte.identifiant, motDePasse: "mot-provisoire-inventé-2026" }, null);
    expect(connecte?.doitChangerMotDePasse).toBe(true);
  });
});
