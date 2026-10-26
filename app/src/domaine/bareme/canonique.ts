/**
 * JSON canonique d'un document de barème : clés triées à tous les niveaux, aucun espace, clés `undefined` omises. Deux documents
 * de même sens donnent le même texte quel que soit l'ordre des clés (PostgreSQL `jsonb` réordonne les siennes), donc la même
 * empreinte. Le document ne contient que des textes, des booléens et des entiers (jamais de flottant : D3).
 */
export function jsonCanonique(valeur: unknown): string {
  if (valeur === null || typeof valeur !== "object") {
    if (typeof valeur === "number" && !Number.isFinite(valeur)) throw new Error("Valeur numérique non finie dans le barème.");
    return JSON.stringify(valeur);
  }
  if (Array.isArray(valeur)) return `[${valeur.map((x) => jsonCanonique(x === undefined ? null : x)).join(",")}]`;
  const objet = valeur as Record<string, unknown>;
  const cles = Object.keys(objet)
    .filter((k) => objet[k] !== undefined)
    .sort();
  return `{${cles.map((k) => `${JSON.stringify(k)}:${jsonCanonique(objet[k])}`).join(",")}}`;
}
