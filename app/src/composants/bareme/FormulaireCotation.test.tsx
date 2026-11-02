// Formulaire de cotation généré (D62) : les champs propres d'une garantie s'affichent juste sous sa case, accessibles au clavier et au
// lecteur d'écran. Rendu statique côté serveur (SECURPRO INVENTÉ) ; le geste (cocher / décocher) est vérifié au navigateur (script de recette).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { descripteurSaisie } from "@/domaine/bareme/formulaire";
import { baremeSecurpro } from "@/domaine/bareme/securpro-fixture";

import { FormulaireCotation } from "./FormulaireCotation";

const descripteur = descripteurSaisie(baremeSecurpro());
const rendre = (souscrit: string[]) => renderToStaticMarkup(<FormulaireCotation descripteur={descripteur} initiale={{ champs: {}, souscrit }} />);
const position = (html: string, morceau: string) => {
  const i = html.indexOf(morceau);
  expect(i, morceau).toBeGreaterThan(-1);
  return i;
};
const balise = (html: string, valeur: string) => html.match(new RegExp(`<input[^>]*value="${valeur.replace(".", "\\.")}"[^>]*>`))?.[0] ?? "";

describe("champs propres d'une garantie, sous sa case", () => {
  it("case cochée : la liste de montants s'affiche juste après la case, avant la garantie suivante", () => {
    const html = rendre(["vol.caisse"]);
    const caisse = position(html, 'value="vol.caisse"');
    const montant = position(html, 'name="bareme_vol_caisse_montant"');
    const suivante = position(html, 'value="dde"');
    expect(montant).toBeGreaterThan(caisse);
    expect(montant).toBeLessThan(suivante);
    // Aucun autre champ entre la case et sa liste.
    expect(html.slice(caisse, montant)).not.toContain('name="bareme_');
  });

  it("composante par composante : la caisse cochée n'ouvre pas le contenu", () => {
    const html = rendre(["vol.caisse"]);
    expect(html).not.toContain('name="bareme_vol_contenu_montant"');
    expect(html).toContain('name="bareme_vol_caisse_montant"');
  });

  it("case décochée : les champs sont absents (donc jamais envoyés) et le panneau est caché", () => {
    const html = rendre([]);
    expect(html).not.toContain('name="bareme_vol_caisse_montant"');
    expect(html).not.toContain('name="bareme_dde_montant"');
  });

  it("aria-expanded et aria-controls : la case désigne son panneau, ouvert quand elle est cochée", () => {
    const ouverte = balise(rendre(["dde"]), "dde");
    expect(ouverte).toContain('aria-expanded="true"');
    const id = ouverte.match(/aria-controls="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(rendre(["dde"])).toContain(`id="${id}"`);

    const fermee = balise(rendre([]), "dde");
    expect(fermee).toContain('aria-expanded="false"');
    const idFermee = fermee.match(/aria-controls="([^"]+)"/)?.[1];
    expect(rendre([])).toMatch(new RegExp(`id="${idFermee}"[^>]*hidden`)); // le panneau existe toujours, caché
  });

  it("une case sans champ propre n'annonce rien (pas d'aria-expanded)", () => {
    expect(balise(rendre([]), "vol.contenu")).not.toContain("aria-expanded");
  });

  it("le panneau est un groupe nommé (lecteur d'écran) ; le montant n'est plus dans un bloc à part", () => {
    const html = rendre(["dde"]);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Champs de Dégâts des eaux"');
  });

  it("aucune mise en page ne dépasse l'écran étroit : les colonnes ne s'ouvrent qu'à partir de sm", () => {
    const html = rendre(["dde"]);
    expect(html).toContain("sm:grid-cols-2");
    expect(html).not.toMatch(/class="[^"]*(?<![:\w-])grid-cols-2/); // pas de deux colonnes à 390 px
  });
});
