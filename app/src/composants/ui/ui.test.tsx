// Bibliothèque d'interface (refonte visuelle V1) : rendu statique côté serveur, sans navigateur. On vérifie ce qui compte pour
// le comportement et l'accessibilité (étiquettes, astérisque, aria, envoi du formulaire), pas le détail des classes de style.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Bouton, Carte, CarteIndicateur, Champ, ChampFormulaire, EnTetePage, EtatVide, FondDeMarque, Icone, ListeDeroulante, Pastille, Tableau, ZoneTexte } from "./index";
import { TRACES_PICTOGRAMME } from "./pictogramme";

const rendre = (element: React.ReactElement) => renderToStaticMarkup(element);

describe("Champ, ZoneTexte, ListeDeroulante : mêmes attributs qu'un champ natif (compatibles avec FormulaireAction)", () => {
  it("Champ : étiquette liée au champ, astérisque rouge si obligatoire, name / defaultValue / autoComplete transmis", () => {
    const html = rendre(<Champ label="Identifiant" name="identifiant" required autoComplete="username" defaultValue="abc" />);
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Identifiant<span aria-hidden="true" class="text-danger"> \*<\/span><\/label>/);
    const id = /<label for="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('name="identifiant"');
    expect(html).toMatch(/autocomplete="username"/i);
    expect(html).toContain('value="abc"');
    expect(html).toContain("required");
  });

  it("Champ : l'astérisque est décoratif (aria-hidden), 16 px sous sm (pas de zoom d'iOS), jamais un fond de panneau", () => {
    const html = rendre(<Champ label="Nom" name="nom" required />);
    expect(html).toContain('aria-hidden="true" class="text-danger"');
    expect(html).toContain("text-base");
    expect(html).toContain("sm:text-sm");
  });

  it("Champ : pas d'astérisque si facultatif ; erreur → aria-invalid et message relié par aria-describedby ; aide sans aria-invalid", () => {
    expect(rendre(<Champ label="Nom" name="nom" />)).not.toContain(" *");
    const enErreur = rendre(<Champ label="Nom" name="nom" erreur="Obligatoire" />);
    expect(enErreur).toContain('aria-invalid="true"');
    const idMessage = /aria-describedby="([^"]+)"/.exec(enErreur)![1];
    expect(enErreur).toContain(`id="${idMessage}"`);
    expect(enErreur).toContain("Obligatoire");
    const avecAide = rendre(<Champ label="Nom" name="nom" aide="Facultatif" />);
    expect(avecAide).not.toContain("aria-invalid");
    expect(avecAide).toContain("Facultatif");
  });

  it("ZoneTexte : <textarea> avec son étiquette", () => {
    const html = rendre(<ZoneTexte label="Motif" name="motif" rows={3} required />);
    expect(html).toContain("<textarea");
    expect(html).toContain('name="motif"');
    expect(html).toContain(">Motif<");
  });

  it("ListeDeroulante : l'invite est une option désactivée choisie par défaut ; les options gardent leur valeur", () => {
    const html = rendre(
      <ListeDeroulante label="Canal" name="canal" invite="— Choisir —" required options={[{ valeur: "ESPECES", libelle: "Espèces" }, { valeur: "CHEQUE", libelle: "Chèque" }]} />,
    );
    expect(html).toContain('name="canal"');
    expect(html).toMatch(/<option value="" disabled(="")?[^>]*>— Choisir —<\/option>/);
    expect(html).toContain('<option value="ESPECES">Espèces</option>');
    expect(html).toContain('<option value="CHEQUE">Chèque</option>');
  });

  it("ChampFormulaire : habille un contrôle quelconque", () => {
    const html = rendre(
      <ChampFormulaire label="Pièces" htmlFor="x" requis erreur="Manquantes">
        <input id="x" />
      </ChampFormulaire>,
    );
    expect(html).toContain('for="x"');
    expect(html).toContain("Manquantes");
  });
});

describe("Bouton", () => {
  it("est de type « button » par défaut (ne soumet pas un formulaire par accident), « submit » sur demande", () => {
    expect(rendre(<Bouton>Ok</Bouton>)).toContain('type="button"');
    expect(rendre(<Bouton type="submit">Ok</Bouton>)).toContain('type="submit"');
  });

  it("attente : spinner, désactivé, aria-busy", () => {
    const html = rendre(<Bouton attente>Envoyer</Bouton>);
    expect(html).toContain("<svg");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(rendre(<Bouton>Envoyer</Bouton>)).not.toContain("<svg");
  });

  it("variantes : danger et secondaire se distinguent du principal", () => {
    const principal = rendre(<Bouton>a</Bouton>);
    expect(rendre(<Bouton variante="danger">a</Bouton>)).toContain("bg-danger");
    expect(rendre(<Bouton variante="secondaire">a</Bouton>)).toContain("bg-secondary");
    expect(principal).toContain("bg-primary");
  });
});

describe("Pastille, Carte, EtatVide, EnTetePage", () => {
  it("Pastille : le ton change les classes, le libellé reste écrit", () => {
    expect(rendre(<Pastille ton="succes">Payé</Pastille>)).toMatch(/bg-success-bg.*Payé/);
    expect(rendre(<Pastille ton="danger">Non payé</Pastille>)).toMatch(/bg-danger-bg.*Non payé/);
    expect(rendre(<Pastille>Brouillon</Pastille>)).toContain("bg-neutral-bg");
  });

  it("Carte : remplissage par défaut, aucun avec espacement « aucun »", () => {
    expect(rendre(<Carte>x</Carte>)).toContain("p-6");
    expect(rendre(<Carte espacement="aucun">x</Carte>)).not.toContain("p-6");
  });

  it("EtatVide : message écrit", () => {
    expect(rendre(<EtatVide message="Aucune facture." />)).toContain("Aucune facture.");
  });

  it("EnTetePage : un seul h1, fil d'Ariane avec page courante, actions", () => {
    const html = rendre(
      <EnTetePage titre="Cotations" sousTitre="Toutes les cotations" actions={<button>Nouvelle</button>} filAriane={[{ libelle: "Accueil", href: "/" }, { libelle: "Cotations" }]} />,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Fil d&#x27;Ariane"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Toutes les cotations");
    expect(html).toContain("Nouvelle");
  });
});

describe("Tableau", () => {
  const colonnes = [
    { cle: "numero", entete: "N°", rendu: (l: { numero: string; ttc: string }) => l.numero },
    { cle: "ttc", entete: "TTC", alignement: "droite" as const, rendu: (l: { numero: string; ttc: string }) => l.ttc },
  ];

  it("lignes : en-têtes de colonne (scope), montants à droite en chiffres tabulaires, une ligne par donnée", () => {
    const html = rendre(<Tableau colonnes={colonnes} lignes={[{ numero: "FAC-1", ttc: "100" }, { numero: "FAC-2", ttc: "200" }]} cleLigne={(l) => l.numero} legende="Factures" />);
    expect(html.match(/<th scope="col"/g)).toHaveLength(2);
    expect(html.match(/<tr/g)).toHaveLength(3); // en-tête + 2 lignes
    expect(html).toMatch(/text-right tabular-nums[^>]*>100</);
    expect(html).toContain('<caption class="sr-only">Factures</caption>');
    // Région défilante focalisable au clavier (sinon un tableau plus large que l'écran ne se parcourt pas sans souris).
    expect(html).toMatch(/<div tabindex="0" role="region" aria-label="Factures"/i);
  });

  it("sans ligne : l'état vide remplace le tableau", () => {
    const html = rendre(<Tableau colonnes={colonnes} lignes={[]} cleLigne={(l) => l.numero} messageVide="Aucune facture." />);
    expect(html).toContain("Aucune facture.");
    expect(html).not.toContain("<table");
  });
});

describe("CarteIndicateur", () => {
  it("statique : un bloc ; avec href : un lien « Voir le détail »", () => {
    expect(rendre(<CarteIndicateur icone="portefeuille" etiquette="Encaissé" valeur="1 000" />)).not.toContain("<a ");
    const lien = rendre(<CarteIndicateur icone="portefeuille" etiquette="Impayés" valeur={3} href="/echeances" ton="danger" />);
    expect(lien).toContain('href="/echeances"');
    expect(lien).toContain("Voir le détail");
  });
});

describe("FondDeMarque, Icone", () => {
  it("FondDeMarque : décoratif (aria-hidden), les trois tracés du pictogramme, aucun clic capté", () => {
    const html = rendre(<FondDeMarque />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    expect(html.match(/<path/g)).toHaveLength(TRACES_PICTOGRAMME.length);
  });

  it("Icone : SVG décoratif ; une icône du jeu rend au moins un tracé", () => {
    for (const nom of ["maison", "portefeuille", "deconnexion", "chevron-bas", "alerte"] as const) {
      const html = rendre(<Icone nom={nom} className="size-4" />);
      expect(html, nom).toContain('aria-hidden="true"');
      expect(html, nom).toMatch(/<(path|rect|circle|ellipse)/);
    }
  });
});
