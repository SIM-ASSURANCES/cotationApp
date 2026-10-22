/**
 * Erreurs de la base montrées à l'utilisateur. Seuls les refus de NOS déclencheurs (`RAISE EXCEPTION` des migrations, messages écrits
 * en français pour être lus) sont affichés tels quels ; toute autre erreur de base (clé étrangère, doublon, contrainte, requête
 * invalide, connexion…) devient un message générique : le texte de PostgreSQL cite des tables, des contraintes et parfois la ligne
 * en échec, il ne doit jamais atteindre l'écran. L'erreur d'origine est journalisée par l'appelant.
 *
 * Le pilote de Prisma (adapter-pg) range le code SQLSTATE d'origine dans `meta.driverAdapterError.cause.originalCode`, avec le
 * message du déclencheur dans `originalMessage`. Nos déclencheurs se reconnaissent ainsi :
 *   - `P0001` (raise_exception, le code par défaut d'un `RAISE EXCEPTION`) : toujours un déclencheur, PostgreSQL n'en émet jamais ;
 *   - `23001` (restrict_violation) ou `23514` (check_violation), nos deux codes explicites, SEULEMENT si l'erreur ne porte ni
 *     `constraint`, ni `table`, ni `detail` : ces trois marques n'existent que sur les violations natives (clé étrangère
 *     `ON DELETE RESTRICT`, contrainte `CHECK`, qui donne la ligne en échec). Un `RAISE EXCEPTION` n'en pose aucune ; le test
 *     `declencheurs.test.ts` vérifie qu'aucune migration n'en pose, ni n'utilise un autre code.
 */

export const MESSAGE_ERREUR_BASE_GENERIQUE = "Une erreur technique est survenue : l'opération n'a pas abouti. Réessayez ; si le problème continue, contactez l'administrateur.";

/** Codes SQLSTATE de nos déclencheurs (voir ci-dessus). */
const CODES_EXPLICITES_DES_DECLENCHEURS = ["23001", "23514"];
const CODE_PAR_DEFAUT_DE_RAISE = "P0001";

type CauseDuPilote = { originalCode?: unknown; originalMessage?: unknown; constraint?: unknown; table?: unknown; detail?: unknown };

const causeDuPilote = (erreur: unknown): CauseDuPilote | null => {
  const e = erreur as { meta?: { driverAdapterError?: { cause?: CauseDuPilote } } } | null;
  return e?.meta?.driverAdapterError?.cause ?? null;
};

/** Message d'un refus de NOS déclencheurs, ou `null` pour toute autre erreur (voir le filtre ci-dessus). */
export function refusDuDeclencheur(erreur: unknown): string | null {
  const cause = causeDuPilote(erreur);
  if (!cause || typeof cause.originalMessage !== "string" || cause.originalMessage.trim() === "") return null;
  const code = cause.originalCode;
  const dOrigineNative = cause.constraint !== undefined || cause.table !== undefined || cause.detail !== undefined;
  const estNotre = code === CODE_PAR_DEFAUT_DE_RAISE || (typeof code === "string" && CODES_EXPLICITES_DES_DECLENCHEURS.includes(code) && !dOrigineNative);
  return estNotre ? cause.originalMessage.trim() : null;
}

/** Erreur de la base ou de son pilote (Prisma), quelle qu'en soit la cause. Une erreur de validation de requête (bogue du code) n'en est pas une. */
export function estErreurDeBase(erreur: unknown): boolean {
  return erreur instanceof Error && /^PrismaClient(KnownRequest|UnknownRequest|Initialization|RustPanic)Error$/.test(erreur.name);
}

/**
 * Message à afficher pour une erreur de base : celui de nos déclencheurs, sinon le message générique ; `null` si ce n'est pas une
 * erreur de base (l'appelant la laisse remonter).
 */
export function messagePourErreurDeBase(erreur: unknown): string | null {
  const refus = refusDuDeclencheur(erreur);
  if (refus) return refus;
  return estErreurDeBase(erreur) ? MESSAGE_ERREUR_BASE_GENERIQUE : null;
}
