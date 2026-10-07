// Tests d'intégration : vraie base de test (npm run test:integration).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lireJournal } from "./audit";
import { initialiserProfilsEtDroits } from "./droits";
import { verifierMotDePasse } from "./mot-de-passe";
import { obtenirPrisma } from "./prisma";
import { COMPTES_SEED_DEV, executerSeedDev } from "./seed-dev";
import { creerAdministrateurInitial } from "./utilisateurs";

// Mot de passe inventé, propre aux tests.
const MOT_DE_PASSE = "Rx7-cobalt-lune-42";
const identifiants = COMPTES_SEED_DEV.map((c) => c.identifiant);
const comptes = () => obtenirPrisma().utilisateur.findMany({ where: { identifiant: { in: identifiants } }, include: { profil: true }, orderBy: { identifiant: "asc" } });

beforeAll(async () => {
  await initialiserProfilsEtDroits();
  // La base de test est recréée à chaque npm run test:integration : aucun compte du seed au départ.
  expect(await obtenirPrisma().utilisateur.count({ where: { identifiant: { in: identifiants } } })).toBe(0);
});

afterAll(async () => {
  await obtenirPrisma().$disconnect();
});

describe("seed de développement (base réelle)", () => {
  it("crée les 6 comptes, sans changement de mot de passe imposé, et l'écrit au journal", async () => {
    const r = await executerSeedDev(MOT_DE_PASSE);
    expect(r.crees.sort()).toEqual([...identifiants].sort());
    expect(r.ignores).toEqual([]);
    const lus = await comptes();
    expect(lus.map((u) => [u.identifiant, u.profil.code, u.doitChangerMotDePasse, u.actif])).toEqual(
      COMPTES_SEED_DEV.map((c) => [c.identifiant, c.profil, false, true]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    for (const u of lus) expect(await verifierMotDePasse(MOT_DE_PASSE, u.motDePasseHash)).toBe(true);
    const objets = new Set(lus.map((u) => `utilisateur ${u.id}`));
    const journal = (await lireJournal({ action: "UTILISATEUR_CREE" })).lignes.filter((l) => l.objet !== null && objets.has(l.objet));
    expect(journal).toHaveLength(6);
    expect(journal.every((l) => (l.apres as { origine?: string }).origine === "compte créé par le seed de développement" && l.utilisateur === null)).toBe(true);
  });

  it("second lancement : rien de dupliqué ni d'écrasé ; un compte hors liste reste intact", async () => {
    const prisma = obtenirPrisma();
    // Un compte de test modifié depuis (autre mot de passe, autre nom) ne doit pas être remis à zéro.
    await prisma.utilisateur.update({ where: { identifiant: "test.commercial" }, data: { nom: "Renommé en recette", doitChangerMotDePasse: true } });
    const admin = await creerAdministrateurInitial({ identifiant: `vrai-admin-${Date.now()}`, nom: "Admin réel", motDePasse: "Kq9-horizon-sable-77" });
    const avant = await prisma.utilisateur.findUniqueOrThrow({ where: { id: admin } });
    const commercialAvant = await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: "test.commercial" } });

    const r = await executerSeedDev("Autre-mot-de-passe-91");
    expect(r.crees).toEqual([]);
    expect(r.ignores.sort()).toEqual([...identifiants].sort());
    expect(await prisma.utilisateur.count({ where: { identifiant: { in: identifiants } } })).toBe(6);
    expect(await prisma.utilisateur.findUniqueOrThrow({ where: { identifiant: "test.commercial" } })).toEqual(commercialAvant);
    expect(await prisma.utilisateur.findUniqueOrThrow({ where: { id: admin } })).toEqual(avant);
  });
});
