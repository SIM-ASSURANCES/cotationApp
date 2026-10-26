import { DECIMAL, type Operande } from "./schema";

/**
 * Écriture d'une assiette (opérande) dans une cellule de classeur, et lecture inverse (B9, D50). La grammaire :
 *   expression = NOMBRE | "texte" | CODE | OPERATION(expression ; expression ; …)
 * `120` est le nombre `{ k: "120" }` ; `"120"` est le texte « 120 » (un opérande texte qui ressemble à un nombre) ; `loyer_mensuel`
 * est un champ, une valeur intermédiaire ou un code de table ; `FOIS(loyer_mensuel; 120)` est une opération. Les arguments se
 * séparent par `;` (ou `,`). Aucune formule Excel : c'est du texte, lu par ce programme et jamais évalué par Excel.
 */

export class ErreurExpression extends Error {
  override name = "ErreurExpression";
}

/** Texte d'un opérande, tel qu'il s'écrit dans la cellule. */
export function formaterOperande(op: Operande): string {
  if (typeof op === "string") return DECIMAL.test(op) ? `"${op}"` : op;
  if (Array.isArray(op)) {
    const [tete, ...args] = op;
    return `${String(tete)}(${args.map(formaterOperande).join("; ")})`;
  }
  return op.k;
}

type Jeton = { genre: "nombre" | "texte" | "ident" | "(" | ")" | ";"; valeur: string; position: number };

function decouper(texte: string): Jeton[] {
  const jetons: Jeton[] = [];
  let i = 0;
  while (i < texte.length) {
    const c = texte[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "(" || c === ")") {
      jetons.push({ genre: c, valeur: c, position: i });
      i++;
    } else if (c === ";" || c === ",") {
      jetons.push({ genre: ";", valeur: c, position: i });
      i++;
    } else if (c === '"') {
      const fin = texte.indexOf('"', i + 1);
      if (fin < 0) throw new ErreurExpression(`guillemet fermant manquant (position ${i + 1})`);
      jetons.push({ genre: "texte", valeur: texte.slice(i + 1, fin), position: i });
      i = fin + 1;
    } else if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(texte.slice(i))!;
      jetons.push({ genre: "nombre", valeur: m[0], position: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(texte.slice(i))!;
      jetons.push({ genre: "ident", valeur: m[0], position: i });
      i += m[0].length;
    } else {
      throw new ErreurExpression(`caractère « ${c} » non admis (position ${i + 1})`);
    }
  }
  return jetons;
}

/** Lit une expression. Lève `ErreurExpression` (message en français, avec la position) si elle est mal formée. */
export function lireOperande(texte: string): Operande {
  const jetons = decouper(texte);
  if (jetons.length === 0) throw new ErreurExpression("expression vide");
  let p = 0;
  const expression = (): Operande => {
    const j = jetons[p];
    if (!j) throw new ErreurExpression("expression incomplète");
    p++;
    if (j.genre === "nombre") return { k: j.valeur };
    if (j.genre === "texte") return j.valeur;
    if (j.genre === "ident") {
      if (jetons[p]?.genre !== "(") return j.valeur;
      p++;
      const args: Operande[] = [expression()];
      while (jetons[p]?.genre === ";") {
        p++;
        args.push(expression());
      }
      if (jetons[p]?.genre !== ")") throw new ErreurExpression(`parenthèse fermante attendue après ${j.valeur}(…) (position ${(jetons[p]?.position ?? texte.length) + 1})`);
      p++;
      return [j.valeur.toUpperCase(), ...args];
    }
    throw new ErreurExpression(`« ${j.valeur} » inattendu (position ${j.position + 1})`);
  };
  const resultat = expression();
  if (p < jetons.length) throw new ErreurExpression(`« ${jetons[p].valeur} » inattendu après la fin de l'expression (position ${jetons[p].position + 1})`);
  return resultat;
}
