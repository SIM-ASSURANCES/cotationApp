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
  // Adresse publique de l'application (https://domaine), base des QR codes (« URL_PUBLIQUE/verif/… »,
  // CDC §14.1, D14). Facultative tant que le domaine n'est pas connu : sans elle, aucun document
  // ne peut être émis (message clair à l'émission), le reste fonctionne.
  URL_PUBLIQUE: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url({ protocol: /^https?$/, error: "doit être une adresse http:// ou https:// (ex. https://documents.exemple.ci)" }).optional(),
  ),
  // File de tâches (phase 5, D24 : BullMQ) : adresse de Redis, avec son mot de passe
  // (redis://:MOT_DE_PASSE@hote:6379). Facultative pour l'application : sans elle, seuls l'import en masse et la
  // reprise automatique des écritures sont indisponibles (message clair). Obligatoire pour le travailleur.
  REDIS_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url({ protocol: /^rediss?$/, error: "doit être une adresse redis:// ou rediss:// (ex. redis://:mot-de-passe@redis:6379)" }).optional(),
  ),
  // Conversions LibreOffice simultanées demandées au générateur par la file de tâches (T8). Doit valoir au plus
  // CONVERSIONS_SIMULTANEES du générateur (au-delà, les demandes attendent leur tour là-bas). Défaut prudent : 2.
  CONVERSIONS_SIMULTANEES: z.preprocess(
    (v) => (v === undefined || v === "" ? "2" : v),
    z.coerce.number({ error: "doit être un nombre entier de 1 à 16" }).int({ error: "doit être un nombre entier de 1 à 16" }).min(1, { error: "doit être un nombre entier de 1 à 16" }).max(16, { error: "doit être un nombre entier de 1 à 16" }),
  ),
  // Clé de signature des sessions : Auth.js la lit lui-même, on exige sa présence au démarrage.
  AUTH_SECRET: z
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
