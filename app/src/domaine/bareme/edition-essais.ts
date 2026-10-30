import { codeValide, type Resultat } from "./edition";
import { decimalDepuisSaisie } from "./edition-tables";
import { DECIMAL, type Bareme, type JeuEssai, type Saisie } from "./schema";

/**
 * Édition des jeux d'essai à l'écran (session B5, D59). Un essai = une SAISIE (les champs comme le Commercial les remplit, les
 * garanties souscrites) + un RÉSULTAT ATTENDU TAPÉ par la Technique (montants ligne par ligne et TTC, ou message de refus).
 *
 * RÈGLE (non négociable) : ce module n'appelle jamais le moteur. L'attendu n'est jamais rempli avec le résultat du calcul : l'essai
 * deviendrait une tautologie (il ne prouverait plus rien). `essais-sans-moteur.test.ts` le vérifie sur les sources.
 */

const ok = (bareme: Bareme): Resultat => ({ ok: true, bareme });
const refus = (...messages: string[]): Resultat => ({ ok: false, refus: messages });

export type Attendu = JeuEssai["attendu"];
export type LigneAttendue = NonNullable<Attendu["lignes"]>[number];
export type ChampMontant = "nette" | "acc" | "taxe" | "ttc";
export const CHAMPS_MONTANT: readonly ChampMontant[] = ["nette", "acc", "taxe", "ttc"];
export const LIBELLE_MONTANT: Record<ChampMontant, string> = { nette: "Prime nette", acc: "Accessoires", taxe: "Taxe", ttc: "TTC" };

/** Un attendu ne dit rien s'il n'a ni refus, ni TTC total, ni aucun montant de ligne : l'essai ne vérifierait rien. */
export function attenduVide(a: Attendu): boolean {
  if (a.refus !== undefined && a.refus !== "") return false;
  if (a.ttc !== undefined) return false;
  return !(a.lignes ?? []).some((l) => CHAMPS_MONTANT.some((m) => l[m] !== undefined));
}

export type GenreAttendu = "MONTANTS" | "REFUS";
export const genreAttendu = (a: Attendu): GenreAttendu => (a.refus !== undefined ? "REFUS" : "MONTANTS");

/** Copie d'un objet sans une de ses clés. */
const sans = <T extends object>(objet: T, cle: string): T => Object.fromEntries(Object.entries(objet).filter(([k]) => k !== cle)) as T;

const essaiDe = (b: Bareme, nom: string) => b.jeuxEssai.find((e) => e.nom === nom);
const remplacer = (b: Bareme, nom: string, f: (e: JeuEssai) => JeuEssai): Bareme => ({ ...b, jeuxEssai: b.jeuxEssai.map((e) => (e.nom === nom ? f(e) : e)) });

// ---------------------------------------------------------------- Création, nom, suppression

/** Nouvel essai : saisie vide, résultat attendu VIDE (à taper). */
export function ajouterEssai(b: Bareme, nom: string): Resultat {
  const propre = nom.trim();
  if (propre === "") return refus("Donnez un nom au jeu d'essai (le cas qu'il représente).");
  if (essaiDe(b, propre)) return refus(`Un jeu d'essai s'appelle déjà « ${propre} ».`);
  return ok({ ...b, jeuxEssai: [...b.jeuxEssai, { nom: propre, entrees: { champs: {}, souscrit: [] }, attendu: {} }] });
}

export function renommerEssai(b: Bareme, ancien: string, nouveau: string): Resultat {
  const propre = nouveau.trim();
  if (propre === ancien) return ok(b);
  if (propre === "") return refus("Le nom d'un jeu d'essai ne peut pas être vide.");
  if (essaiDe(b, propre)) return refus(`Un jeu d'essai s'appelle déjà « ${propre} ».`);
  return ok(remplacer(b, ancien, (e) => ({ ...e, nom: propre })));
}

export function supprimerEssai(b: Bareme, nom: string): Resultat {
  if (!essaiDe(b, nom)) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  return ok({ ...b, jeuxEssai: b.jeuxEssai.filter((e) => e.nom !== nom) });
}

/** Copie un essai sous un nouveau nom (saisie ET attendu recopiés : à la Technique de retaper ce qui change). */
export function dupliquerEssai(b: Bareme, nom: string): Resultat {
  const source = essaiDe(b, nom);
  if (!source) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  let n = 2;
  while (essaiDe(b, `${nom} (${n})`)) n++;
  return ok({ ...b, jeuxEssai: [...b.jeuxEssai, { ...structuredClone(source), nom: `${nom} (${n})` }] });
}

// ---------------------------------------------------------------- Saisie

/**
 * Remplace la saisie d'un essai (champs, souscriptions, effectif). Les valeurs vides sont absentes. Aucune valeur n'est calculée ni
 * complétée : c'est ce que le Commercial aurait saisi.
 */
export function changerSaisie(b: Bareme, nom: string, saisie: Saisie): Resultat {
  if (!essaiDe(b, nom)) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  return ok(
    remplacer(b, nom, (e) => ({
      ...e,
      entrees: {
        champs: saisie.champs,
        souscrit: saisie.souscrit,
        ...(saisie.effectif !== undefined && Number.isInteger(saisie.effectif) && saisie.effectif >= 1 ? { effectif: saisie.effectif } : {}),
      },
    })),
  );
}

// ---------------------------------------------------------------- Résultat attendu (tapé)

const MESSAGE_MONTANT = "écrivez un nombre positif, sans lettre ni signe (virgule ou point)";

/** Vide le résultat attendu (changement de forme : montants ↔ refus). Rien n'est calculé ni conservé. */
export function viderAttendu(b: Bareme, nom: string): Resultat {
  if (!essaiDe(b, nom)) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  return ok(remplacer(b, nom, (x) => ({ ...x, attendu: {} })));
}

/** Message de refus attendu : texte que le message du moteur doit CONTENIR. Texte vide : l'attendu est vidé (le schéma refuse un refus vide). */
export function poserRefusAttendu(b: Bareme, nom: string, texte: string): Resultat {
  if (!essaiDe(b, nom)) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  return ok(remplacer(b, nom, (x) => ({ ...x, attendu: texte.trim() === "" ? {} : { refus: texte } })));
}

/** TTC total attendu, tapé. Vide : retiré. */
export function poserTtcAttendu(b: Bareme, nom: string, texte: string): Resultat {
  const e = essaiDe(b, nom);
  if (!e) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  const propre = decimalDepuisSaisie(texte);
  if (propre !== "" && !DECIMAL.test(propre)) return refus(`TTC total attendu : ${MESSAGE_MONTANT}.`);
  const reste = sans(e.attendu, "ttc");
  return ok(remplacer(b, nom, (x) => ({ ...x, attendu: { ...reste, ...(propre !== "" ? { ttc: propre } : {}) } })));
}

/** Ajoute une ligne attendue pour une garantie (ses montants sont à taper). */
export function ajouterLigneAttendue(b: Bareme, nom: string, garantie: string): Resultat {
  const e = essaiDe(b, nom);
  if (!e) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  if (!codeValide(garantie) || !b.garanties.some((g) => g.code === garantie)) return refus(`La garantie « ${garantie} » n'existe pas.`);
  if ((e.attendu.lignes ?? []).some((l) => l.g === garantie)) return refus(`Une ligne attendue existe déjà pour la garantie « ${garantie} ».`);
  return ok(remplacer(b, nom, (x) => ({ ...x, attendu: { ...x.attendu, lignes: [...(x.attendu.lignes ?? []), { g: garantie }] } })));
}

export function retirerLigneAttendue(b: Bareme, nom: string, garantie: string): Resultat {
  const e = essaiDe(b, nom);
  if (!e) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  const lignes = (e.attendu.lignes ?? []).filter((l) => l.g !== garantie);
  const reste = sans(e.attendu, "lignes");
  return ok(remplacer(b, nom, (x) => ({ ...x, attendu: { ...reste, ...(lignes.length > 0 ? { lignes } : {}) } })));
}

/** Montant tapé d'une ligne attendue. Vide : retiré (la ligne ne vérifie plus ce montant). */
export function poserMontantAttendu(b: Bareme, nom: string, garantie: string, champ: ChampMontant, texte: string): Resultat {
  const e = essaiDe(b, nom);
  if (!e) return refus(`Le jeu d'essai « ${nom} » n'existe pas.`);
  if (!(e.attendu.lignes ?? []).some((l) => l.g === garantie)) return refus(`Pas de ligne attendue pour la garantie « ${garantie} ».`);
  const propre = decimalDepuisSaisie(texte);
  if (propre !== "" && !DECIMAL.test(propre)) return refus(`${LIBELLE_MONTANT[champ]} attendu de « ${garantie} » : ${MESSAGE_MONTANT}.`);
  return ok(
    remplacer(b, nom, (x) => ({
      ...x,
      attendu: {
        ...x.attendu,
        lignes: (x.attendu.lignes ?? []).map((l) => {
          if (l.g !== garantie) return l;
          const reste = sans(l, champ);
          return propre === "" ? reste : { ...reste, [champ]: propre };
        }),
      },
    })),
  );
}
