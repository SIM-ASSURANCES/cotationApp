import { ErreurCalcul } from "./montant";

/**
 * Dates « civiles » en texte ISO (AAAA-MM-JJ), sans heure ni fuseau : une date d'effet ne doit
 * jamais glisser d'un jour selon le fuseau horaire de la machine.
 */
export type DateIso = string;

const MS_PAR_JOUR = 86_400_000;

function enUtc(date: DateIso): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m) {
    const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = Date.UTC(annee, mois - 1, jour);
    const d = new Date(t);
    if (d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour) {
      return t;
    }
  }
  throw new ErreurCalcul(`Date invalide : « ${date} » (format attendu : AAAA-MM-JJ).`);
}

export function dateValide(date: string): boolean {
  try {
    enUtc(date);
    return true;
  } catch {
    return false;
  }
}

/** Nombre de jours entre deux dates (positif si `fin` est après `debut`). */
export function ecartEnJours(debut: DateIso, fin: DateIso): number {
  return Math.round((enUtc(fin) - enUtc(debut)) / MS_PAR_JOUR);
}

/** Ajoute des mois en gardant le jour, ou le dernier jour du mois s'il n'existe pas (31 janvier + 1 mois = 28 ou 29 février). */
export function ajouterMois(date: DateIso, mois: number): DateIso {
  const t = new Date(enUtc(date));
  const jour = t.getUTCDate();
  const cible = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + mois, 1));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernierJour));
  return cible.toISOString().slice(0, 10);
}

/** Ajoute (ou retire, si négatif) un nombre de jours. */
export function ajouterJours(date: DateIso, jours: number): DateIso {
  return new Date(enUtc(date) + jours * MS_PAR_JOUR).toISOString().slice(0, 10);
}

export const FUSEAU_ABIDJAN = "Africa/Abidjan";

const formateurAbidjan = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_ABIDJAN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Date du jour dans le fuseau de la compagnie (Africa/Abidjan, UTC+0 sans heure d'été), en AAAA-MM-JJ. */
export function aujourdhui(maintenant: Date = new Date()): DateIso {
  const parties = formateurAbidjan.formatToParts(maintenant);
  const annee = parties.find((p) => p.type === "year")?.value ?? "";
  const mois = parties.find((p) => p.type === "month")?.value ?? "";
  const jour = parties.find((p) => p.type === "day")?.value ?? "";
  return `${annee}-${mois}-${jour}`;
}

/** Affiche une date ISO (AAAA-MM-JJ) au format français JJ/MM/AAAA, ou « — » si absente. */
export function formaterDate(date: DateIso | null | undefined): string {
  if (!date) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return date;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Accepte une saisie en JJ/MM/AAAA ou AAAA-MM-JJ et la renvoie en AAAA-MM-JJ (ou telle quelle si non reconnue). */
export function normaliserDateSaisie(texte: string): string {
  const propre = texte.trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(propre);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return propre;
}

export const MESSAGE_DATE_EFFET_PASSEE = "La date d'effet ne peut pas être antérieure à aujourd'hui.";

let dateMinimumEffetTest: DateIso | null = null;

/** Réservé aux suites de tests rejouant des cas historiques du CDC (2026) : surcharge la date minimale d'effet. */
export function fixerDateMinimumEffetPourTests(date: DateIso | null): void {
  dateMinimumEffetTest = date;
}

export function dateMinimumEffetCotation(maintenant?: Date): DateIso {
  return dateMinimumEffetTest ?? aujourdhui(maintenant);
}

/**
 * D37 / H107 : la date d'effet d'une cotation (création, modification, renouvellement) ne peut pas être
 * antérieure à aujourd'hui (fuseau Africa/Abidjan). Seule la saisie est contrôlée : une cotation existante
 * dont la date d'effet est passée n'est pas bloquée à la soumission, validation ou émission.
 */
export function problemesDateEffetCotation(dateEffet: DateIso, dateDuJour: DateIso = dateMinimumEffetCotation()): string[] {
  if (!dateValide(dateEffet) || !dateValide(dateDuJour)) return [];
  return dateEffet < dateDuJour ? [MESSAGE_DATE_EFFET_PASSEE] : [];
}
