/**
 * Numéro de police (CDC §9.4, réponse H10 de la Technique, D18). Règles pures.
 *
 * Le numéro est attribué par SIM et SAISI à la transformation de la cotation en contrat : le module ne
 * le génère jamais. Son format est contrôlé par une expression régulière paramétrable (historisée,
 * modifications journalisées). Valeur par défaut, d'après l'exemple `SCD-2026-000088-G00000`.
 *
 * Les 5 chiffres après G ou I sont le numéro PERSONNEL de chaque adhérent (réponse de la Technique, D27) : le numéro
 * du contrat garde `00000`, et le certificat d'un adhérent reprend la racine de la police mère, la même lettre, puis
 * son numéro personnel sur 5 chiffres (session 6.0, H31 et H37 fermées).
 */

export const CLE_FORMAT_NUMERO_POLICE = "police.format_numero";
export const FORMAT_NUMERO_POLICE_DEFAUT = "^[A-Z0-9]+-\\d{4}-\\d{6}-[GI]\\d{5}$";
export const LONGUEUR_MAX_NUMERO_POLICE = 60;

/** Problèmes d'une expression de format (vide si elle est acceptable). */
export function problemesFormatNumeroPolice(format: string): string[] {
  const p: string[] = [];
  if (!format.startsWith("^") || !format.endsWith("$")) p.push("Le format doit commencer par ^ et finir par $ (le numéro entier doit correspondre).");
  if (format.length > 200) p.push("Le format est trop long (200 caractères au plus).");
  try {
    new RegExp(format);
  } catch {
    p.push("Le format n'est pas une expression régulière valide.");
  }
  return p;
}

/** Normalise un numéro saisi : espaces retirés aux bords, lettres en majuscules. */
export const normaliserNumeroPolice = (saisi: string): string => saisi.trim().toUpperCase();

/** Problèmes d'un numéro saisi au regard du format en vigueur (vide s'il est conforme). */
export function problemesNumeroPolice(numero: string, format: string): string[] {
  if (numero === "") return ["Le numéro de police est obligatoire : il est attribué par SIM et saisi ici."];
  if (numero.length > LONGUEUR_MAX_NUMERO_POLICE) return [`Le numéro de police est trop long (${LONGUEUR_MAX_NUMERO_POLICE} caractères au plus).`];
  if (!new RegExp(format).test(numero)) return [`Le numéro de police « ${numero} » ne respecte pas le format attendu (${format}).`];
  return [];
}

/** Fin attendue d'un numéro de contrat : G ou I suivi de `00000` (D27). */
const FIN_CONTRAT = /[GI]00000$/;
/** Numéro découpé : racine jusqu'à la lettre G ou I comprise, puis 5 chiffres. */
const DECOUPE = /^(.+[GI])(\d{5})$/;

/**
 * Avertissement (jamais bloquant) sur un numéro de contrat qui ne se termine pas par `00000` après G ou I ; null s'il
 * est conforme ou vide. Le numéro reste accepté : SIM l'attribue, l'écran ne fait que signaler l'écart (D27).
 */
export function avertissementNumeroContrat(numero: string): string | null {
  const n = normaliserNumeroPolice(numero);
  if (n === "" || FIN_CONTRAT.test(n)) return null;
  return `Le numéro de contrat « ${n} » ne se termine pas par 00000 après G ou I : les 5 derniers chiffres sont normalement réservés aux certificats des adhérents. Vérifiez-le avant de valider (il reste accepté).`;
}

/** Racine d'un numéro de police mère (jusqu'à la lettre G ou I comprise) ; null s'il ne se termine pas par G ou I et 5 chiffres. */
export function racineCertificat(numeroPolice: string): string | null {
  return DECOUPE.exec(normaliserNumeroPolice(numeroPolice))?.[1] ?? null;
}

const messageSansRacine = (numeroPolice: string) =>
  `Le numéro de la police mère « ${numeroPolice} » ne se termine pas par G ou I suivi de 5 chiffres : le numéro du certificat ne peut pas en être dérivé.`;

/** Numéro de certificat proposé : racine de la police mère puis le numéro d'ordre de l'adhérent sur 5 chiffres ; null sans racine. */
export function numeroCertificatParDefaut(numeroPolice: string, ordre: number): string | null {
  const racine = racineCertificat(numeroPolice);
  if (racine === null || !Number.isInteger(ordre) || ordre < 1 || ordre > 99999) return null;
  return racine + String(ordre).padStart(5, "0");
}

/**
 * Problèmes d'un numéro de certificat saisi (vide s'il est conforme) : même racine et même lettre que la police mère,
 * puis 5 chiffres, et jamais `00000` (réservé au contrat). L'unicité se contrôle à part (base).
 */
export function problemesNumeroCertificat(numero: string, numeroPolice: string): string[] {
  const racine = racineCertificat(numeroPolice);
  if (racine === null) return [messageSansRacine(numeroPolice)];
  if (numero === "") return ["Le numéro du certificat est obligatoire."];
  const d = DECOUPE.exec(numero);
  if (!d || d[1] !== racine) return [`Le numéro du certificat « ${numero} » doit s'écrire ${racine} suivi du numéro personnel de l'adhérent sur 5 chiffres (ex. ${racine}00001).`];
  if (d[2] === "00000") return [`Le numéro personnel 00000 est réservé au contrat ${numeroPolice} : donnez à l'adhérent un numéro de 00001 à 99999.`];
  return [];
}
