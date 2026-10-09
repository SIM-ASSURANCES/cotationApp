import { describe, expect, it } from "vitest";

import { calculer, type EntreeCalcul } from "../calcul/calcul";
import { CHAMPS_FACULTATIFS } from "./dictionnaire";
import { donneesDocument, type SourceDocument } from "./donnees";
import { cheminStockage, masquerSouscripteur, problemesVisas, statutPublic } from "./emission";
import { SOCIETE_DEFAUT, lireLignes, lireSociete, problemesSociete } from "./societe";

describe("émission : règles pures (CDC §14)", () => {
  it("souscripteur masqué pour la page publique", () => {
    expect(masquerSouscripteur({ type: "PHYSIQUE", nom: "KOUADIO", prenoms: "Awa Inventée" })).toBe("K****** A.");
    expect(masquerSouscripteur({ type: "PHYSIQUE", nom: "YAO KOFFI", prenoms: "" })).toBe("Y** K****");
    expect(masquerSouscripteur({ type: "MORALE", raison_sociale: "CGE SENEGAL" })).toBe("C** S******");
    expect(masquerSouscripteur({ type: "PHYSIQUE", nom: "", prenoms: "" })).toBe("—");
  });

  it("chemin de stockage (arborescence §14.2) : une version, un fichier", () => {
    expect(cheminStockage({ produitCode: "RELAXSANTE", type: "COTATION", numero: "COT-2026-10-0001", dateEmission: "2026-10-06", version: 2 })).toBe(
      "RELAXSANTE/2026/10/COTATION/COT-2026-10-0001_COTATION_20261006_v2.pdf",
    );
  });

  it("statut public : valide, expirée, annulée par avoir (T12)", () => {
    expect(statutPublic({ type: "COTATION", annuleParNumero: null, dateValidite: "2026-12-31" }, "2026-10-06")).toEqual({ code: "VALIDE", libelle: "Valide" });
    expect(statutPublic({ type: "COTATION", annuleParNumero: null, dateValidite: "2026-10-05" }, "2026-10-06").libelle).toBe("Expirée");
    expect(statutPublic({ type: "FACTURE", annuleParNumero: "AV-2026-10-0001", dateValidite: null }, "2026-10-06")).toEqual({ code: "ANNULE", libelle: "Annulée – avoir AV-2026-10-0001" });
    expect(statutPublic({ type: "RECU", annuleParNumero: "AV-1", dateValidite: null }, "2026-10-06").libelle).toBe("Annulé – avoir AV-1");
  });

  it("assemblage : le visa cité par le produit doit être celui des CG jointes (contrôle bloquant)", () => {
    const cg = { code: "CG_SECUR", visa: "MFB/DGTCP/DA/N° 01498" };
    expect(problemesVisas({ cgVisa: "MFB/DGTCP/DA/N°  01498", csVisa: null }, { cg, cs: null })).toEqual([]);
    expect(problemesVisas({ cgVisa: "MFB/DGTCP/DA/N° 01497", csVisa: null }, { cg, cs: null })[0]).toContain("Visa incohérent");
  });

  it("paramètres de la société : défaut, lecture tolérante, lignes « a ; b »", () => {
    expect(lireSociete(null)).toEqual(SOCIETE_DEFAUT);
    expect(lireSociete(JSON.stringify({ societe: { rccm: "CI-ABJ-X" } })).societe).toMatchObject({ rccm: "CI-ABJ-X", raison_sociale: "SIM Assurances Côte d'Ivoire" });
    expect(lireLignes("BANQUE A ; CI001\n\nBANQUE B;CI002", ["banque", "numero"] as const)).toEqual([{ banque: "BANQUE A", numero: "CI001" }, { banque: "BANQUE B", numero: "CI002" }]);
    expect(problemesSociete({ ...SOCIETE_DEFAUT, societe: { ...SOCIETE_DEFAUT.societe, capital: "727 000 000" } })).toHaveLength(1);
  });
});

/** Entrée du moteur de T1 (offre BENI) : Solo 3 × 93 581,33 + 3 000 ; Famille 60 × 252 657,63 + 210 000 ; taxe 1,5 %. */
const entreeT1: EntreeCalcul = {
  dateEffet: "2026-01-01",
  dateEcheance: "2026-12-31",
  lignes: [
    { code: "SOLO", primeUnitaire: "93581.33", effectif: 3, accessoire: { mode: "FIXE", valeur: "3000" } },
    { code: "FAMILLE", primeUnitaire: "252657.63", effectif: 60, accessoire: { mode: "FIXE", valeur: "210000" } },
  ],
  parametres: {
    prorata: { actif: true, primeMinimale: null },
    arrondi: { precision: 1, sens: "PROCHE", niveau: "LIGNE", composanteAbsorbante: "TAXE" },
    taxe: { tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES" },
  },
};

describe("données d'une cotation T1 (dictionnaire, montants du moteur)", () => {
  const r = calculer(entreeT1);
  const t = (m: { toFixed(): string }) => m.toFixed();
  const source: SourceDocument = {
    type: "COTATION",
    numero: "COT-2026-10-0001",
    version: 1,
    dateEmission: "2026-10-06",
    dateValidite: "2027-01-06",
    policeNumero: null,
    produit: { code: "BENI", libelle: "Santé BENI", gamme: "RELAX", branche: "SANTE" },
    cg: null,
    cs: null,
    souscripteur: { type: "MORALE", nom: "", prenoms: "", raison_sociale: "ENTREPRISE INVENTÉE", telephone: "", email: "", adresse: "" },
    assures: [],
    ordresSansPrime: [],
    beneficiaires: null,
    contactsUrgence: null,
    policeMere: null,
    risque: {},
    dateEffet: entreeT1.dateEffet,
    dateEcheance: entreeT1.dateEcheance,
    joursCouverts: r.joursCouverts,
    formules: r.lignes.map((l, i) => ({ code: l.code, libelle: l.code, tauxCouverture: null, effectif: l.effectif, primeUnitaire: String(entreeT1.lignes[i].primeUnitaire), primeParAssure: t(l.ttcParUnite), nette: t(l.arrondi.nette), accessoires: t(l.arrondi.accessoires), taxe: t(l.arrondi.taxe), ttc: t(l.arrondi.ttc) })),
    totaux: { nette: t(r.totaux.arrondi.nette), accessoires: t(r.totaux.arrondi.accessoires), taxe: t(r.totaux.arrondi.taxe), ttc: t(r.totaux.arrondi.ttc) },
    taxe: { tauxPourcent: "1.5", assiette: "NETTE_ACCESSOIRES" },
    echeances: [],
    forcee: false,
    motifForcage: null,
    societe: SOCIETE_DEFAUT.societe,
    mentions: SOCIETE_DEFAUT.document,
    urlVerification: "https://exemple.ci/verif/jeton",
    typeContrat: "GROUPE",
    auteurNom: "AUTEUR Inventé",
  };

  it("montants identiques à T1, dans les noms du dictionnaire", () => {
    const d = donneesDocument(source) as { formules: Record<string, unknown>[]; prime: Record<string, unknown>; doc: Record<string, unknown>; souscripteur: Record<string, unknown> };
    expect(d.formules.map((f) => [f.code, f.prime_nette, f.taxe, f.ttc])).toEqual([
      ["SOLO", "280744", "4256", "288000"],
      ["FAMILLE", "15159458", "230542", "15600000"],
    ]);
    expect(d.prime).toMatchObject({ ttc: "15888000", taux_taxe: "1.5" });
    expect(d.prime.base_taxe).toBe(String(Number(d.prime.nette) + Number(d.prime.accessoires)));
    expect(d.doc).toMatchObject({ type: "COTATION", numero: "COT-2026-10-0001", version: "v1", date_validite: "2027-01-06", url_verification: "https://exemple.ci/verif/jeton", empreinte: null, auteur_nom: "AUTEUR Inventé" });
    expect(d.souscripteur).toMatchObject({ type: "MORALE", raison_sociale: "ENTREPRISE INVENTÉE", nom: null });
  });

  it("option b de H19 (D19) : un champ non fourni est absent, sauf s'il est facultatif (rendu vide)", () => {
    const d = donneesDocument(source) as Record<string, Record<string, unknown>>;
    // Connu mais vide : présent, null.
    expect(d.souscripteur.nom).toBeNull();
    // Non fourni et non facultatif : ABSENT (un modèle qui l'utilise ne se génère pas).
    expect("profession" in d.souscripteur).toBe(false);
    expect("beneficiaires" in d).toBe(false);
    // Non fourni mais facultatif : présent et vide.
    expect(d.intermediaires).toEqual([]);
    expect(d.police.reference).toBeNull(); // facultatif depuis les corrections de la 4a
    expect(d.police.nantissement).toBeNull();
    expect(d.police.police_mere).toBeNull();
    expect(d.doc.empreinte).toBeNull();
    // Fourni depuis la session 4.0.
    expect(d.police.type_contrat).toBe("GROUPE");
  });

  it("liste des champs facultatifs envoyée au générateur (D19) : vides, ils s'écrivent vides même dans un filtre", () => {
    expect([...CHAMPS_FACULTATIFS].sort()).toEqual(["doc.empreinte", "intermediaires", "police.nantissement", "police.police_mere", "police.reference"]);
  });

  const assure = (ordre: number, formule: string) => ({ ordre, nom_prenoms: `ASSURÉ ${ordre}`, date_naissance: "" as const, sexe: "" as const, lien: "", formule });
  type Assures = { assures: { ordre: number; formule: string | null; prime?: string | null }[] };

  it("assures[].prime (H45) : le TTC d'une unité de la formule, calculé par le moteur (T1 : Solo 96 000, Famille 260 000)", () => {
    const d = donneesDocument({ ...source, assures: [assure(1, "SOLO"), assure(2, "FAMILLE"), assure(3, "SOLO")] }) as unknown as Assures;

    expect(d.assures.map((a) => [a.ordre, a.formule, a.prime])).toEqual([
      [1, "SOLO", "96000"],
      [2, "FAMILLE", "260000"],
      [3, "SOLO", "96000"],
    ]);
  });

  it("assures[].prime : vide (null) sans formule, pour une formule hors calcul et pour un adhérent incorporé après la liste initiale", () => {
    const d = donneesDocument({ ...source, assures: [assure(1, "SOLO"), assure(2, ""), assure(3, "INCONNUE"), assure(4, "SOLO")], ordresSansPrime: [4] }) as unknown as Assures;

    expect(d.assures.map((a) => a.prime)).toEqual(["96000", null, null, null]);
  });

  it("assures[].prime : pas de prime sur un certificat d'adhésion (H36) ; un modèle qui l'utilise ne se génère pas", () => {
    const d = donneesDocument({ ...source, type: "CERTIFICAT", assures: [assure(1, "SOLO")] }) as unknown as Assures;

    expect("prime" in d.assures[0]).toBe(false);
  });

  it("police.duree_libelle (H39) : « 1 an » pour une année civile, les jours pour une durée inexacte", () => {
    const duree = (dateEffet: string, dateEcheance: string) => (donneesDocument({ ...source, dateEffet, dateEcheance }) as { police: { duree_libelle: string; duree_jours: number } }).police;

    expect(duree("2026-01-01", "2026-12-31")).toMatchObject({ duree_libelle: "1 an", duree_jours: r.joursCouverts });
    expect(duree("2026-07-22", "2027-01-21").duree_libelle).toBe("6 mois");
    expect(duree("2026-07-22", "2026-12-31").duree_libelle).toBe("163 jours");
  });
});
