import "server-only";

import { z } from "zod";

/**
 * Configuration de l'application, lue dans les variables d'environnement
 * (fichier app/.env en développement) et validée au démarrage du serveur
 * (voir src/instrumentation.ts). Une variable manquante ou invalide arrête
 * l'application : aucune valeur par défaut silencieuse.
 */

/** Message « obligatoire » si la variable est absente ou vide, sinon le message donné. */
function messageSi(message: string) {
  return (probleme: { input?: unknown }) =>
    probleme.input === undefined || probleme.input === "" ? "obligatoire" : message;
}

const schemaConfig = z.object({
  DATABASE_URL: z
    .string({ error: messageSi("doit être une chaîne de caractères") })
    .regex(/^postgres(ql)?:\/\//, { error: messageSi("doit commencer par postgresql://") }),
  GENERATEUR_URL: z.url({
    protocol: /^https?$/,
    error: messageSi("doit être une URL http:// ou https:// valide"),
  }),
  GENERATEUR_SECRET: z
    .string({ error: messageSi("doit être une chaîne de caractères") })
    .min(32, { error: messageSi("doit contenir au moins 32 caractères") }),
});

export type Config = z.infer<typeof schemaConfig>;

export class ConfigurationInvalide extends Error {
  override name = "ConfigurationInvalide";
}

/**
 * Valide un ensemble de variables d'environnement. En cas d'erreur, lève une
 * ConfigurationInvalide qui liste TOUTES les variables en faute, sans jamais
 * reprendre leur valeur (un secret ne doit pas finir dans un journal).
 */
export function validerConfig(env: Record<string, string | undefined>): Config {
  const resultat = schemaConfig.safeParse(env);
  if (resultat.success) {
    return resultat.data;
  }

  // Un seul message par variable : le premier problème trouvé.
  const fautes = new Map<string, string>();
  for (const probleme of resultat.error.issues) {
    const variable = probleme.path.join(".");
    if (!fautes.has(variable)) {
      fautes.set(variable, probleme.message);
    }
  }

  throw new ConfigurationInvalide(
    [
      "Configuration invalide : l'application ne peut pas démarrer.",
      "Variables en faute (modèle commenté : app/.env.example) :",
      ...[...fautes].map(([variable, message]) => `  - ${variable} : ${message}`),
    ].join("\n"),
  );
}

let configValidee: Config | undefined;

/** Configuration de l'application, validée une seule fois, à la première lecture. */
export function obtenirConfig(): Config {
  configValidee ??= validerConfig(process.env);
  return configValidee;
}

/**
 * Au démarrage du serveur (src/instrumentation.ts) : valide la configuration ou
 * arrête le processus. Next.js se contente de journaliser une erreur levée au
 * démarrage, et le serveur continuerait de tourner sans configuration valide.
 */
export async function validerConfigAuDemarrage(): Promise<void> {
  try {
    obtenirConfig();
  } catch (erreur) {
    if (!(erreur instanceof ConfigurationInvalide)) {
      throw erreur;
    }
    // Attendre l'écriture complète du message avant d'arrêter (asynchrone sous Windows).
    await new Promise<void>((fin) => process.stderr.write(`${erreur.message}\n`, () => fin()));
    process.exit(1);
  }
}
