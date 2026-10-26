import { z } from "zod";

/**
 * Schéma du barème d'une version de produit (propositions-bareme.md §3, option c). Le moteur ne connaît aucun produit : champs,
 * garanties, sous-jacents, tables et jeux d'essai sont des données. Les nombres sont des textes décimaux (D3), jamais des `number`.
 */

export const VERSION_SCHEMA_BAREME = 1;

const code = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Code : minuscules, chiffres et _, commence par une lettre.");
/** Référence à une garantie (`vol`) ou à une de ses composantes (`vol.caisse`). */
const reference = z.string().regex(/^[a-z][a-z0-9_]{0,39}(\.[a-z][a-z0-9_]{0,39})?$/);
export const DECIMAL = /^\d+(\.\d+)?$/;
const decimal = z.string().regex(DECIMAL, "Nombre décimal positif écrit avec un point.");
const branche = z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,29}$/);

export const TYPES_CHAMP = ["TEXTE", "NOMBRE", "MONTANT", "DATE", "OUI_NON", "LISTE", "CHOIX_MULTIPLES"] as const;
export const OPERATIONS = ["SOMME", "FOIS", "PCT_PLAFOND", "TABLE", "PREMIER"] as const;
export const COMPARATEURS = [">", ">=", "<", "<=", "=", "!="] as const;

/** Opérande : un champ ou un intermédiaire (texte), un nombre (texte décimal ou `{k}`), ou une opération `[OP, …]`. */
export type Operande = string | { k: string } | Operande[];
const operande: z.ZodType<Operande> = z.lazy(() => z.union([z.string(), z.object({ k: decimal }).strict(), z.array(operande).min(2)]));

const conditionChamp = z.union([
  z.object({ champ: code, egal: z.string() }).strict(),
  z.object({ champ: code, different: z.string() }).strict(),
  z.object({ souscrit: reference }).strict(),
]);
export type ConditionAffichage = z.infer<typeof conditionChamp>;

const valeurListe = z.union([z.string(), z.object({ v: z.string(), l: z.string().optional() }).catchall(z.union([z.string(), z.number()]))]);

const champ = z
  .object({
    code,
    libelle: z.string().optional(),
    aide: z.string().optional(),
    type: z.enum(TYPES_CHAMP),
    bloc: code.optional(),
    obligatoire: z.boolean().optional(),
    valeurs: z.array(valeurListe).optional(),
    /** Liste dont les valeurs sont des montants : le champ se lit comme un nombre. */
    numerique: z.boolean().optional(),
    min: decimal.optional(),
    max: decimal.optional(),
    si: conditionChamp.optional(),
    surDocuments: z.boolean().optional(),
  })
  .strict();

const accessoires = z.object({ mode: z.enum(["PAR_GARANTIE", "PAR_CONTRAT", "PAR_TETE"]), montant: decimal }).strict();

const taux = z.union([
  z.object({ unite: z.enum(["PERMILLE", "POURCENT"]), fixe: decimal }).strict(),
  z.object({ unite: z.enum(["PERMILLE", "POURCENT"]), source: z.literal("E1") }).strict(),
]);

const composante = z
  .object({
    code,
    souscription: z.enum(["OBLIGATOIRE", "OPTIONNELLE"]).optional(),
    assiette: operande,
    taux,
    minimum: decimal.optional(),
    parTete: z.boolean().optional(),
  })
  .strict();

const garantie = z
  .object({
    code,
    nom: z.string().min(1),
    definition: z.string().optional(),
    afficherSurDocuments: z.boolean().optional(),
    souscription: z.enum(["OBLIGATOIRE", "OPTIONNELLE", "CONDITION"]),
    si: conditionChamp.optional(),
    taxe: branche.optional(),
    accessoires: accessoires.optional(),
    composantes: z.array(composante).min(1),
  })
  .strict();

const table = z
  .object({
    code,
    cles: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/))
      .min(1)
      .max(2),
    lignes: z.record(z.string(), decimal),
  })
  .strict();

/** Condition d'un contrôle E4 : comparaison de deux opérandes, ou condition sur un champ. */
const condition = z.union([z.tuple([z.enum(COMPARATEURS), operande, operande]), z.object({ champ: code, egal: z.string() }).strict(), z.object({ champ: code, different: z.string() }).strict()]);

const cibles = z.array(reference).min(1);
const sousJacent = z.discriminatedUnion("effet", [
  z.object({ code, effet: z.literal("E1"), table: code, cibles }).strict(),
  /** `reduction` : la valeur est un pourcentage de réduction de la prime de la garantie (cible = une garantie). */
  z.object({ code, effet: z.literal("E2"), table: code, cibles, reduction: z.boolean().optional() }).strict(),
  z.object({ code, effet: z.literal("E4"), quand: condition, message: z.string().min(1) }).strict(),
  z.object({ code, effet: z.literal("E5"), mode: z.enum(["MINIMUM", "PLAFOND", "AJOUT"]), table: code, cibles }).strict(),
]);

const jeuEssai = z
  .object({
    nom: z.string().min(1),
    entrees: z
      .object({
        champs: z.record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string())])),
        souscrit: z.array(reference).default([]),
        effectif: z.number().int().min(1).optional(),
      })
      .strict(),
    attendu: z
      .object({
        ttc: decimal.optional(),
        lignes: z.array(z.object({ g: code, nette: decimal.optional(), acc: decimal.optional(), taxe: decimal.optional(), ttc: decimal.optional() }).strict()).optional(),
        /** Cas de refus : le message du refus doit contenir ce texte. */
        refus: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const schemaBareme = z
  .object({
    schema: z.literal(VERSION_SCHEMA_BAREME),
    produit: z.object({ taxe: branche, accessoires: accessoires.optional() }).strict(),
    blocs: z.array(z.object({ code, libelle: z.string() }).strict()).default([]),
    champs: z.array(champ),
    intermediaires: z.array(z.object({ code, op: operande }).strict()).default([]),
    tables: z.array(table).default([]),
    sousJacents: z.array(sousJacent).default([]),
    garanties: z.array(garantie).min(1),
    jeuxEssai: z.array(jeuEssai).default([]),
  })
  .strict();

export type Bareme = z.output<typeof schemaBareme>;
export type Champ = Bareme["champs"][number];
export type Garantie = Bareme["garanties"][number];
export type Composante = Garantie["composantes"][number];
export type Table = Bareme["tables"][number];
export type SousJacent = Bareme["sousJacents"][number];
export type JeuEssai = Bareme["jeuxEssai"][number];
export type Condition = z.output<typeof condition>;

/** Lit un document de barème : lève une erreur de validation zod si la structure est incorrecte. */
export function lireBareme(document: unknown): Bareme {
  return schemaBareme.parse(document);
}

/** Valeur saisie d'un champ : texte (liste, montant, date…), booléen (oui/non) ou liste (choix multiples). */
export type ValeurSaisie = string | boolean | string[];

export type Saisie = {
  champs: Record<string, ValeurSaisie>;
  /** Garanties (`vol`) ou composantes (`vol.caisse`) souscrites parmi les optionnelles. */
  souscrit: string[];
  /** Effectif assuré, entier ≥ 1 : exigé s'il y a une composante ou un accessoire par tête. */
  effectif?: number;
};
