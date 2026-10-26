import { montant, type Montant } from "../calcul/montant";
import type { Contexte } from "./contexte";
import { ErreurBareme } from "./erreurs";
import type { Table } from "./schema";

/**
 * Valeur d'une table à une ou deux clés pour la saisie. Une clé absente de la table est un REFUS (A4), jamais une valeur par défaut :
 * une table complète est d'ailleurs exigée à la publication (`verifierBareme`).
 */
export function chercher(table: Table, ctx: Contexte): Montant {
  const cles = table.cles.map((spec) => ctx.cle(spec, table.code));
  const ligne = cles.join("|");
  if (!Object.hasOwn(table.lignes, ligne)) {
    const lues = table.cles.map((spec, i) => `${ctx.champ(spec.split(".")[0])?.libelle ?? spec.split(".")[0]} : « ${cles[i]} »`).join(", ");
    throw new ErreurBareme("TABLE_SANS_LIGNE", `La table « ${table.code} » n'a pas de ligne pour ${lues} : ce risque ne peut pas être tarifé.`);
  }
  return montant(table.lignes[ligne]);
}
