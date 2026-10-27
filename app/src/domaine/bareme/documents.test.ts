// Balises risque.<code> d'un produit au barème (B6b, D52). Barème et saisies inventés (securpro-fixture).
import { describe, expect, it } from "vitest";

import { avertissementsRisque } from "../documents/controles";
import { champsRisqueFacultatifs } from "../documents/dictionnaire";
import type { Analyse } from "../documents/analyse";
import { codesRisqueDuBareme, risqueDuBareme } from "./documents";
import { lireBareme, type Saisie } from "./schema";
import { documentSecurpro } from "./securpro-fixture";

const bareme = lireBareme(documentSecurpro);
const locataire = documentSecurpro.jeuxEssai[0].entrees as unknown as Saisie; // Électronique, locataire, boutique
const proprietaire = documentSecurpro.jeuxEssai[1].entrees as unknown as Saisie; // Bureau, propriétaire

describe("risqueDuBareme : un champ du barème = une balise risque.<code>", () => {
  it("toutes les balises existent, valeur saisie pour un champ applicable", () => {
    const r = risqueDuBareme(bareme, locataire);
    expect(Object.keys(r).sort()).toEqual(codesRisqueDuBareme(bareme).sort());
    expect(r).toMatchObject({ type_commerce: "ELECTRONIQUE", occupation: "LOCATAIRE", situation: "BOUTIQUE", gardien: "OUI", extincteurs: "NON", loyer_mensuel: "150000", stocks: "6866500", dde_montant: "2000000" });
  });

  it("un champ qui ne s'applique pas (condition d'affichage) ou facultatif laissé vide vaut « » : la balise existe, vide", () => {
    const r = risqueDuBareme(bareme, locataire);
    expect(r.valeur_batiment).toBe(""); // propriétaire seulement
    expect(r.tempete_montant).toBe(""); // garantie non souscrite : champ non saisi
    expect(risqueDuBareme(bareme, proprietaire).loyer_mensuel).toBe("");
  });

  it("une valeur saisie pour un champ devenu inapplicable est ignorée (jamais un résidu de saisie)", () => {
    const residu: Saisie = { ...locataire, champs: { ...locataire.champs, valeur_batiment: "99999999" } };
    expect(risqueDuBareme(bareme, residu).valeur_batiment).toBe("");
  });
});

describe("champsRisqueFacultatifs : les balises vides s'écrivent vides", () => {
  it("seuls les champs risque vides sont facultatifs ; aucune donnée risque : liste vide", () => {
    expect(champsRisqueFacultatifs({ risque: { a: "x", b: "", c: "" } })).toEqual(["risque.b", "risque.c"]);
    expect(champsRisqueFacultatifs({})).toEqual([]);
    expect(champsRisqueFacultatifs({ risque: null })).toEqual([]);
  });
});

describe("avertissementsRisque : contrôle des modèles à l'enregistrement", () => {
  const ici = { partie: "corps", paragraphe: 3, tableau: null, ligne: null, colonne: null, extrait: "" };
  const analyse = (chemins: string[]): Analyse =>
    ({ docx_valide: true, erreur: null, nombre_balises: chemins.length, references: chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici })), problemes: [], champs_word: [], blocs: [], filtres: [], polices: [], polices_absentes: [], textes: [] }) as unknown as Analyse;
  const codes = new Set(codesRisqueDuBareme(bareme));

  it("une balise risque.<code> inconnue du barème est signalée, une connue non, les autres champs ne sont pas concernés", () => {
    const a = avertissementsRisque(analyse(["risque.type_commerce", "risque.typo_commerce", "risque.typo_commerce", "police.numero"]), codes);
    expect(a).toHaveLength(1);
    expect(a[0].message).toContain("risque.typo_commerce");
    expect(a[0].message).toContain("type_commerce");
    expect(avertissementsRisque(analyse(["risque.loyer_mensuel", "prime.ttc"]), codes)).toEqual([]);
  });
});
