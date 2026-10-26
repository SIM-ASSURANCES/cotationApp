import { composerBareme, calculerBareme, type ParametresBareme } from "./bareme";
import { ErreurBareme } from "./erreurs";
import type { Bareme } from "./schema";

/** Un écart entre ce qu'un jeu d'essai attend et ce que le barème calcule. */
export type Ecart = { essai: string; ligne?: string; champ: string; attendu: string; obtenu: string };

/**
 * Rejoue les jeux d'essai d'un barème : calcul, puis `composer()` (taxe, arrondi du produit, TTC), puis comparaison ligne à ligne.
 * La publication d'un barème est refusée si cette liste n'est pas vide (décision 9).
 */
export function rejouerJeuxEssai(bareme: Bareme, parametres: ParametresBareme): Ecart[] {
  const ecarts: Ecart[] = [];
  for (const essai of bareme.jeuxEssai) {
    const ecart = (champ: string, attendu: string, obtenu: string, ligne?: string) => ecarts.push({ essai: essai.nom, champ, attendu, obtenu, ...(ligne ? { ligne } : {}) });
    const { champs, souscrit, effectif } = essai.entrees;
    const r = calculerBareme(bareme, { champs, souscrit, ...(effectif !== undefined ? { effectif } : {}) }, parametres);
    const { attendu } = essai;
    if (attendu.refus !== undefined) {
      if (r.ok) ecart("refus", attendu.refus, "aucun refus");
      else if (!r.refus.some((x) => x.message.includes(attendu.refus!))) ecart("refus", attendu.refus, r.refus.map((x) => x.message).join(" | "));
      continue;
    }
    if (!r.ok) {
      ecart("refus", "aucun refus", r.refus.map((x) => x.message).join(" | "));
      continue;
    }
    let montants;
    try {
      montants = composerBareme(r.lignes, parametres);
    } catch (e) {
      if (e instanceof ErreurBareme) {
        ecart("composition", "calculable", e.message);
        continue;
      }
      throw e;
    }
    for (const a of attendu.lignes ?? []) {
      const i = r.detail.findIndex((d) => d.code === a.g);
      if (i < 0) {
        ecart("ligne", "présente", "absente", a.g);
        continue;
      }
      const obtenu = montants.lignes[i].arrondi;
      for (const [champ, valeur, vu] of [["nette", a.nette, obtenu.nette], ["accessoires", a.acc, obtenu.accessoires], ["taxe", a.taxe, obtenu.taxe], ["ttc", a.ttc, obtenu.ttc]] as const) {
        if (valeur !== undefined && !vu.eq(valeur)) ecart(champ, valeur, vu.toFixed(), a.g);
      }
    }
    if (attendu.ttc !== undefined && !montants.totaux.arrondi.ttc.eq(attendu.ttc)) ecart("ttc total", attendu.ttc, montants.totaux.arrondi.ttc.toFixed());
  }
  return ecarts;
}
