import "server-only";

import { appelerGenerateur } from "./generateur";

/**
 * Stockage des documents émis : UNE seule interface (CDC §14.3). Aujourd'hui, le volume persistant
 * du générateur (décision D11), en ajout seul : écrire un chemin qui existe déjà est refusé. La
 * reprise sur erreur (stockage indisponible à l'émission, T14) s'ajoutera ici, en phase 5.
 */
export type Stockage = {
  /** Écrit un nouveau fichier ; renvoie son empreinte SHA-256 calculée par le stockage. */
  ecrire(chemin: string, contenu: Uint8Array): Promise<{ empreinte: string }>;
  lire(chemin: string): Promise<Uint8Array>;
  /** Archive ZIP de fichiers stockés (nom dans l'archive pour chacun). */
  zip(fichiers: { chemin: string; nom: string }[]): Promise<Uint8Array>;
};

const DELAI_MS = 60_000;

const stockageGenerateur: Stockage = {
  async ecrire(chemin, contenu) {
    const reponse = await appelerGenerateur("/interne/stockage", { chemin, contenu: Buffer.from(contenu).toString("base64") }, DELAI_MS);
    const corps = (await reponse.json()) as { empreinte: string };
    return { empreinte: corps.empreinte };
  },
  async lire(chemin) {
    const reponse = await appelerGenerateur(`/interne/stockage?chemin=${encodeURIComponent(chemin)}`, undefined, DELAI_MS);
    return new Uint8Array(await reponse.arrayBuffer());
  },
  async zip(fichiers) {
    const reponse = await appelerGenerateur("/interne/stockage/zip", { fichiers }, DELAI_MS * 5);
    return new Uint8Array(await reponse.arrayBuffer());
  },
};

let courant: Stockage = stockageGenerateur;

export const stockage = (): Stockage => courant;

/** Tests seulement : remplace le stockage (null : rétablit le vrai). */
export function remplacerStockage(s: Stockage | null): void {
  courant = s ?? stockageGenerateur;
}
