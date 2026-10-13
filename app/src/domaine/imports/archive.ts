import JSZip from "jszip";

/**
 * Contrôle d'une archive Excel (.xlsx est un ZIP) AVANT de la charger : audit du 13/10/2026, constat B2. ExcelJS charge tout le
 * classeur en mémoire ; un fichier de 8 Mo pouvait contenir un million de lignes (1,9 Go de mémoire, 13 s de blocage) alors
 * que la limite de lignes n'était contrôlée qu'après coup.
 *
 * JSZip (déclaré dans package.json : c'est aussi la bibliothèque qu'ExcelJS utilise) lit le répertoire central SANS rien
 * décompresser. Il n'expose pas les tailles dans son interface publique : on lit le champ interne `_data.uncompressedSize`,
 * qui existe dans toute la série 3.x. S'il disparaissait (mise à jour de JSZip), le contrôle REFUSE le fichier au lieu de le
 * laisser passer, et le test « un vrai classeur passe » échoue tout de suite. ExcelJS refuse ensuite une partie dont la taille
 * réelle diffère de la taille déclarée : une déclaration mensongère n'est pas un contournement (testé).
 */

/** Taille décompressée maximale d'un classeur d'import : 5 000 lignes d'adhérents en font moins de 3 Mo. */
export const TAILLE_DECOMPRESSEE_MAX_XLSX = 30 * 1024 * 1024;
/** Un classeur ordinaire compte une vingtaine de parties. */
export const ENTREES_MAX_XLSX = 200;

const ILLISIBLE = "Fichier Excel illisible : enregistrez-le au format .xlsx (classeur Excel) et recommencez.";

type EntreeJSZip = JSZip.JSZipObject & { _data?: { uncompressedSize?: unknown } };

/** Problèmes de l'archive (liste vide : le chargement peut avoir lieu). Ne lève jamais d'exception. */
export async function problemesArchiveXlsx(octets: Uint8Array): Promise<string[]> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(octets);
  } catch {
    return [ILLISIBLE];
  }
  const entrees = Object.values(archive.files) as EntreeJSZip[];
  if (entrees.length > ENTREES_MAX_XLSX) return ["Le fichier Excel contient trop de parties : déposez un classeur Excel ordinaire."];
  let total = 0;
  for (const entree of entrees) {
    if (entree.dir) continue;
    const taille = entree._data?.uncompressedSize;
    if (typeof taille !== "number" || !Number.isFinite(taille) || taille < 0) return [ILLISIBLE]; // échec fermé : taille illisible
    total += taille;
    if (total > TAILLE_DECOMPRESSEE_MAX_XLSX) {
      return [`Le fichier Excel est trop volumineux une fois décompressé (plus de ${TAILLE_DECOMPRESSEE_MAX_XLSX / 1024 / 1024} Mo) : déposez au plus 5 000 lignes d'adhérents.`];
    }
  }
  return [];
}
