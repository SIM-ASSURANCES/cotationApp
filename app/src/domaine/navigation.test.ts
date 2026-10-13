import { describe, expect, it } from "vitest";

import { PROFILS, droitsParDefaut, peutLire, type CodeNiveau } from "./droits";
import {
  ACTIONS_DE_NAVIGATION,
  brancheContientChemin,
  construireNavigation,
  lienEstActif,
  titreDeLaPage,
  type Navigation,
  type NiveauxNavigation,
} from "./navigation";

type ActionNavigation = (typeof ACTIONS_DE_NAVIGATION)[number];

/**
 * RÉFÉRENCE : la logique d'affichage du lien de l'ancien bandeau, telle qu'elle était dans
 * app/src/app/(protege)/layout.tsx au commit 63512ec (avant la refonte visuelle V1), réécrite en fonction pure qui rend la
 * liste plate des href dans l'ordre d'origine. Elle est volontairement recopiée sans être factorisée avec
 * `construireNavigation` : le test compare deux écritures indépendantes de la même règle.
 */
function hrefsAncienLayout(niveaux: NiveauxNavigation): string[] {
  const hrefs = ["/"];

  const parametrage = niveaux.PARAMETRER_PRODUITS;
  const cotation = niveaux.CREER_COTATION;
  const depotModele = niveaux.DEPOSER_MODELE;
  const publicationModele = niveaux.PUBLIER_MODELE;

  if (peutLire(cotation)) hrefs.push("/cotations");
  if (peutLire(depotModele) || peutLire(publicationModele)) hrefs.push("/modeles");
  const lectureDocuments = (["CREER_COTATION", "EMETTRE_CONTRAT", "EMETTRE_FACTURE", "EMETTRE_AVOIR", "ENREGISTRER_PAIEMENT"] as const).map((action) => niveaux[action]);
  if (lectureDocuments.slice(2).some(peutLire)) hrefs.push("/factures");
  if (peutLire(lectureDocuments[2])) hrefs.push("/echeances");
  if (lectureDocuments.some(peutLire)) hrefs.push("/documents");
  if (peutLire(lectureDocuments[1])) hrefs.push("/imports");
  if (peutLire(parametrage)) {
    hrefs.push("/parametrage/produits", "/parametrage/branches", "/parametrage/intermediaires", "/parametrage/taxes", "/parametrage/societe");
  }
  if (peutLire(parametrage) || peutLire(cotation)) hrefs.push("/calcul");
  if (niveaux.GERER_UTILISATEURS === "OUI") hrefs.push("/admin/utilisateurs", "/admin/droits", "/admin/stockage");
  if (peutLire(niveaux.CONSULTER_AUDIT)) hrefs.push("/admin/audit");
  return hrefs;
}

/** Tous les href de la navigation : « Accueil » puis les liens de chaque branche, dans l'ordre du menu. */
function hrefsDeLaNavigation(navigation: Navigation): string[] {
  return [navigation.accueil.href, ...navigation.branches.flatMap((b) => b.groupes.flatMap((g) => g.liens.map((l) => l.href)))];
}

const trie = (hrefs: string[]): string[] => [...hrefs].sort();

function niveauxVides(niveau: CodeNiveau = "AUCUN"): NiveauxNavigation {
  return Object.fromEntries(ACTIONS_DE_NAVIGATION.map((action) => [action, niveau])) as NiveauxNavigation;
}

function niveauxDuProfil(profil: (typeof PROFILS)[number]["code"]): NiveauxNavigation {
  const matrice = droitsParDefaut()[profil];
  return Object.fromEntries(ACTIONS_DE_NAVIGATION.map((action) => [action, matrice[action]])) as NiveauxNavigation;
}

describe("navigation : mêmes liens que l'ancien bandeau, profil par défaut par profil par défaut", () => {
  for (const profil of PROFILS) {
    it(`${profil.libelle}`, () => {
      const niveaux = niveauxDuProfil(profil.code);
      const attendus = hrefsAncienLayout(niveaux);
      const obtenus = hrefsDeLaNavigation(construireNavigation(niveaux));
      expect(new Set(obtenus).size, "aucun doublon").toBe(obtenus.length);
      expect(trie(obtenus)).toEqual(trie(attendus));
    });
  }

  it("quelques profils en clair (garde-fou contre une référence qui se tromperait comme l'implémentation)", () => {
    const hrefs = (code: (typeof PROFILS)[number]["code"]) => hrefsDeLaNavigation(construireNavigation(niveauxDuProfil(code)));
    // Commercial : cotations seulement (CDC §4), donc pas de facturation ni de paramétrage.
    expect(trie(hrefs("COMMERCIAL"))).toEqual(trie(["/", "/cotations", "/calcul", "/documents"]));
    // Admin système : administration et journal d'audit, aucun écran métier.
    expect(trie(hrefs("ADMIN_SYSTEME"))).toEqual(trie(["/", "/admin/utilisateurs", "/admin/droits", "/admin/stockage", "/admin/audit"]));
    // Comptabilité : facturation et tableaux de bord, paramétrage en lecture (D21).
    expect(hrefs("COMPTABILITE")).toEqual(expect.arrayContaining(["/factures", "/echeances", "/parametrage/taxes", "/calcul"]));
    expect(hrefs("COMPTABILITE")).not.toContain("/admin/utilisateurs");
  });
});

describe("navigation : toutes les combinaisons de niveaux utiles", () => {
  // Les conditions ne regardent que « peut lire » (AUCUN ou non), sauf GERER_UTILISATEURS qui exige exactement « OUI » :
  // trois états pour lui (AUCUN, un niveau lisible autre que OUI, OUI), deux pour chacun des dix autres droits.
  const autres = ACTIONS_DE_NAVIGATION.filter((action): action is Exclude<ActionNavigation, "GERER_UTILISATEURS"> => action !== "GERER_UTILISATEURS");
  const ETATS_GESTION: CodeNiveau[] = ["AUCUN", "LECTURE", "OUI"];

  it("compare l'ancienne logique et construireNavigation sur chaque combinaison", () => {
    expect(autres).toHaveLength(10);
    const total = 2 ** autres.length * ETATS_GESTION.length;
    let comparees = 0;
    for (let masque = 0; masque < 2 ** autres.length; masque++) {
      for (const gestion of ETATS_GESTION) {
        const niveaux = niveauxVides();
        autres.forEach((action, i) => {
          niveaux[action] = masque & (1 << i) ? "LECTURE" : "AUCUN";
        });
        niveaux.GERER_UTILISATEURS = gestion;

        const attendus = trie(hrefsAncienLayout(niveaux));
        const obtenus = hrefsDeLaNavigation(construireNavigation(niveaux));
        // Message construit seulement en cas d'échec : 3 072 combinaisons ne doivent pas coûter 3 072 chaînes.
        if (new Set(obtenus).size !== obtenus.length || JSON.stringify(trie(obtenus)) !== JSON.stringify(attendus)) {
          expect(trie(obtenus), `masque ${masque.toString(2)}, GERER_UTILISATEURS=${gestion}`).toEqual(attendus);
          expect(new Set(obtenus).size, "aucun doublon").toBe(obtenus.length);
        }
        comparees++;
      }
    }
    expect(comparees).toBe(total);
  });

  it("le niveau lisible n'importe pas, sauf pour GERER_UTILISATEURS qui exige « Oui »", () => {
    for (const niveau of ["LECTURE", "DEMANDE", "OUI_SOUS_SEUIL", "OUI", "VALIDE"] as const) {
      const niveaux = niveauxVides(niveau);
      niveaux.GERER_UTILISATEURS = "AUCUN";
      expect(trie(hrefsDeLaNavigation(construireNavigation(niveaux)))).toEqual(trie(hrefsAncienLayout(niveaux)));
    }
    for (const gestion of ["LECTURE", "DEMANDE", "OUI_SOUS_SEUIL", "VALIDE"] as const) {
      const niveaux = niveauxVides();
      niveaux.GERER_UTILISATEURS = gestion;
      expect(hrefsDeLaNavigation(construireNavigation(niveaux)), gestion).toEqual(["/"]);
    }
  });
});

describe("navigation : aucun droit", () => {
  it("« Accueil » seulement, aucune branche (l'utilisateur qui doit changer son mot de passe, lui, n'a pas de menu : voir le layout)", () => {
    const navigation = construireNavigation(niveauxVides("AUCUN"));
    expect(navigation.accueil).toEqual({ href: "/", libelle: "Accueil", icone: "maison" });
    expect(navigation.branches).toEqual([]);
    expect(hrefsDeLaNavigation(navigation)).toEqual(hrefsAncienLayout(niveauxVides("AUCUN")));
  });
});

describe("navigation : branches", () => {
  it("toutes les branches, dans l'ordre Production, Facturation, Documents, Paramétrage, Administration, Journal d'audit", () => {
    const navigation = construireNavigation(niveauxVides("OUI"));
    expect(navigation.branches.map((b) => b.cle)).toEqual(["production", "facturation", "documents", "parametrage", "administration", "audit"]);
    expect(navigation.branches.map((b) => b.libelle)).toEqual(["Production", "Facturation", "Documents", "Paramétrage", "Administration", "Journal d'audit"]);
  });

  it("liens de chaque branche, dans l'ordre demandé", () => {
    const navigation = construireNavigation(niveauxVides("OUI"));
    const liensDe = (cle: string) => navigation.branches.find((b) => b.cle === cle)?.groupes.flatMap((g) => g.liens.map((l) => [l.libelle, l.href]));
    expect(liensDe("production")).toEqual([
      ["Cotations", "/cotations"],
      ["Calcul", "/calcul"],
      ["Imports", "/imports"],
      ["Échéances", "/echeances"],
    ]);
    expect(liensDe("facturation")).toEqual([["Factures", "/factures"]]);
    expect(liensDe("documents")).toEqual([
      ["Documents émis", "/documents"],
      ["Modèles Word", "/modeles"],
    ]);
    expect(liensDe("audit")).toEqual([["Journal d'audit", "/admin/audit"]]);
    expect(liensDe("parametrage")).toEqual([
      ["Produits", "/parametrage/produits"],
      ["Branches", "/parametrage/branches"],
      ["Taxes", "/parametrage/taxes"],
      ["Intermédiaires", "/parametrage/intermediaires"],
      ["Société", "/parametrage/societe"],
    ]);
    expect(liensDe("administration")).toEqual([
      ["Utilisateurs", "/admin/utilisateurs"],
      ["Droits", "/admin/droits"],
      ["Stockage", "/admin/stockage"],
    ]);
  });

  it("une branche sans lien n'apparaît pas, un groupe n'est jamais vide", () => {
    const seulementModeles = construireNavigation({ ...niveauxVides(), DEPOSER_MODELE: "OUI" });
    expect(seulementModeles.branches.map((b) => b.cle)).toEqual(["documents"]);
    expect(hrefsDeLaNavigation(seulementModeles)).toEqual(["/", "/modeles"]);

    const aucun = construireNavigation(niveauxVides());
    expect(aucun.branches).toEqual([]);

    for (const branche of construireNavigation(niveauxVides("OUI")).branches) {
      expect(branche.groupes.length, branche.cle).toBeGreaterThan(0);
      for (const groupe of branche.groupes) expect(groupe.liens.length, branche.cle).toBeGreaterThan(0);
    }
  });

  it("chaque branche et chaque lien portent une icône", () => {
    const navigation = construireNavigation(niveauxVides("OUI"));
    expect(navigation.accueil.icone).toBeTruthy();
    for (const branche of navigation.branches) {
      expect(branche.icone, branche.cle).toBeTruthy();
      for (const lien of branche.groupes.flatMap((g) => g.liens)) expect(lien.icone, lien.href).toBeTruthy();
    }
  });

  it("aucune adresse « /clients » (il n'y en avait pas dans l'ancien bandeau)", () => {
    expect(hrefsDeLaNavigation(construireNavigation(niveauxVides("OUI")))).not.toContain("/clients");
  });
});

describe("lienEstActif", () => {
  it("« / » n'est actif que sur « / »", () => {
    expect(lienEstActif("/", "/")).toBe(true);
    expect(lienEstActif("/", "/cotations")).toBe(false);
    expect(lienEstActif("/", "/mon-compte")).toBe(false);
  });

  it("égalité, ou préfixe suivi de « / »", () => {
    expect(lienEstActif("/cotations", "/cotations")).toBe(true);
    expect(lienEstActif("/cotations", "/cotations/12")).toBe(true);
    expect(lienEstActif("/cotations", "/cotations/12/adherents")).toBe(true);
    expect(lienEstActif("/parametrage/produits", "/parametrage/produits/XYZ/relances")).toBe(true);
  });

  it("jamais un préfixe de mot", () => {
    expect(lienEstActif("/factures", "/factures-x")).toBe(false);
    expect(lienEstActif("/factures", "/facture")).toBe(false);
    expect(lienEstActif("/admin/audit", "/admin/auditeur")).toBe(false);
  });

  it("une page voisine d'un même dossier n'allume pas le lien", () => {
    expect(lienEstActif("/parametrage/produits", "/parametrage/taxes")).toBe(false);
    expect(lienEstActif("/admin/droits", "/admin/utilisateurs")).toBe(false);
  });
});

describe("brancheContientChemin", () => {
  const navigation = construireNavigation(niveauxVides("OUI"));
  const branche = (cle: string) => navigation.branches.find((b) => b.cle === cle)!;

  it("reconnaît la branche de la page affichée, sous-pages comprises", () => {
    expect(brancheContientChemin(branche("production"), "/cotations/12")).toBe(true);
    expect(brancheContientChemin(branche("production"), "/echeances/lots/7")).toBe(true);
    expect(brancheContientChemin(branche("parametrage"), "/parametrage/produits/XYZ/relances")).toBe(true);
    expect(brancheContientChemin(branche("audit"), "/admin/audit")).toBe(true);
    expect(brancheContientChemin(branche("administration"), "/admin/audit")).toBe(false);
  });

  it("aucune branche ne contient l'accueil ni une page hors menu", () => {
    for (const b of navigation.branches) {
      expect(brancheContientChemin(b, "/"), b.cle).toBe(false);
      expect(brancheContientChemin(b, "/mon-compte"), b.cle).toBe(false);
    }
  });
});

describe("titreDeLaPage", () => {
  const navigation = construireNavigation(niveauxVides("OUI"));

  it("« / » : Accueil", () => {
    expect(titreDeLaPage(navigation, "/")).toBe("Accueil");
  });

  it("une sous-page prend le titre de son lien", () => {
    expect(titreDeLaPage(navigation, "/cotations")).toBe("Cotations");
    expect(titreDeLaPage(navigation, "/cotations/12")).toBe("Cotations");
    expect(titreDeLaPage(navigation, "/parametrage/produits/XYZ/relances")).toBe("Produits");
    expect(titreDeLaPage(navigation, "/echeances/lots/7")).toBe("Échéances");
    expect(titreDeLaPage(navigation, "/admin/audit")).toBe("Journal d'audit");
  });

  it("le lien le plus spécifique l'emporte", () => {
    const imbrique: Navigation = {
      accueil: navigation.accueil,
      branches: [
        {
          cle: "test",
          libelle: "Test",
          icone: "maison",
          groupes: [
            {
              liens: [
                { href: "/admin", libelle: "Administration générale", icone: "bouclier" },
                { href: "/admin/audit", libelle: "Journal d'audit", icone: "journal" },
              ],
            },
          ],
        },
      ],
    };
    expect(titreDeLaPage(imbrique, "/admin/audit/2026")).toBe("Journal d'audit");
    expect(titreDeLaPage(imbrique, "/admin/autre")).toBe("Administration générale");
  });

  it("« Mon compte » pour /mon-compte, même sans aucun droit", () => {
    expect(titreDeLaPage(navigation, "/mon-compte")).toBe("Mon compte");
    expect(titreDeLaPage(construireNavigation(niveauxVides("AUCUN")), "/mon-compte")).toBe("Mon compte");
  });

  it("« Clients » : page hors menu, qui a quand même son titre (elle n'est pas un lien du menu)", () => {
    expect(titreDeLaPage(navigation, "/clients")).toBe("Clients");
    expect(titreDeLaPage(navigation, "/clients/nouveau")).toBe("Clients");
  });

  it("repli « SIM Documents » : chemin inconnu, préfixe de mot, lien non autorisé", () => {
    expect(titreDeLaPage(navigation, "/inconnu")).toBe("SIM Documents");
    expect(titreDeLaPage(navigation, "/factures-x")).toBe("SIM Documents");
    expect(titreDeLaPage(construireNavigation(niveauxVides("AUCUN")), "/cotations")).toBe("SIM Documents");
  });
});
