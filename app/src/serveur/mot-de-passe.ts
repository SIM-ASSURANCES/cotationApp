import "server-only";

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hachage des mots de passe avec scrypt (fonction de Node.js : aucune dépendance native à
 * installer). Format stocké : « scrypt$N$r$p$sel$empreinte » ; les paramètres sont relus
 * dans l'empreinte, ce qui permet de les renforcer plus tard sans casser les comptes existants.
 */

const N = 2 ** 16; // coût processeur/mémoire : 64 Mo par hachage, de l'ordre de 150 ms
const R = 8;
const P = 1;
const TAILLE_CLE = 64;
const TAILLE_SEL = 16;

function deriver(motDePasse: string, sel: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(motDePasse.normalize("NFKC"), sel, TAILLE_CLE, options, (erreur, cle) =>
      erreur ? reject(erreur) : resolve(cle),
    );
  });
}

const maxmem = (n: number, r: number) => 256 * n * r;

export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  const sel = randomBytes(TAILLE_SEL);
  const cle = await deriver(motDePasse, sel, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return ["scrypt", N, R, P, sel.toString("base64"), cle.toString("base64")].join("$");
}

/** Vrai si le mot de passe correspond à l'empreinte ; faux pour toute empreinte illisible. */
export async function verifierMotDePasse(motDePasse: string, empreinte: string): Promise<boolean> {
  const [schema, n, r, p, sel, cle] = empreinte.split("$");
  if (schema !== "scrypt" || !n || !r || !p || !sel || !cle) {
    return false;
  }
  const attendue = Buffer.from(cle, "base64");
  const options = { N: Number(n), r: Number(r), p: Number(p) };
  if (![options.N, options.r, options.p].every(Number.isInteger) || attendue.length === 0) {
    return false;
  }
  const obtenue = await deriver(motDePasse, Buffer.from(sel, "base64"), {
    ...options,
    maxmem: maxmem(options.N, options.r),
  });
  return obtenue.length === attendue.length && timingSafeEqual(obtenue, attendue);
}

let empreinteFactice: Promise<string> | undefined;

/**
 * Fait le même travail qu'une vraie vérification quand l'identifiant n'existe pas : la durée
 * de la réponse ne révèle pas si un compte existe.
 */
export async function verifierContreEmpreinteFactice(motDePasse: string): Promise<void> {
  empreinteFactice ??= hacherMotDePasse(randomBytes(16).toString("hex"));
  await verifierMotDePasse(motDePasse, await empreinteFactice);
}
