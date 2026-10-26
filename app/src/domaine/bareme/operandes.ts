import { ZERO, montant, type Montant } from "../calcul/montant";
import type { Contexte } from "./contexte";
import { ErreurBareme, ValeurAbsente } from "./erreurs";
import { DECIMAL, type Operande } from "./schema";
import { chercher } from "./tables";

/**
 * Évaluation des assiettes (E3) : sept opérations fermées, aucune formule libre (propositions-bareme.md §6). Une valeur de champ
 * absente ou non applicable lève `ValeurAbsente`, que seule `PREMIER` sait sauter ; ailleurs c'est un refus.
 */
export class Evaluateur {
  private readonly intermediaires = new Map<string, Montant>();
  private readonly enCours = new Set<string>();

  constructor(private readonly ctx: Contexte) {}

  valeurIntermediaire(code: string): Montant {
    const memo = this.intermediaires.get(code);
    if (memo) return memo;
    const def = this.ctx.bareme.intermediaires.find((i) => i.code === code);
    if (!def) throw new ErreurBareme("REFERENCE_INCONNUE", `La valeur intermédiaire « ${code} » n'existe pas.`);
    if (this.enCours.has(code)) throw new ErreurBareme("CYCLE", `La valeur intermédiaire « ${code} » se calcule à partir d'elle-même.`);
    this.enCours.add(code);
    try {
      const v = this.evaluer(def.op);
      this.intermediaires.set(code, v);
      return v;
    } finally {
      this.enCours.delete(code);
    }
  }

  evaluer(op: Operande): Montant {
    if (typeof op === "string") {
      if (DECIMAL.test(op)) return montant(op);
      if (this.ctx.bareme.intermediaires.some((i) => i.code === op)) return this.valeurIntermediaire(op);
      return this.ctx.nombre(op);
    }
    if (!Array.isArray(op)) return montant(op.k);
    const [tete, ...args] = op;
    switch (tete) {
      case "SOMME":
        return args.reduce<Montant>((s, a) => s.plus(this.evaluer(a)), ZERO);
      case "FOIS":
        return this.evaluer(args[0]).mul(this.evaluer(args[1]));
      case "PCT_PLAFOND":
        return plusPetit(this.evaluer(args[0]).mul(this.evaluer(args[1])).div(100), this.evaluer(args[2]));
      case "TABLE": {
        const code = args[0];
        const table = typeof code === "string" ? this.ctx.bareme.tables.find((t) => t.code === code) : undefined;
        if (!table) throw new ErreurBareme("REFERENCE_INCONNUE", `La table « ${String(code)} » n'existe pas.`);
        return chercher(table, this.ctx);
      }
      case "PREMIER": {
        for (const a of args) {
          try {
            return this.evaluer(a);
          } catch (e) {
            if (!(e instanceof ValeurAbsente)) throw e;
          }
        }
        throw new ErreurBareme("AUCUNE_VALEUR", "Aucune des valeurs possibles de ce montant n'est renseignée.");
      }
      default:
        throw new ErreurBareme("OPERATION_INCONNUE", `Opération inconnue : « ${String(tete)} ».`);
    }
  }
}

const plusPetit = (a: Montant, b: Montant): Montant => (a.lte(b) ? a : b);
