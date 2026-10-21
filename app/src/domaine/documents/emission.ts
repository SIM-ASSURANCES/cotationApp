import type { DateIso } from "../calcul/dates";

/**
 * Émission des documents (CDC §6.8, §14) : règles pures. Le stockage, le jeton et la génération
 * sont dans serveur/documents.ts.
 */

export const TYPES_DOCUMENT = ["COTATION", "CP", "CERTIFICAT", "FACTURE", "AVOIR", "RECU", "AVIS_ECHEANCE", "RELANCE"] as const;
export type TypeDocument = (typeof TYPES_DOCUMENT)[number];

/** Libellé et accord (« Annulée », « Annulé », « Annulées ») de chaque type. */
export const DOCUMENTS: Record<TypeDocument, { libelle: string; accord: "f" | "m" | "fp" }> = {
  COTATION: { libelle: "Cotation", accord: "f" },
  CP: { libelle: "Conditions particulières", accord: "fp" },
  CERTIFICAT: { libelle: "Certificat d'adhésion", accord: "m" },
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

// ------------------------------------------------------------------ Stockage (§14.2, D11, D41)

const REGEX_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}$/;

export function segmentValide(segment: string): boolean {
  return REGEX_SEGMENT.test(segment) && segment !== "." && segment !== "..";
}

export function nettoyerSegment(texte: string): string {
  const nettoye = texte.trim().replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  if (!nettoye || nettoye === "." || nettoye === "..") {
    return "S_defaut";
  }
  if (nettoye.startsWith(".") || nettoye.startsWith("-")) {
    const reste = nettoye.replace(/^[.-]+/, "").replace(/^_+/, "");
    return `S_${reste || "segment"}`.slice(0, 120);
  }
  return nettoye;
}

export type ContexteCheminStockage = {
  brancheCode: string;
  produitCode: string;
  clientIdentifiant: string;
  cotationNumero: string;
  policeNumero?: string | null;
  avenantNumero?: string | null;
  factureNumero?: string | null;
  type: TypeDocument;
  numero: string;
  version: number;
};

export type ContexteCheminLegacy = {
  produitCode: string;
  type: TypeDocument;
  numero: string;
  dateEmission: DateIso;
  version: number;
};

/**
 * Chemin du PDF dans le stockage selon l'arborescence du portefeuille (Étape 5, D41) :
 * <branche>/<produit>/<client>/<cotation>/<contrat>/<avenant>/<facture>/{avoir,recus,relances,echeances,certificats}/<nom>.pdf
 *
 * Règles :
 * - Codes et numéros lisibles uniquement (aucun nom de personne / PII).
 * - Arborescence adaptative : les niveaux intermédiaires absents sont omis.
 * - Validation stricte : pas de '..', segments conformes à stockage.py, max 10 segments au total.
 */
export function cheminStockageArborescent(d: ContexteCheminStockage): string {
  const segments: string[] = [
    nettoyerSegment(d.brancheCode),
    nettoyerSegment(d.produitCode),
    nettoyerSegment(d.clientIdentifiant),
    nettoyerSegment(d.cotationNumero),
  ];

  if (d.policeNumero) {
    segments.push(nettoyerSegment(d.policeNumero));
  }

  if (d.avenantNumero) {
    segments.push(nettoyerSegment(d.avenantNumero));
  }

  switch (d.type) {
    case "COTATION":
    case "CP":
      break;

    case "CERTIFICAT":
      segments.push("certificats");
      break;

    case "FACTURE":
      segments.push(nettoyerSegment(d.numero));
      break;

    case "AVOIR":
      if (d.factureNumero) segments.push(nettoyerSegment(d.factureNumero));
      segments.push("avoir");
      break;

    case "RECU":
      if (d.factureNumero) segments.push(nettoyerSegment(d.factureNumero));
      segments.push("recus");
      break;

    case "RELANCE":
      if (d.factureNumero) segments.push(nettoyerSegment(d.factureNumero));
      segments.push("relances");
      break;

    case "AVIS_ECHEANCE":
      if (d.factureNumero) segments.push(nettoyerSegment(d.factureNumero));
      segments.push("echeances");
      break;
  }

  const nomFichier = `${nettoyerSegment(d.numero)}_${d.type}_v${d.version}.pdf`;
  segments.push(nomFichier);

  if (segments.length > 10) {
    throw new Error(`Chemin de stockage invalide : dépasse 10 segments (${segments.length} segments)`);
  }

  for (const s of segments) {
    if (!segmentValide(s)) {
      throw new Error(`Segment de chemin invalide : ${s}`);
    }
  }

  return segments.join("/");
}

/**
 * Chemin du PDF dans le stockage : arborescent si le contexte complet est fourni (D41),
 * sinon format historique CDC §14.2 / D11 pour rétrocompatibilité.
 */
export function cheminStockage(d: ContexteCheminStockage | ContexteCheminLegacy): string {
  if ("brancheCode" in d && "cotationNumero" in d) {
    return cheminStockageArborescent(d);
  }
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
