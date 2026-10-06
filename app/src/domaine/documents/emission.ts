import type { DateIso } from "../calcul/dates";

/**
 * Émission des documents (CDC §6.8, §14) : règles pures. Le stockage, le jeton et la génération
 * sont dans serveur/documents.ts.
 */

export const TYPES_DOCUMENT = ["COTATION", "CP", "FACTURE", "AVOIR", "RECU", "AVIS_ECHEANCE", "RELANCE"] as const;
export type TypeDocument = (typeof TYPES_DOCUMENT)[number];

/** Libellé et accord (« Annulée », « Annulé », « Annulées ») de chaque type. */
export const DOCUMENTS: Record<TypeDocument, { libelle: string; accord: "f" | "m" | "fp" }> = {
  COTATION: { libelle: "Cotation", accord: "f" },
  CP: { libelle: "Conditions particulières", accord: "fp" },
  FACTURE: { libelle: "Facture", accord: "f" },
  AVOIR: { libelle: "Avoir", accord: "m" },
  RECU: { libelle: "Reçu", accord: "m" },
  AVIS_ECHEANCE: { libelle: "Avis d'échéance", accord: "m" },
  RELANCE: { libelle: "Relance", accord: "f" },
};

export const estTypeDocument = (valeur: string): valeur is TypeDocument => (TYPES_DOCUMENT as readonly string[]).includes(valeur);

const accorder = (racine: string, accord: "f" | "m" | "fp") => racine + { f: "e", m: "", fp: "es" }[accord];

// ------------------------------------------------------------------ Souscripteur masqué (§14.1)

/** « KOUADIO » → « K****** » : la première lettre, puis une étoile par lettre. */
const masquerMot = (mot: string) => (mot.length <= 1 ? mot : mot[0] + "*".repeat(mot.length - 1));

/**
 * Souscripteur pour la page PUBLIQUE de vérification : « K****** A. » (initiale du premier prénom),
 * ou chaque mot d'une raison sociale masqué (« C** S****** »). Aucune autre donnée personnelle.
 */
export function masquerSouscripteur(s: { type: string; nom?: string | null; prenoms?: string | null; raison_sociale?: string | null }): string {
  if (s.type === "MORALE") {
    return (s.raison_sociale ?? "").trim().split(/\s+/).filter(Boolean).map(masquerMot).join(" ") || "—";
  }
  const nom = (s.nom ?? "").trim().split(/\s+/).filter(Boolean).map(masquerMot).join(" ");
  const initiale = (s.prenoms ?? "").trim().charAt(0);
  return [nom, initiale ? `${initiale.toUpperCase()}.` : ""].filter(Boolean).join(" ") || "—";
}

/** Nom complet, pour la recherche dans « Documents émis » (jamais affiché publiquement). */
export function nomSouscripteur(s: { type: string; nom?: string | null; prenoms?: string | null; raison_sociale?: string | null }): string {
  return (s.type === "MORALE" ? (s.raison_sociale ?? "") : `${s.nom ?? ""} ${s.prenoms ?? ""}`).trim();
}

// ------------------------------------------------------------------ Stockage (§14.2 adapté par D11)

/**
 * Chemin du PDF dans le stockage : {Produit}/{AAAA}/{MM}/{Type}/{Numéro}_{Type}_{AAAAMMJJ}_v{version}.pdf
 * (arborescence du CDC §14.2, sur le volume persistant). Une réédition a son propre fichier.
 */
export function cheminStockage(d: { produitCode: string; type: TypeDocument; numero: string; dateEmission: DateIso; version: number }): string {
  const [annee, mois, jour] = d.dateEmission.split("-");
  const propre = (texte: string) => texte.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${propre(d.produitCode)}/${annee}/${mois}/${d.type}/${propre(d.numero)}_${d.type}_${annee}${mois}${jour}_v${d.version}.pdf`;
}

// ------------------------------------------------------------------ Statut public (§14.1, T12)

export type StatutPublic = { code: "VALIDE" | "ANNULE" | "EXPIRE"; libelle: string };

/** Statut en temps réel affiché sur la page de vérification. */
export function statutPublic(d: { type: TypeDocument; annuleParNumero: string | null; dateValidite: DateIso | null }, aujourdhui: DateIso): StatutPublic {
  const { accord } = DOCUMENTS[d.type];
  if (d.annuleParNumero) return { code: "ANNULE", libelle: `${accorder("Annulé", accord)} – avoir ${d.annuleParNumero}` };
  if (d.dateValidite !== null && aujourdhui > d.dateValidite) return { code: "EXPIRE", libelle: accorder("Expiré", accord) };
  return { code: "VALIDE", libelle: accorder("Valide", "m") };
}

// ------------------------------------------------------------------ Assemblage (§6.8)

/**
 * Contrôle BLOQUANT : le visa cité dans les CP (paramétrage du produit) est celui des CG jointes ;
 * de même pour les CS.
 */
export function problemesVisas(
  produit: { cgVisa: string | null; csVisa: string | null },
  jointes: { cg: { code: string; visa: string | null } | null; cs: { code: string; visa: string | null } | null },
): string[] {
  const p: string[] = [];
  const normal = (v: string | null) => (v ?? "").replace(/\s+/g, " ").trim();
  if (jointes.cg && normal(produit.cgVisa) !== normal(jointes.cg.visa)) {
    p.push(`Visa incohérent : le produit cite « ${produit.cgVisa} », les conditions générales jointes (${jointes.cg.code}) portent « ${jointes.cg.visa} ». Corrigez le paramétrage du produit ou les CG avant d'émettre.`);
  }
  if (jointes.cs && normal(produit.csVisa) !== normal(jointes.cs.visa)) {
    p.push(`Visa incohérent : le produit cite « ${produit.csVisa} », les conventions spéciales jointes (${jointes.cs.code}) portent « ${jointes.cs.visa} ».`);
  }
  return p;
}
