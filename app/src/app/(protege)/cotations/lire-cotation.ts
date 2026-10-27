import { normaliserDateSaisie } from "@/domaine/calcul/dates";
import { normaliserMontantSaisi } from "@/domaine/calcul/montant";
import type { Assure, Beneficiaire, ContactUrgence, Risque, Souscripteur } from "@/domaine/cotation/saisie";

import { lireBeneficiaires, lireComplementsSouscripteur, lireContactsUrgence } from "../lire-complements";

/** Forme de la saisie lue dans le formulaire (le service la valide et la calcule). */
export type SaisieFormulaire = {
  id: number | null;
  codeProduit: string;
  clientId: number | null;
  /** Texte saisi ; contrôlé par le service (INDIVIDUEL, FAMILLE, GROUPE, GROUPE_OUVERT). */
  typeContrat: string;
  /** Régime de taxe (INDIVIDUEL ou GROUPE), contrôlé par le service ; vide : refusé (obligatoire). */
  regimeTaxe: string;
  souscripteur: Souscripteur;
  dateEffet: string;
  dateEcheance: string;
  nombreTranches: number;
  lignes: { codeFormule: string; effectif: number; primeForcee: string | null; accessoireValeur: string | null }[];
  motifForcage: string | null;
  assures: Assure[];
  beneficiaires: Beneficiaire[];
  contactsUrgence: ContactUrgence[];
  risque: Risque;
  /** Codes des intermédiaires choisis (session 6.0), contrôlés par le service. */
  intermediaires: string[];
  /** Produit au barème (B6a) : champs bruts du barème, convertis par le service d'après le barème publié. Absent pour les autres modes. */
  baremeBrut?: { champs: Record<string, string[]>; souscrit: string[]; effectif?: string };
};

/** Champs du barème (`bareme_<code>`), cases de souscription et effectif d'un formulaire de cotation au barème ; undefined si le formulaire n'en est pas un. */
export function lireBaremeBrut(d: FormData): SaisieFormulaire["baremeBrut"] {
  if (d.get("baremeProduit") === null) return undefined;
  const champs: Record<string, string[]> = {};
  for (const cle of new Set([...d.keys()].filter((k) => k.startsWith("bareme_")))) champs[cle.slice("bareme_".length)] = d.getAll(cle).map((v) => String(v).trim());
  const effectif = champ(d, "effectif");
  return { champs, souscrit: d.getAll("souscrit").map((v) => String(v).trim()), ...(effectif !== "" ? { effectif } : {}) };
}

const champ = (d: FormData, nom: string) => String(d.get(nom) ?? "").trim();
const colonne = (d: FormData, nom: string) => d.getAll(nom).map((v) => String(v).trim());

/**
 * Lit le formulaire de cotation (texte saisi). Aucune validation ici : elle est faite par le service,
 * avec des messages en français. Les montants (primes forcées) restent des TEXTES ; seuls les compteurs
 * (effectifs, tranches) deviennent des nombres, et un effectif illisible devient NaN, refusé ensuite.
 */
export function lireCotation(d: FormData): SaisieFormulaire {
  const lignes = [...d.keys()]
    .filter((k) => k.startsWith("eff_"))
    .map((k) => ({ code: k.slice(4), texte: champ(d, k) }))
    .filter((l) => l.texte !== "")
    .map((l) => ({
      codeFormule: l.code,
      effectif: /^\d+$/.test(l.texte) ? Number(l.texte) : Number.NaN,
      primeForcee: champ(d, `forcee_${l.code}`) ? normaliserMontantSaisi(champ(d, `forcee_${l.code}`)) : null,
      // Accessoires (H1) : vide = valeur du paramétrage.
      accessoireValeur: champ(d, `acc_${l.code}`) ? normaliserMontantSaisi(champ(d, `acc_${l.code}`)) : null,
    }));

  const [noms, naissances, sexes, liens, identifications, formules] = ["assure_nom", "assure_naissance", "assure_sexe", "assure_lien", "assure_identification", "assure_formule"].map((n) => colonne(d, n));
  const assures: Assure[] = noms
    .map((nom, i) => ({
      nom_prenoms: nom,
      date_naissance: normaliserDateSaisie(naissances[i] ?? "") as Assure["date_naissance"],
      sexe: (sexes[i] ?? "") as Assure["sexe"],
      lien: liens[i] ?? "",
      num_identification: identifications[i] ?? "",
      formule: formules[i] ?? "",
    }))
    .filter((a) => a.nom_prenoms !== "" || a.date_naissance !== "" || a.lien !== "" || a.num_identification !== "")
    .map((a, i) => ({ ordre: i + 1, ...a }));

  const [cles, valeurs] = ["risque_cle", "risque_valeur"].map((n) => colonne(d, n));
  const risque: Risque = {};
  cles.forEach((cle, i) => {
    if (cle !== "") risque[cle.toLowerCase()] = valeurs[i] ?? "";
  });

  const idTexte = champ(d, "id");
  const clientTexte = champ(d, "clientId");
  return {
    id: idTexte ? Number(idTexte) : null,
    codeProduit: champ(d, "codeProduit"),
    clientId: clientTexte ? Number(clientTexte) : null,
    typeContrat: champ(d, "typeContrat"),
    regimeTaxe: champ(d, "regimeTaxe"),
    souscripteur: {
      type: champ(d, "souscripteur_type") === "MORALE" ? "MORALE" : "PHYSIQUE",
      nom: champ(d, "souscripteur_nom"),
      prenoms: champ(d, "souscripteur_prenoms"),
      raison_sociale: champ(d, "souscripteur_raison_sociale"),
      telephone: champ(d, "souscripteur_telephone"),
      email: champ(d, "souscripteur_email"),
      adresse: champ(d, "souscripteur_adresse"),
      ...lireComplementsSouscripteur(d),
    },
    dateEffet: normaliserDateSaisie(champ(d, "dateEffet")),
    dateEcheance: normaliserDateSaisie(champ(d, "dateEcheance")),
    nombreTranches: Number(champ(d, "nombreTranches") || "1"),
    lignes,
    motifForcage: champ(d, "motifForcage") || null,
    assures,
    beneficiaires: lireBeneficiaires(d),
    contactsUrgence: lireContactsUrgence(d),
    risque,
    // Deux listes de choix « intermédiaire » : les vides sont retirés par le serveur.
    intermediaires: d.getAll("intermediaire").map((v) => String(v)),
    baremeBrut: lireBaremeBrut(d),
  };
}
