/**
 * Contrôle d'une archive Excel (.xlsx est un ZIP) AVANT de la charger : audit du 13/10/2026, constat B2. ExcelJS charge tout le
 * classeur en mémoire ; un fichier de 8 Mo pouvait contenir un million de lignes (1,9 Go de mémoire, 13 s de blocage) alors
 * que la limite de lignes n'était contrôlée qu'après coup. Règle PURE : on lit seulement le répertoire central du ZIP
 * (tailles déclarées, sans rien décompresser) ; ExcelJS (JSZip) refuse ensuite une entrée dont la taille réelle diffère de
 * la taille déclarée, donc une déclaration mensongère n'est pas un contournement.
 */

/** Taille décompressée maximale d'un classeur d'import : 5 000 lignes d'adhérents en font moins de 3 Mo. */
export const TAILLE_DECOMPRESSEE_MAX_XLSX = 30 * 1024 * 1024;
/** Un classeur ordinaire compte une vingtaine de parties. */
export const ENTREES_MAX_XLSX = 200;

const SIGNATURE_FIN = 0x06054b50;
const SIGNATURE_ENTREE = 0x02014b50;
const TAILLE_FIN = 22;
const COMMENTAIRE_MAX = 0xffff;

/** Problèmes de l'archive (liste vide : le chargement peut avoir lieu). Ne lève jamais d'exception. */
export function problemesArchiveXlsx(octets: Uint8Array): string[] {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const illisible = ["Fichier Excel illisible : enregistrez-le au format .xlsx (classeur Excel) et recommencez."];
  if (octets.byteLength < TAILLE_FIN) return illisible;

  // Fin du répertoire central : on remonte depuis la fin du fichier (un commentaire de 65 535 octets au plus peut la suivre).
  let fin = -1;
  for (let i = octets.byteLength - TAILLE_FIN; i >= Math.max(0, octets.byteLength - TAILLE_FIN - COMMENTAIRE_MAX); i--) {
    if (vue.getUint32(i, true) === SIGNATURE_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return illisible;

  const entrees = vue.getUint16(fin + 10, true);
  const tailleRepertoire = vue.getUint32(fin + 12, true);
  const debut = vue.getUint32(fin + 16, true);
  // ZIP64 (valeurs saturées) : inutile pour un classeur de 10 Mo au plus, et on ne saurait pas en lire les tailles.
  if (entrees === 0xffff || tailleRepertoire === 0xffffffff || debut === 0xffffffff) return illisible;
  if (entrees > ENTREES_MAX_XLSX) return ["Le fichier Excel contient trop de parties : déposez un classeur Excel ordinaire."];
  if (debut + tailleRepertoire > octets.byteLength) return illisible;

  let position = debut;
  let total = 0;
  for (let n = 0; n < entrees; n++) {
    if (position + 46 > octets.byteLength || vue.getUint32(position, true) !== SIGNATURE_ENTREE) return illisible;
    total += vue.getUint32(position + 24, true); // taille décompressée déclarée
    if (total > TAILLE_DECOMPRESSEE_MAX_XLSX) {
      return [`Le fichier Excel est trop volumineux une fois décompressé (plus de ${TAILLE_DECOMPRESSEE_MAX_XLSX / 1024 / 1024} Mo) : déposez au plus 5 000 lignes d'adhérents.`];
    }
    position += 46 + vue.getUint16(position + 28, true) + vue.getUint16(position + 30, true) + vue.getUint16(position + 32, true);
  }
  return [];
}
