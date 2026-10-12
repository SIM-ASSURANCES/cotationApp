// Session 6.1 : le pont de generateur/scripts/verifier_modele.py rejoue les contrôles du dépôt, sans règle nouvelle.
import { describe, expect, it } from "vitest";

import type { Analyse } from "./analyse";
import { controlerDepot } from "./controles";
import { CHAMPS_FACULTATIFS } from "./dictionnaire";
import { verifierModele } from "./verification-modele";

const ici = { partie: "corps", paragraphe: 3, tableau: null, ligne: null, colonne: null, extrait: "" };
const analyse = (surcharge: Partial<Analyse> = {}): Analyse => ({
  docx_valide: true,
  erreur: null,
  nombre_balises: 1,
  references: [],
  problemes: [],
  champs_word: [],
  blocs: [],
  filtres: [],
  polices: [],
  polices_absentes: [],
  textes: [],
  ...surcharge,
});
const reference = (chemin: string) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici });

describe("vérification d'un modèle avant dépôt", () => {
  it("donne exactement le résultat de controlerDepot (mêmes règles que le dépôt), et le dictionnaire de l'application", () => {
    const a = analyse({ references: [reference("client.nom"), reference("police.numero")], champs_word: [{ instruction: " souscripteur.nom ", emplacement: ici }] });
    const v = verifierModele({ type: "CP", analyse: a });
    if (!v.ok) throw new Error(v.erreur);
    expect(v.controle).toEqual(controlerDepot("CP", a));
    expect(v.inconnues).toEqual([{ chemin: "client.nom", balise: "{{ client.nom }}", emplacement: "corps, paragraphe 3" }]);
    expect(v.champsWordImitantUneBalise).toEqual([" souscripteur.nom "]);
    expect(v.facultatifs).toBe(CHAMPS_FACULTATIFS);
    expect(v.facultatifs).toContain("formules[].taux_couverture");
  });

  it("un champ Word légitime (numéro de page) n'est pas signalé", () => {
    const v = verifierModele({ type: "ANNEXE", analyse: analyse({ champs_word: [{ instruction: "PAGE", emplacement: ici }] }) });
    if (!v.ok) throw new Error(v.erreur);
    expect(v.champsWordImitantUneBalise).toEqual([]);
  });

  it("refuse un type inconnu en listant les types, et une analyse d'une autre version", () => {
    expect(verifierModele({ type: "LETTRE", analyse: analyse() })).toMatchObject({ ok: false, erreur: expect.stringContaining("FACTURE") });
    expect(verifierModele({ type: "CP", analyse: { docx_valide: true } })).toMatchObject({ ok: false, erreur: expect.stringContaining("Analyse illisible") });
  });
});
