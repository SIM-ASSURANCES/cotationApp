/**
 * Refus d'un déclencheur de la base (`RAISE EXCEPTION … USING ERRCODE = 'restrict_violation'`, SQLSTATE 23001), par exemple
 * « facture FAC-… : émise, elle ne se modifie plus ». Le pilote de Prisma classe ce code parmi les violations de clé étrangère
 * (P2003, « Foreign key constraint violated ») et le message du déclencheur n'est plus que dans
 * `meta.driverAdapterError.cause.originalMessage`. Renvoie ce message, ou `null` si l'erreur n'est pas un refus de déclencheur.
 */
export function refusDuDeclencheur(erreur: unknown): string | null {
  const e = erreur as { code?: unknown; meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown; originalMessage?: unknown } } } } | null;
  if (!e || e.code !== "P2003") return null;
  const cause = e.meta?.driverAdapterError?.cause;
  if (cause?.originalCode !== "23001" && cause?.kind !== "RestrictViolation") return null;
  return typeof cause.originalMessage === "string" && cause.originalMessage.trim() !== "" ? cause.originalMessage.trim() : null;
}
