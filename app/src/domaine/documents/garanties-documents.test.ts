import { describe, expect, it } from "vitest";

import { baremeSecurpro } from "../bareme/securpro-fixture";
import { garantiesExempleDuBareme } from "../bareme/documents";
import type { Analyse, Emplacement } from "./analyse";
import { avertissementsDeGaranties, CLE_BLOC_DE_GARANTIE, controlerDepot } from "./controles";
import { CHAMPS, CHAMPS_FACULTATIFS, champsInconnus, donneesExemple, estConnu } from "./dictionnaire";

const ici = (paragraphe = 1): Emplacement => ({ partie: "corps", paragraphe, tableau: null, ligne: null, colonne: null, extrait: "" });
const refs = (chemins: string[]) => chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici() }));

function analyse(surcharge: Partial<Analyse> = {}): Analyse {
  return { docx_valide: true, erreur: null, nombre_balises: 1, references: [], problemes: [], champs_word: [], blocs: [], filtres: [], polices: ["Tahoma"], polices_absentes: [], textes: [], ...surcharge };
}

describe("dictionnaire : code et composantes des garanties souscrites (D61)", () => {
  it("garanties_souscrites[].code et .composantes[] (code, libelle, montant_garanti, prime_nette) sont des noms connus", () => {
    for (const chemin of [
      "garanties_souscrites[].code",
      "garanties_souscrites[].composantes",
      "garanties_souscrites[].composantes[].code",
      "garanties_souscrites[].composantes[].libelle",
      "garanties_souscrites[].composantes[].montant_garanti",
      "garanties_souscrites[].composantes[].prime_nette",
    ]) {
      expect(estConnu(chemin), chemin).toBe(true);
    }
  });

  it("le code et la liste des composantes sont facultatifs (composition manuelle, cotation irreconstituable) ; les champs d'une composante, non", () => {
    expect(CHAMPS_FACULTATIFS).toContain("garanties_souscrites[].code");
    expect(CHAMPS_FACULTATIFS).toContain("garanties_souscrites[].composantes");
    expect(CHAMPS_FACULTATIFS).not.toContain("garanties_souscrites[].composantes[].prime_nette");
  });

  it("garantie.* est la copie exacte de garanties_souscrites[].* (mêmes types, mêmes champs facultatifs)", () => {
    const source = CHAMPS.filter((c) => c.chemin.startsWith("garanties_souscrites[].")).map((c) => [c.chemin.replace("garanties_souscrites[].", ""), c.type, c.facultatif ?? false]);
    const miroir = CHAMPS.filter((c) => c.chemin.startsWith("garantie.")).map((c) => [c.chemin.replace("garantie.", ""), c.type, c.facultatif ?? false]);
    expect(miroir).toEqual(source);
    expect(estConnu("garantie.libelle")).toBe(true);
    expect(estConnu("garantie.composantes[].prime_nette")).toBe(true);
  });

  it("les données d'exemple couvrent le dictionnaire : deux garanties à deux composantes, et la garantie courante, sans nom inventé", () => {
    const d = donneesExemple() as { garanties_souscrites: { code: string; composantes: { code: string; prime_nette: string }[] }[]; garantie: { libelle: string; composantes: unknown[] } };
    expect(d.garanties_souscrites).toHaveLength(2);
    expect(d.garanties_souscrites[0].composantes).toHaveLength(2);
    expect(d.garanties_souscrites[0].composantes[0].prime_nette).toBe("5000");
    expect(d.garantie.libelle).toBe("Incendie");
    expect(d.garantie.composantes).toHaveLength(2);
    expect(champsInconnus(d)).toEqual([]);
  });

  it("l'exemple d'un produit au barème : une ligne par garantie du barème, avec son vrai code et ses vraies composantes", () => {
    const lignes = garantiesExempleDuBareme(baremeSecurpro()) as { code: string; libelle: string; composantes: { code: string; libelle: string }[] }[];
    expect(lignes.map((l) => l.code)).toEqual(["incendie", "vol", "dde", "de", "bdg", "tempete", "tri"]);
    expect(lignes[1].composantes.map((c) => [c.code, c.libelle])).toEqual([["contenu", "Contenu"], ["caisse", "Caisse"]]);
    expect(champsInconnus({ garanties_souscrites: lignes })).toEqual([]);
  });
});

describe("contrôles au dépôt : garantie.* n'existe que dans un sous-modèle « garanties »", () => {
  const modele = (chemins: string[]) => analyse({ references: refs(chemins) });

  it("accepté dans un sous-modèle de nom « garanties » (ou de nom inconnu, hors dépôt)", () => {
    expect(controlerDepot("SOUS_MODELE", modele(["garantie.libelle", "garantie.composantes"]), { blocNom: "garanties" }).rejets).toEqual([]);
    expect(controlerDepot("SOUS_MODELE", modele(["garantie.libelle"])).rejets).toEqual([]);
  });

  it("refusé dans une CP, et dans un sous-modèle d'un autre nom, avec la balise", () => {
    const cp = controlerDepot("CP", modele(["police.numero", "garantie.libelle"])).rejets.map((r) => r.message);
    expect(cp.some((m) => m.includes("« garantie.libelle »") && m.includes("sous-modèle de nom « garanties »"))).toBe(true);
    expect(controlerDepot("SOUS_MODELE", modele(["garantie.libelle"]), { blocNom: "formules" }).rejets).toHaveLength(1);
  });

  it("le sous-modèle ne peut pas appeler bloc() à son tour (inchangé)", () => {
    const r = controlerDepot("SOUS_MODELE", analyse({ blocs: [{ nom: "garanties", cle: CLE_BLOC_DE_GARANTIE, emplacement: ici() }] }), { blocNom: "garanties" });
    expect(r.rejets.map((x) => x.message)).toEqual(["Un sous-modèle ne peut pas appeler bloc() à son tour."]);
  });
});

describe("avertissementsDeGaranties : clés du barème sans sous-modèle publié", () => {
  const appel = analyse({ blocs: [{ nom: "garanties", cle: CLE_BLOC_DE_GARANTIE, emplacement: ici(4) }] });
  const codes = new Set(["incendie", "vol", "dde"]);

  it("une CP qui appelle bloc(\"garanties\", g.code) : chaque garantie du barème sans sous-modèle publié est nommée, avec la clé attendue", () => {
    const a = avertissementsDeGaranties("CP", appel, codes, new Set(["incendie"]));
    expect(a).toHaveLength(2);
    expect(a[0].message).toContain("« dde »");
    expect(a[0].message).toContain("clé : dde");
    expect(a[1].message).toContain("« vol »");
    expect(avertissementsDeGaranties("CP", appel, codes, codes)).toEqual([]);
  });

  it("aucun avertissement sans appel du bloc de garanties, ni pour un produit sans barème", () => {
    expect(avertissementsDeGaranties("CP", analyse(), codes, new Set())).toEqual([]);
    expect(avertissementsDeGaranties("CP", appel, new Set(), new Set())).toEqual([]);
    // Un ancien bloc par formule (clé formules[].code) n'est pas concerné.
    expect(avertissementsDeGaranties("CP", analyse({ blocs: [{ nom: "garanties", cle: "formules[].code", emplacement: ici() }] }), codes, new Set())).toEqual([]);
  });

  it("un sous-modèle « garanties » dont la clé n'est pas une garantie du barème est signalé ; une clé connue, non", () => {
    expect(avertissementsDeGaranties("SOUS_MODELE", analyse(), codes, new Set(), { blocNom: "garanties", blocCle: "inconnue" })[0].message).toContain("« inconnue »");
    expect(avertissementsDeGaranties("SOUS_MODELE", analyse(), codes, new Set(), { blocNom: "garanties", blocCle: "vol" })).toEqual([]);
    expect(avertissementsDeGaranties("SOUS_MODELE", analyse(), codes, new Set(), { blocNom: "formules", blocCle: "SOLO" })).toEqual([]);
  });
});
