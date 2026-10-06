import { describe, expect, it } from "vitest";

import type { Analyse, Emplacement } from "./analyse";
import { champImiteUneBalise, controlerDepot } from "./controles";
import { CHAMPS, champsInconnus, donneesExemple, estConnu } from "./dictionnaire";
import {
  peutPublier,
  peutSoumettre,
  problemesPublication,
  problemesSaisieModele,
  problemesSaisieVersion,
  statutAffiche,
  versionEnVigueur,
  type SaisieModele,
  type VersionCycle,
} from "./modeles";

const ici = (paragraphe = 1, extrait = ""): Emplacement => ({ partie: "corps", paragraphe, tableau: null, ligne: null, colonne: null, extrait });
const cellule = (tableau: number, ligne: number, colonne: number, extrait: string): Emplacement => ({ partie: "corps", paragraphe: 4, tableau, ligne, colonne, extrait });

/** Socle obligatoire des CP (police, souscripteur, dates, prime TTC). */
const SOCLE_CP = ["police.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc"];
const refs = (chemins: string[]) => chemins.map((chemin) => ({ chemin, balise: `{{ ${chemin} }}`, emplacement: ici() }));

function analyse(surcharge: Partial<Analyse> = {}): Analyse {
  return {
    docx_valide: true,
    erreur: null,
    nombre_balises: SOCLE_CP.length,
    references: refs(SOCLE_CP),
    problemes: [],
    champs_word: [],
    blocs: [],
    filtres: [],
    polices: ["Tahoma"],
    polices_absentes: [],
    textes: [],
    ...surcharge,
  };
}

// ------------------------------------------------------------------ Dictionnaire

describe("dictionnaire des champs (CDC §6.3)", () => {
  it("connaît les noms du CDC, assures[].sexe, les objets, les listes et risque.*", () => {
    for (const chemin of ["souscripteur.nom", "prime.ttc", "assures[].sexe", "assures", "assures[]", "police.nantissement", "souscripteur", "risque.marque", "risque.statut", "qr_code", "societe.rib[].banque"]) {
      expect(estConnu(chemin), chemin).toBe(true);
    }
  });

  it("refuse tout autre nom (T9 : client.nom)", () => {
    for (const chemin of ["client.nom", "client", "souscripteur.nom_complet", "assures[].age", "prime.total", "risque.Marque", "formule.code"]) {
      expect(estConnu(chemin), chemin).toBe(false);
    }
  });

  it("chaque nom est unique et chaque champ simple a un exemple", () => {
    expect(new Set(CHAMPS.map((c) => c.chemin)).size).toBe(CHAMPS.length);
    for (const champ of CHAMPS) {
      if (!["liste", "objet", "image"].includes(champ.type)) expect(champ.exemple, champ.chemin).not.toBeUndefined();
    }
  });

  it("les montants d'exemple sont des textes, jamais des nombres à virgule", () => {
    for (const champ of CHAMPS.filter((c) => c.type === "montant" || c.type === "pourcentage")) {
      expect(typeof champ.exemple, champ.chemin).toBe("string");
    }
  });

  it("les données fictives couvrent le dictionnaire sans rien inventer", () => {
    const donnees = donneesExemple({ nombreAssures: 25 });
    expect(champsInconnus(donnees)).toEqual([]);
    expect((donnees.assures as unknown[]).length).toBe(25);
    expect(donnees.prime).toMatchObject({ ttc: "15888000" });
  });

  it("une construction de données qui invente un nom est repérée", () => {
    expect(champsInconnus({ souscripteur: { nom: "X", nom_complet: "Y" }, client: { nom: "Z" }, risque: { libre: "ok" } })).toEqual(["client", "client.nom", "souscripteur.nom_complet"]);
  });
});

// ------------------------------------------------------------------ Contrôles au dépôt

describe("contrôles au dépôt (CDC §6.7)", () => {
  it("T9 : {{ client.nom }} est rejeté avec un message et son emplacement", () => {
    const r = controlerDepot(
      "CP",
      analyse({ references: [...refs(SOCLE_CP), { chemin: "client.nom", balise: "{{ client.nom }}", emplacement: cellule(1, 2, 1, "{{ client.nom }}") }] }),
    );
    expect(r.rejets).toEqual([
      {
        message: "Balise inconnue « client.nom » dans {{ client.nom }} : ce nom n'est pas dans le dictionnaire des champs.",
        emplacement: "corps, tableau 1, ligne 2, colonne 1 : « {{ client.nom }} »",
      },
    ]);
  });

  it("un modèle correct passe", () => {
    expect(controlerDepot("CP", analyse())).toEqual({ rejets: [], avertissements: [] });
  });

  it("fichier invalide", () => {
    expect(controlerDepot("CP", analyse({ docx_valide: false, erreur: "le fichier n'est pas un document Word .docx valide" })).rejets).toHaveLength(1);
  });

  it("les problèmes de structure relevés par le générateur sont des rejets situés", () => {
    const r = controlerDepot("CP", analyse({ problemes: [{ code: "BLOC_NON_FERME", message: "bloc « if » jamais fermé", emplacement: ici(2, "{% if police.nantissement %}") }] }));
    expect(r.rejets[0]).toEqual({ message: "Bloc « if » jamais fermé.", emplacement: "corps, paragraphe 2 : « {% if police.nantissement %} »" });
  });

  it("champ Word qui imite une balise : rejet ; champ PAGE : accepté", () => {
    const r = controlerDepot("CP", analyse({ champs_word: [{ instruction: "souscripteur.nom", emplacement: ici(3) }, { instruction: "PAGE \\* MERGEFORMAT", emplacement: ici(9) }] }));
    expect(r.rejets).toHaveLength(1);
    expect(r.rejets[0].message).toContain("retapez-la au clavier");
    expect(r.rejets[0].emplacement).toBe("corps, paragraphe 3");
  });

  it.each([
    ["{ souscripteur.nom }", true],
    ["MERGEFIELD nom_client", true],
    ["qr_code", true],
    ["PAGE", false],
    ["NUMPAGES \\* MERGEFORMAT", false],
    ['HYPERLINK "https://exemple.ci"', false],
    ["TOC \\o \"1-3\"", false],
  ])("champImiteUneBalise(%s) = %s", (instruction, attendu) => {
    expect(champImiteUneBalise(instruction)).toBe(attendu);
  });

  it("un modèle généré sans balise est rejeté ; un sous-modèle fixe est accepté", () => {
    const sansBalise = analyse({ nombre_balises: 0, references: [] });
    expect(controlerDepot("CP", sansBalise).rejets[0].message).toContain("Aucune balise");
    expect(controlerDepot("SOUS_MODELE", sansBalise).rejets).toEqual([]);
    expect(controlerDepot("CG", sansBalise).rejets).toEqual([]);
  });

  it("CG : seules les balises du visa", () => {
    const r = controlerDepot(
      "CG",
      analyse({
        references: [
          { chemin: "produit.cg_visa", balise: "{{ produit.cg_visa }}", emplacement: ici(1) },
          { chemin: "souscripteur.nom", balise: "{{ souscripteur.nom }}", emplacement: ici(2) },
        ],
      }),
    );
    expect(r.rejets).toHaveLength(1);
    expect(r.rejets[0].message).toContain("seules les balises du visa");
  });

  it("CP, cotation, reçu : numéro, souscripteur, dates d'effet et d'échéance, prime TTC obligatoires (correction de H15)", () => {
    const vide = analyse({ references: refs(["produit.libelle"]) });
    expect(controlerDepot("CP", vide).rejets.map((c) => c.message)).toEqual([
      "Champ obligatoire pour un modèle de conditions particulières absent : {{ police.numero }}.",
      "Champ obligatoire pour un modèle de conditions particulières absent : {{ souscripteur.nom }} ou {{ souscripteur.raison_sociale }}.",
      "Champ obligatoire pour un modèle de conditions particulières absent : {{ police.date_effet }}.",
      "Champ obligatoire pour un modèle de conditions particulières absent : {{ police.date_echeance }}.",
      "Champ obligatoire pour un modèle de conditions particulières absent : {{ prime.ttc }}.",
    ]);
    // Personne morale : la raison sociale suffit.
    expect(controlerDepot("CP", analyse({ references: refs(["police.numero", "souscripteur.raison_sociale", "police.date_effet", "police.date_echeance", "prime.ttc"]) })).rejets).toEqual([]);
    // Cotation : son numéro est doc.numero (pas encore de police).
    const cotation = ["doc.numero", "souscripteur.nom", "police.date_effet", "police.date_echeance", "prime.ttc"];
    expect(controlerDepot("COTATION", analyse({ references: refs(cotation) })).rejets).toEqual([]);
    expect(controlerDepot("COTATION", analyse()).rejets.map((c) => c.message)).toEqual(["Champ obligatoire pour un modèle de cotation absent : {{ doc.numero }}."]);
    // Reçu : en plus, le montant payé et la facture réglée.
    expect(controlerDepot("RECU", analyse()).rejets.map((c) => c.message)).toEqual([
      "Champ obligatoire pour un modèle de reçu absent : {{ paiements[].montant }}.",
      "Champ obligatoire pour un modèle de reçu absent : {{ doc.facture_origine }}.",
    ]);
    expect(controlerDepot("RECU", analyse({ references: refs([...SOCLE_CP, "paiements[].montant", "doc.facture_origine"]) })).rejets).toEqual([]);
  });

  it("facture : doc.numero, prime.ttc et societe.rccm obligatoires", () => {
    const r = controlerDepot("FACTURE", analyse({ references: [{ chemin: "prime.ttc", balise: "{{ prime.ttc | montant }}", emplacement: ici() }] }));
    expect(r.rejets.map((c) => c.message)).toEqual([
      "Champ obligatoire pour un modèle de facture absent : {{ doc.numero }}.",
      "Champ obligatoire pour un modèle de facture absent : {{ societe.rccm }}.",
    ]);
  });

  it("police absente et marqueur hérité : avertissements, sans rejet", () => {
    const r = controlerDepot("CP", analyse({ polices_absentes: ["Bodoni MT"], textes: [{ texte: "Date : 00/00/00, signature : ________", emplacement: ici(7) }] }));
    expect(r.rejets).toEqual([]);
    expect(r.avertissements.map((a) => a.message)).toEqual([
      expect.stringContaining("Bodoni MT"),
      expect.stringContaining("« 00/00/00 »"),
      expect.stringContaining("« ___ »"),
    ]);
  });
});

// ------------------------------------------------------------------ Saisie et cycle de vie

const saisie = (s: Partial<SaisieModele>): SaisieModele => ({ type: "CP", code: "CP_RELAXSANTE", libelle: "CP Relax Santé", produitCode: "RELAXSANTE", niveauRelance: null, listeAnnexe: null, blocNom: null, blocCle: null, ...s });

describe("bibliothèque de modèles (CDC §6.1, §6.6)", () => {
  it("saisie d'un modèle selon son type", () => {
    expect(problemesSaisieModele(saisie({}))).toEqual([]);
    expect(problemesSaisieModele(saisie({ produitCode: null }))).toHaveLength(1);
    expect(problemesSaisieModele(saisie({ type: "CG", code: "CG_SECUR_DOMMAGE", produitCode: null }))).toEqual([]);
    expect(problemesSaisieModele(saisie({ type: "CG", produitCode: "RELAXSANTE" }))).toHaveLength(1);
    expect(problemesSaisieModele(saisie({ type: "ANNEXE", code: "ANNEXE_ASSURES", produitCode: null, listeAnnexe: "assures" }))).toEqual([]);
    expect(problemesSaisieModele(saisie({ type: "SOUS_MODELE", code: "GAR_SOLO", blocNom: "garanties", blocCle: "SOLO" }))).toEqual([]);
    expect(problemesSaisieModele(saisie({ type: "SOUS_MODELE", code: "GAR", blocNom: null, blocCle: null }))).toHaveLength(2);
    expect(problemesSaisieModele(saisie({ type: "RELANCE", produitCode: null, niveauRelance: 0 }))).toHaveLength(1);
  });

  it("dépôt d'une version : .docx, commentaire, visa des CG", () => {
    const v = { nomFichier: "cp.docx", taille: 1000, commentaire: "Première version", dateEffet: "2026-10-06", visa: null, dateDocument: null };
    expect(problemesSaisieVersion("CP", v)).toEqual([]);
    expect(problemesSaisieVersion("CP", { ...v, nomFichier: "cp.doc" })).toHaveLength(1);
    expect(problemesSaisieVersion("CG", v)).toHaveLength(2);
    expect(problemesSaisieVersion("CG", { ...v, visa: "MFB/DGTCP/DA/N° 01498", dateDocument: "2025-06-19" })).toEqual([]);
  });

  const auteur = 1;
  const valideur = 2;
  const v = (id: number, statut: VersionCycle["statut"], dateEffet: string): VersionCycle => ({ id, numero: id, statut, dateEffet, auteurId: auteur });

  it("seul l'auteur soumet ; le valideur n'est jamais l'auteur", () => {
    expect(peutSoumettre(v(1, "BROUILLON", "2026-10-06"), auteur)).toBe(true);
    expect(peutSoumettre(v(1, "BROUILLON", "2026-10-06"), valideur)).toBe(false);
    expect(peutPublier(v(1, "SOUMIS", "2026-10-06"), auteur)).toBe(false);
    expect(peutPublier(v(1, "SOUMIS", "2026-10-06"), valideur)).toBe(true);
    expect(peutPublier(v(1, "BROUILLON", "2026-10-06"), valideur)).toBe(false);
  });

  it("version en vigueur à une date (T10 : la réédition retrouve la version de l'époque)", () => {
    const versions = [v(1, "PUBLIE", "2026-01-01"), v(2, "PUBLIE", "2026-07-01"), v(3, "SOUMIS", "2026-08-01"), v(4, "PUBLIE", "2027-01-01")];
    expect(versionEnVigueur(versions, "2025-12-31")).toBeNull();
    expect(versionEnVigueur(versions, "2026-03-15")?.id).toBe(1);
    expect(versionEnVigueur(versions, "2026-10-06")?.id).toBe(2);
    expect(versionEnVigueur(versions, "2027-01-01")?.id).toBe(4);
    expect(versions.map((x) => statutAffiche(x, versions, "2026-10-06"))).toEqual(["REMPLACEE", "EN_VIGUEUR", "SOUMIS", "PROGRAMMEE"]);
  });

  it("publication : jamais rétroactive, une seule version publiée par date", () => {
    const versions = [v(1, "PUBLIE", "2026-11-01"), v(2, "SOUMIS", "2026-10-06")];
    expect(problemesPublication(versions[1], "2026-10-06", "2026-10-06", versions)).toEqual([]);
    expect(problemesPublication(versions[1], "2026-10-05", "2026-10-06", versions)).toHaveLength(1);
    expect(problemesPublication(versions[1], "2026-11-01", "2026-10-06", versions)).toHaveLength(1);
  });
});
