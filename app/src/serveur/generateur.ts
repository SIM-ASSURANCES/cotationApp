import "server-only";

import { schemaAnalyse, type Analyse } from "@/domaine/documents/analyse";

import { obtenirConfig } from "./config";
import { ErreurMetier } from "./types";

/**
 * Appels au générateur (service Python) : routes /interne, protégées par le secret partagé.
 * Les fichiers Word circulent en base64 dans du JSON ; les montants en texte, jamais en nombre.
 */

export type ImagePng = { png: Uint8Array; largeurMm: number };

export type DemandePdf = {
  modele: Uint8Array;
  donnees: Record<string, unknown>;
  seuilListe: number;
  /** Modèle d'annexe par liste longue (« assures »…). */
  annexes?: Record<string, Uint8Array>;
  /** Sous-modèles de bloc(nom, clé) : { nom: { clé: docx } }. */
  sousModeles?: Record<string, Record<string, Uint8Array>>;
  images?: Record<string, ImagePng>;
  /** QR code de vérification : le générateur le dessine à partir de l'adresse (image qr_code). */
  qr?: { url: string; largeurMm?: number };
  /** PDF ajoutés à la fin, dans l'ordre (CS, puis CG : CDC §6.8). */
  piecesJointes?: Uint8Array[];
  /** Texte en diagonale sur chaque page (« EXPIRÉE », « APERÇU »). */
  filigrane?: string;
  /** Listes toujours renvoyées en annexe, même sous le seuil (police de groupe : « assures », CDC §10.2). */
  listesEnAnnexe?: string[];
};

export type ClientGenerateur = {
  analyser(modele: Uint8Array): Promise<Analyse>;
  genererPdf(demande: DemandePdf): Promise<Uint8Array>;
};

/** Le générateur a refusé la demande (message lisible) ou ne répond pas. */
export class ErreurGenerateur extends ErreurMetier {
  override name = "ErreurGenerateur";
}

const DELAI_ANALYSE_MS = 60_000;
const DELAI_PDF_MS = 180_000;

const base64 = (octets: Uint8Array): string => Buffer.from(octets).toString("base64");
const enBase64 = <T,>(table: Record<string, T>, f: (v: T) => unknown) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, f(v)]));

/**
 * Appel d'une route /interne du générateur (POST avec un corps JSON, ou GET sans corps). Un refus
 * expliqué (422, 409, 404) devient une ErreurGenerateur au message lisible.
 */
export async function appelerGenerateur(chemin: string, corps: unknown, delaiMs: number): Promise<Response> {
  const config = obtenirConfig();
  let reponse: Response;
  try {
    reponse = await fetch(new URL(chemin, config.GENERATEUR_URL), {
      method: corps === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Generateur-Secret": config.GENERATEUR_SECRET },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(delaiMs),
      cache: "no-store",
    });
  } catch (erreur) {
    console.error(`[generateur] ${chemin} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    throw new ErreurGenerateur("Le générateur de documents ne répond pas : réessayez dans un instant, ou prévenez l'administrateur.");
  }
  if (reponse.ok) return reponse;
  // 422 : refus expliqué par le générateur (donnée absente, modèle invalide…), affiché tel quel.
  const detail = await reponse
    .json()
    .then((j: unknown) => (typeof j === "object" && j !== null && "detail" in j && typeof j.detail === "string" ? j.detail : null))
    .catch(() => null);
  console.error(`[generateur] ${chemin} : HTTP ${reponse.status}${detail ? ` (${detail})` : ""}`);
  if (reponse.status === 422 && detail) {
    throw new ErreurGenerateur(`Génération impossible : ${detail}.`);
  }
  if ((reponse.status === 409 || reponse.status === 404) && detail) {
    throw new ErreurGenerateur(`Stockage : ${detail}.`);
  }
  throw new ErreurGenerateur(
    reponse.status === 504
      ? "La conversion en PDF a pris trop de temps et a été interrompue."
      : "Le générateur de documents a rencontré une erreur : réessayez, ou prévenez l'administrateur.",
  );
}

const clientHttp: ClientGenerateur = {
  async analyser(modele) {
    const reponse = await appelerGenerateur("/interne/modeles/analyse", { modele: base64(modele) }, DELAI_ANALYSE_MS);
    const lu = schemaAnalyse.safeParse(await reponse.json());
    if (!lu.success) {
      console.error(`[generateur] analyse : réponse inattendue (${lu.error.message})`);
      throw new ErreurGenerateur("Réponse inattendue du générateur : versions de l'application et du générateur incompatibles ?");
    }
    return lu.data;
  },
  async genererPdf(d) {
    const reponse = await appelerGenerateur(
      "/interne/documents/pdf",
      {
        modele: base64(d.modele),
        donnees: d.donnees,
        seuil_liste: d.seuilListe,
        annexes: enBase64(d.annexes ?? {}, base64),
        sous_modeles: enBase64(d.sousModeles ?? {}, (parCle) => enBase64(parCle, base64)),
        images: enBase64(d.images ?? {}, (i) => ({ png: base64(i.png), largeur_mm: i.largeurMm })),
        qr: d.qr ? { url: d.qr.url, largeur_mm: d.qr.largeurMm ?? 25 } : null,
        pieces_jointes: (d.piecesJointes ?? []).map(base64),
        filigrane: d.filigrane ?? null,
        listes_en_annexe: d.listesEnAnnexe ?? [],
      },
      DELAI_PDF_MS,
    );
    return new Uint8Array(await reponse.arrayBuffer());
  },
};

let clientCourant: ClientGenerateur = clientHttp;

export const generateur = (): ClientGenerateur => clientCourant;

/** Tests seulement : remplace le générateur par un double (null : rétablit le vrai). */
export function remplacerGenerateur(client: ClientGenerateur | null): void {
  clientCourant = client ?? clientHttp;
}
