import { ajouterJours, ecartEnJours, type DateIso } from "../calcul/dates";
import { ErreurCalcul } from "../calcul/montant";

/**
 * Durée d'une police en toutes lettres (`police.duree_libelle`, H39). Les deux dates sont incluses : du 01/01/2026 au
 * 31/12/2026, c'est 1 an. Règle :
 *  - la durée est EXACTE en mois civils quand le lendemain de l'échéance tombe le même quantième que la date d'effet
 *    (22/07/2026 au 21/01/2027 = 6 mois) ; un nombre de mois multiple de 12 s'écrit en années ;
 *  - sinon (mois inégal, quantième qui n'existe pas dans le mois d'arrivée…) c'est le nombre de jours couverts.
 * Années bissextiles comprises : 01/01/2028 au 31/12/2028 (366 jours) est 1 an.
 */
export function libelleDuree(dateEffet: DateIso, dateEcheance: DateIso): string {
  const jours = ecartEnJours(dateEffet, dateEcheance) + 1;
  if (jours < 1) throw new ErreurCalcul("La date d'échéance ne peut pas précéder la date d'effet.");

  const mois = moisCivilsExacts(dateEffet, ajouterJours(dateEcheance, 1));
  if (mois !== null) {
    if (mois % 12 === 0) {
      const ans = mois / 12;
      return `${ans} ${ans > 1 ? "ans" : "an"}`;
    }
    return `${mois} mois`;
  }
  return `${jours} ${jours > 1 ? "jours" : "jour"}`;
}

/** Nombre de mois entre `debut` et `fin` si les deux dates ont le même quantième, sinon null (dates déjà validées). */
function moisCivilsExacts(debut: DateIso, fin: DateIso): number | null {
  const [anneeDebut, moisDebut, jourDebut] = debut.split("-").map(Number);
  const [anneeFin, moisFin, jourFin] = fin.split("-").map(Number);
  if (jourDebut !== jourFin) return null;
  const mois = (anneeFin - anneeDebut) * 12 + (moisFin - moisDebut);
  return mois >= 1 ? mois : null;
}
