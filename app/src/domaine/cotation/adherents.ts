import { dateValide, type DateIso } from "../calcul/dates";
import { problemesAssures, NOMBRE_MAX_ASSURES, type Assure } from "./saisie";

/**
 * Contrats de groupe (CDC §10.2, D22). Les adhérents d'une police de groupe sont ses `assures[]`.
 * La liste évolue par VERSIONS (incorporation, retrait) : une version n'est jamais modifiée, la liste
 * courante est celle de la dernière version. Le numéro d'ordre (`ordre`) d'un adhérent ne change jamais
 * et n'est jamais réutilisé : il identifie l'adhérent dans le certificat et dans l'historique.
 */

export const TYPES_CONTRAT_GROUPE = ["GROUPE", "GROUPE_OUVERT"] as const;

/** Police mère : contrat de groupe (CDC §10.2). INDIVIDUEL et FAMILLE n'ont pas d'adhérents. */
export const estContratDeGroupe = (typeContrat: string | null): boolean => (TYPES_CONTRAT_GROUPE as readonly string[]).includes(typeContrat ?? "");

export const MOTIFS_ADHERENTS = ["INITIALE", "INCORPORATION", "RETRAIT"] as const;
export type MotifAdherents = (typeof MOTIFS_ADHERENTS)[number];

export const LIBELLE_MOTIF_ADHERENTS: Record<MotifAdherents, string> = {
  INITIALE: "Liste initiale",
  INCORPORATION: "Incorporation",
  RETRAIT: "Retrait",
};

/** Une version de la liste des adhérents d'une police. */
export type VersionAdherents = {
  numero: number;
  motif: MotifAdherents;
  /** Date à laquelle le changement prend effet (incorporation, retrait). */
  dateEffet: DateIso;
  /** Liste COMPLÈTE après ce changement. */
  adherents: Assure[];
  /** Ordres des adhérents ajoutés ou retirés par cette version. */
  concernes: number[];
};

export type Periode = { dateEffet: DateIso; dateEcheance: DateIso };

/** Date d'un changement : dans la période de la police et jamais avant le changement précédent. */
export function problemesDateChangement(dateEffet: DateIso, police: Periode, derniere: DateIso): string[] {
  if (!dateValide(dateEffet)) return ["Date d'effet du changement invalide (AAAA-MM-JJ)."];
  const p: string[] = [];
  if (dateEffet < police.dateEffet || dateEffet > police.dateEcheance) {
    p.push(`La date d'effet du changement doit être comprise entre le ${police.dateEffet} et le ${police.dateEcheance} (période de la police).`);
  }
  if (dateEffet < derniere) p.push(`La date d'effet du changement ne peut pas précéder le dernier changement (${derniere}).`);
  return p;
}

/**
 * Incorporation : les nouveaux adhérents reçoivent les numéros d'ordre qui suivent le plus grand
 * numéro JAMAIS attribué (retirés compris). Renvoie la nouvelle liste complète, ou les problèmes.
 */
export function incorporer(
  courants: readonly Assure[],
  dejaAttribues: readonly number[],
  nouveaux: readonly Omit<Assure, "ordre">[],
  codesFormules: readonly string[],
  aujourdhui: DateIso,
): { liste: Assure[]; ordres: number[] } | { problemes: string[] } {
  if (nouveaux.length === 0) return { problemes: ["Indiquez au moins un adhérent à incorporer."] };
  let prochain = Math.max(0, ...dejaAttribues, ...courants.map((a) => a.ordre)) + 1;
  const ajoutes: Assure[] = nouveaux.map((n) => ({ ...n, ordre: prochain++ }));
  const liste = [...courants, ...ajoutes];
  const problemes = problemesAssures(ajoutes, codesFormules, aujourdhui);
  if (liste.length > NOMBRE_MAX_ASSURES) problemes.push(`Au plus ${NOMBRE_MAX_ASSURES} adhérents par police.`);
  if (problemes.length > 0) return { problemes };
  return { liste, ordres: ajoutes.map((a) => a.ordre) };
}

/** Retrait : les ordres doivent exister dans la liste courante ; elle ne peut pas devenir vide. */
export function retirer(courants: readonly Assure[], ordres: readonly number[]): { liste: Assure[]; ordres: number[] } | { problemes: string[] } {
  const uniques = [...new Set(ordres)];
  if (uniques.length === 0) return { problemes: ["Indiquez au moins un adhérent à retirer."] };
  const inconnus = uniques.filter((o) => !courants.some((a) => a.ordre === o));
  if (inconnus.length > 0) return { problemes: [`Adhérent(s) introuvable(s) dans la liste courante : n° ${inconnus.join(", ")}.`] };
  const liste = courants.filter((a) => !uniques.includes(a.ordre));
  if (liste.length === 0) return { problemes: ["Le retrait de tous les adhérents n'est pas possible ici : la police doit garder au moins un adhérent."] };
  return { liste, ordres: uniques.sort((a, b) => a - b) };
}

/**
 * Date d'effet de l'adhésion d'un adhérent : celle de la version qui l'a fait entrer (la date d'effet
 * de la police pour la liste initiale).
 */
export function dateAdhesion(versions: readonly VersionAdherents[], ordre: number, dateEffetPolice: DateIso): DateIso | null {
  for (const v of [...versions].sort((a, b) => a.numero - b.numero)) {
    if (v.adherents.some((a) => a.ordre === ordre)) return v.motif === "INITIALE" ? dateEffetPolice : v.dateEffet;
  }
  return null;
}
