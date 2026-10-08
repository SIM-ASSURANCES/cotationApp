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
