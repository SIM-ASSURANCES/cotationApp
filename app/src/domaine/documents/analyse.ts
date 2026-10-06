import { z } from "zod";

/**
 * Analyse d'un modèle Word renvoyée par le générateur (POST /interne/modeles/analyse) : des FAITS
 * (balises, emplacements, champs Word, polices). La décision est prise ici, par controles.ts.
 * Le schéma vérifie la réponse : un générateur d'une autre version ne passe pas inaperçu.
 */

const emplacement = z.object({
  partie: z.string(),
  paragraphe: z.number().int(),
  tableau: z.number().int().nullable(),
  ligne: z.number().int().nullable(),
  colonne: z.number().int().nullable(),
  extrait: z.string(),
});

export const schemaAnalyse = z.object({
  docx_valide: z.boolean(),
  erreur: z.string().nullable(),
  nombre_balises: z.number().int(),
  references: z.array(z.object({ chemin: z.string(), balise: z.string(), emplacement })),
  problemes: z.array(z.object({ code: z.string(), message: z.string(), emplacement: emplacement.nullable() })),
  champs_word: z.array(z.object({ instruction: z.string(), emplacement })),
  blocs: z.array(z.object({ nom: z.string(), cle: z.string().nullable(), emplacement })),
  filtres: z.array(z.string()),
  polices: z.array(z.string()),
  polices_absentes: z.array(z.string()).nullable(),
  textes: z.array(z.object({ texte: z.string(), emplacement })),
});

export type Analyse = z.infer<typeof schemaAnalyse>;
export type Emplacement = z.infer<typeof emplacement>;

/** « corps, tableau 1, ligne 2, colonne 1 : « {{ client.nom }} » ». */
export function decrireEmplacement(e: Emplacement): string {
  const ou = e.tableau !== null ? `tableau ${e.tableau}, ligne ${e.ligne}, colonne ${e.colonne}` : `paragraphe ${e.paragraphe}`;
  return `${e.partie}, ${ou}${e.extrait ? ` : « ${e.extrait} »` : ""}`;
}
