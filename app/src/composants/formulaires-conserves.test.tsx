// Morceaux de la refonte d'ergonomie conservés (D56) : les formulaires changent d'aspect et masquent des champs, mais les NOMS des champs
// envoyés (ceux de l'action et du dictionnaire) restent ceux d'avant, et un champ masqué n'envoie jamais une valeur contradictoire.
// Rendu statique côté serveur (sans navigateur), comme ui.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { lireCotation } from "@/app/(protege)/cotations/lire-cotation";
import { CHAMPS_TEXTE_COMPLEMENTS, type Souscripteur } from "@/domaine/cotation/saisie";
import { REGLES, TYPES_MODELE } from "@/domaine/documents/modeles";

import { ChampsSouscripteurDynamiques } from "./ChampsSouscripteurDynamiques";
import { ComplementsSouscripteur } from "./ComplementsSouscripteur";
import { FormulaireCreationModele } from "./FormulaireCreationModele";
import { SectionsAnnexesCotation } from "./SectionsAnnexesCotation";
import { SelectionIntermediaires } from "./SelectionIntermediaires";

const rendre = (e: React.ReactElement) => renderToStaticMarkup(e);

type Entree = { nom: string; type: string; valeur: string };

/** Les champs envoyés (input, select, textarea portant un name) d'un rendu : nom, type, valeur affichée. */
function champsEnvoyes(html: string): Entree[] {
  const entrees: Entree[] = [];
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const nom = /\bname="([^"]*)"/.exec(m[1])?.[1];
    if (!nom) continue;
    // Valeur d'une liste : l'option choisie, à défaut la première.
    const options = [...m[2].matchAll(/<option\b([^>]*)>/g)].map((o) => o[1]);
    const choisie = options.find((o) => /\bselected\b/.test(o)) ?? options[0] ?? "";
    entrees.push({ nom, type: "select", valeur: /\bvalue="([^"]*)"/.exec(choisie)?.[1] ?? "" });
  }
  for (const m of html.matchAll(/<(input|textarea)\b([^>]*)>/g)) {
    const nom = /\bname="([^"]*)"/.exec(m[2])?.[1];
    if (!nom) continue;
    entrees.push({ nom, type: m[1] === "input" ? (/\btype="([^"]*)"/.exec(m[2])?.[1] ?? "text") : m[1], valeur: /\bvalue="([^"]*)"/.exec(m[2])?.[1] ?? "" });
  }
  return entrees;
}
const noms = (html: string) => new Set(champsEnvoyes(html).map((c) => c.nom));
const valeurDe = (html: string, nom: string) => champsEnvoyes(html).filter((c) => c.nom === nom).map((c) => c.valeur);

/** Les noms du formulaire d'avant la refonte : type, nom, prénoms, raison sociale, téléphone, e-mail, adresse + compléments (dictionnaire §6.3.2). */
const NOMS_AVANT = new Set([
  "souscripteur_type",
  "souscripteur_nom",
  "souscripteur_prenoms",
  "souscripteur_raison_sociale",
  "souscripteur_telephone",
  "souscripteur_email",
  "souscripteur_adresse",
  ...noms(rendre(<ComplementsSouscripteur />)),
]);

const physique: Souscripteur = { type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa", raison_sociale: "", telephone: "07", email: "", adresse: "Abidjan", activite: "Commerce" };
const morale: Souscripteur = { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE", telephone: "27", email: "", adresse: "Plateau" };

describe("souscripteur : mêmes noms de champs qu'avant, physique comme morale", () => {
  it("les compléments d'avant couvrent tout le dictionnaire (garde-fou du test)", () => {
    for (const c of CHAMPS_TEXTE_COMPLEMENTS) expect(NOMS_AVANT.has(`souscripteur_${c}`)).toBe(true);
  });

  it("personne physique et personne morale envoient exactement les mêmes noms qu'avant, sans doublon", () => {
    for (const s of [physique, morale]) {
      const html = rendre(<ChampsSouscripteurDynamiques valeurs={s} />);
      const liste = champsEnvoyes(html).map((c) => c.nom);
      expect(new Set(liste)).toEqual(NOMS_AVANT);
      expect(liste.length).toBe(NOMS_AVANT.size);
    }
  });

  it("un champ masqué n'envoie qu'une valeur vide : raison sociale pour une personne physique, identité pour une personne morale", () => {
    const p = rendre(<ChampsSouscripteurDynamiques valeurs={physique} />);
    expect(valeurDe(p, "souscripteur_type")).toEqual(["PHYSIQUE"]);
    expect(valeurDe(p, "souscripteur_raison_sociale")).toEqual([""]);
    expect(valeurDe(p, "souscripteur_nom")).toEqual(["KOUADIO"]);
    // L'activité reste saisissable pour une personne physique (elle l'était avant) et garde sa valeur.
    expect(valeurDe(p, "souscripteur_activite")).toEqual(["Commerce"]);

    const m = rendre(<ChampsSouscripteurDynamiques valeurs={morale} />);
    expect(valeurDe(m, "souscripteur_type")).toEqual(["MORALE"]);
    expect(valeurDe(m, "souscripteur_raison_sociale")).toEqual(["ENTREPRISE INVENTÉE"]);
    for (const n of ["nom", "prenoms", "date_naissance", "lieu_naissance", "profession", "employeur", "situation_matrimoniale", "nb_enfants", "groupe_sanguin"]) {
      expect(valeurDe(m, `souscripteur_${n}`), n).toEqual([""]);
    }
  });

  it("un client enregistré choisi : mêmes noms, valeurs du client, clientId envoyé", () => {
    const client = { id: 7, souscripteur: { ...physique, nom: "DU CLIENT", date_naissance: "1990-02-03" as const } };
    const html = rendre(<ChampsSouscripteurDynamiques clients={[client]} initialClientId="7" valeurs={morale} />);
    expect(new Set([...noms(html)].filter((n) => n !== "clientId"))).toEqual(NOMS_AVANT);
    expect(valeurDe(html, "clientId")).toEqual(["7"]);
    expect(valeurDe(html, "souscripteur_nom")).toEqual(["DU CLIENT"]);
    expect(valeurDe(html, "souscripteur_type")).toEqual(["PHYSIQUE"]);
    expect(valeurDe(html, "souscripteur_raison_sociale")).toEqual([""]);
    expect(valeurDe(html, "souscripteur_date_naissance")).toEqual(["1990-02-03"]);
  });

  it("le formulaire envoie ce que lireCotation lit : une personne morale devient un souscripteur MORALE complet", () => {
    const html = rendre(<ChampsSouscripteurDynamiques valeurs={morale} />);
    const d = new FormData();
    for (const c of champsEnvoyes(html)) d.append(c.nom, c.valeur);
    d.set("codeProduit", "X");
    const s = lireCotation(d).souscripteur;
    expect(s).toMatchObject({ type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE", telephone: "27", adresse: "Plateau" });
  });
});

describe("intermédiaires : le bouton de création suit le droit de paramétrage (H79)", () => {
  const choix = [{ code: "BENI-01", nom: "Courtier inventé", role: "Courtier" }];

  it("sans le droit : deux listes « intermediaire », ni bouton ni panneau de création", () => {
    const html = rendre(<SelectionIntermediaires initialChoix={choix} />);
    expect(champsEnvoyes(html).filter((c) => c.nom === "intermediaire")).toHaveLength(2);
    expect(html).not.toContain("Nouvel intermédiaire");
  });

  it("avec le droit : le bouton est proposé", () => {
    expect(rendre(<SelectionIntermediaires initialChoix={choix} creer={async () => ({ succes: false, erreur: "x" })} />)).toContain("Nouvel intermédiaire");
  });
});

describe("création d'un modèle : les types viennent des règles du domaine, les champs envoyés sont ceux de l'action", () => {
  const produits = [{ code: "P1", libelle: "Produit un", branchePrincipale: "MALADIE", branchePrincipaleLibelle: "Maladie" }];
  const branches = [{ code: "MALADIE", libelle: "Maladie" }];
  const action = async () => ({});

  it("tous les types de modèle sont proposés, et eux seuls", () => {
    const html = rendre(<FormulaireCreationModele action={action} produits={produits} branches={branches} />);
    const proposes = [...html.matchAll(/<option value="([A-Z_]+)">/g)].map((m) => m[1]).filter((v) => (TYPES_MODELE as readonly string[]).includes(v));
    expect([...proposes].sort()).toEqual([...TYPES_MODELE].sort());
    for (const t of TYPES_MODELE) expect(html).toContain(REGLES[t].libelle.replace(/'/g, "&#x27;"));
  });

  it("avant le choix du type : type, code, libellé et produit seulement (les champs propres à un type sont absents, donc non envoyés)", () => {
    const n = noms(rendre(<FormulaireCreationModele action={action} produits={produits} branches={branches} />));
    expect(n).toEqual(new Set(["type", "code", "libelle", "produitCode"]));
  });
});

describe("volets de la cotation : replier ne retire rien de l'envoi", () => {
  it("les quatre rubriques sont montées même repliées (contenu dans un conteneur hidden), jamais démontées", () => {
    const html = rendre(<SectionsAnnexesCotation formules={[]} parGaranties={false} estBareme={false} initialAssures={[]} initialBeneficiaires={[]} initialContactsUrgence={[]} initialRisque={[]} />);
    expect(html.match(/ hidden=""/g)?.length).toBe(4);
    expect(html).toContain("Risque (champs propres au produit)");
  });

  it("une rubrique qui contient déjà des lignes est ouverte d'emblée", () => {
    const html = rendre(
      <SectionsAnnexesCotation
        formules={[]}
        parGaranties={false}
        estBareme
        initialAssures={[]}
        initialBeneficiaires={[{ nom: "B", lien: "Enfant", contact: "", quote: "100" }]}
        initialContactsUrgence={[]}
        initialRisque={[]}
      />,
    );
    expect(html.match(/ hidden=""/g)?.length).toBe(3);
  });
});
