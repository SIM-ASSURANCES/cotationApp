import { DecimalMontant, ZERO, montant, type Montant } from "../calcul/montant";
import type { Contexte } from "./contexte";
import { ErreurBareme } from "./erreurs";
import type { Evaluateur } from "./operandes";
import type { Bareme, Composante, Garantie, SousJacent } from "./schema";
import { chercher } from "./tables";
import { montantDeTranche } from "./tranches";

export type DetailComposante = { code: string; assiette: Montant; tauxApplique: Montant; prime: Montant };

export type DetailGarantie = {
  code: string;
  nom: string;
  composantes: DetailComposante[];
  /** Somme exacte des composantes souscrites, avant réduction. */
  primeComposantes: Montant;
  /** Réduction commerciale cumulée en % (0 s'il n'y en a pas). */
  reductionPourcent: Montant;
  /** Prime nette exacte de la garantie : après la réduction et le prorata, avant les accessoires. */
  primeNette: Montant;
  accessoires: Montant;
  /** Somme des assiettes des composantes souscrites (H136). */
  montantGaranti: Montant;
};

const vise = (cible: string, g: Garantie, c?: Composante): boolean => cible === g.code || (c !== undefined && cible === `${g.code}.${c.code}`);

const ciblant = <E extends SousJacent["effet"]>(b: Bareme, effet: E, g: Garantie, c?: Composante) =>
  b.sousJacents.filter((s): s is Extract<SousJacent, { effet: E }> => s.effet === effet && "cibles" in s && s.cibles.some((x) => vise(x, g, c)));

function valeurTable(b: Bareme, code: string, ctx: Contexte): Montant {
  const t = b.tables.find((x) => x.code === code);
  if (!t) throw new ErreurBareme("REFERENCE_INCONNUE", `La table « ${code} » n'existe pas.`);
  return chercher(t, ctx);
}

/**
 * Prime d'une composante, dans l'ordre du socle §6 : assiette (E3) → taux de base ou table (E1) → × coefficients (E2) → minimum
 * (fixe ou E5) → plafond (E5) → ajout (E5) → × effectif si par tête.
 */
export function calculerComposante(b: Bareme, g: Garantie, c: Composante, ctx: Contexte, ev: Evaluateur): DetailComposante {
  const nom = `${g.nom}${g.composantes.length > 1 ? ` (${c.code})` : ""}`;
  const assiette = ev.evaluer(c.assiette);
  if (assiette.lte(0)) throw new ErreurBareme("ASSIETTE_NULLE", `${nom} : l'assiette est nulle ou négative, la garantie ne peut pas être tarifée.`, undefined, g.code);

  let taux: Montant;
  if ("fixe" in c.taux) taux = montant(c.taux.fixe);
  else {
    const e1 = ciblant(b, "E1", g, c);
    if (e1.length !== 1) throw new ErreurBareme("TAUX_SANS_SOURCE", `${nom} : le taux doit venir d'un seul sous-jacent E1 (${e1.length} trouvé).`, undefined, g.code);
    taux = valeurTable(b, e1[0].table, ctx);
  }
  let prime = assiette.mul(taux).div(c.taux.unite === "PERMILLE" ? 1000 : 100);

  for (const s of ciblant(b, "E2", g, c)) if (!s.reduction) prime = prime.mul(valeurTable(b, s.table, ctx));

  const e5 = ciblant(b, "E5", g, c);
  const minimums = [...(c.minimum !== undefined ? [montant(c.minimum)] : []), ...e5.filter((s) => s.mode === "MINIMUM").map((s) => valeurTable(b, s.table, ctx))];
  for (const m of minimums) if (prime.lt(m)) prime = m;
  for (const s of e5.filter((x) => x.mode === "PLAFOND")) {
    const p = valeurTable(b, s.table, ctx);
    if (prime.gt(p)) prime = p;
  }
  for (const s of e5.filter((x) => x.mode === "AJOUT")) prime = prime.plus(valeurTable(b, s.table, ctx));

  if (c.parTete) prime = prime.mul(ctx.saisie.effectif ?? 1);
  if (prime.lte(0)) throw new ErreurBareme("PRIME_NULLE", `${nom} : la prime calculée est nulle, ce qui n'est jamais accepté en silence.`, undefined, g.code);
  return { code: c.code, assiette, tauxApplique: taux, prime };
}

export type ReglesProduit = { prorata: { actif: boolean }; jours: number };

/**
 * Prime nette d'une garantie : somme exacte de ses composantes souscrites (A6), puis réduction commerciale (E2 `reduction`), puis
 * prorata temporis (jours inclus / 365, au plus 1), puis accessoires (produit, ou ceux de la garantie qui les remplacent).
 * `contratCompte` : l'accessoire « par contrat » n'est pris qu'une fois, sur la première garantie souscrite.
 */
export function calculerGarantie(b: Bareme, g: Garantie, ctx: Contexte, ev: Evaluateur, regles: ReglesProduit, contratCompte: { fait: boolean }): DetailGarantie {
  const souscrites = g.composantes.filter((c) => ctx.composanteSouscrite(g, c.code));
  if (souscrites.length === 0) throw new ErreurBareme("AUCUNE_COMPOSANTE", `${g.nom} : aucune composante n'est souscrite.`, undefined, g.code);
  const composantes = souscrites.map((c) => calculerComposante(b, g, c, ctx, ev));
  const primeComposantes = composantes.reduce<Montant>((s, c) => s.plus(c.prime), ZERO);

  let prime = primeComposantes;
  let reductionPourcent = ZERO;
  for (const s of ciblant(b, "E2", g).filter((x) => x.reduction && x.cibles.includes(g.code))) {
    const pct = valeurTable(b, s.table, ctx);
    if (pct.gte(100)) throw new ErreurBareme("REDUCTION_TOTALE", `${g.nom} : une réduction de ${pct.toString()} % annulerait la prime.`, undefined, g.code);
    prime = prime.mul(new DecimalMontant(100).minus(pct)).div(100);
    reductionPourcent = reductionPourcent.plus(pct);
  }
  if (regles.prorata.actif) prime = prime.mul(Math.min(regles.jours, 365)).div(365);

  const acc = g.accessoires ?? b.produit.accessoires;
  let accessoires = ZERO;
  if (acc) {
    if (acc.mode === "PAR_TRANCHE") {
      const effectif = ctx.saisie.effectif ?? 1;
      const m = montantDeTranche(acc.tranches, effectif);
      if (m === undefined) throw new ErreurBareme("EFFECTIF_HORS_TRANCHES", `${g.nom} : l'effectif ${effectif} n'est dans aucune tranche d'accessoires (de 1 à ${Math.max(...acc.tranches.map((t) => t.a))}).`, undefined, g.code);
      accessoires = m;
    } else if (acc.mode === "PAR_GARANTIE") accessoires = montant(acc.montant);
    else if (acc.mode === "PAR_TETE") accessoires = montant(acc.montant).mul(ctx.saisie.effectif ?? 1);
    else if (!contratCompte.fait) {
      accessoires = montant(acc.montant);
      contratCompte.fait = true;
    }
  }
  return {
    code: g.code,
    nom: g.nom,
    composantes,
    primeComposantes,
    reductionPourcent,
    primeNette: prime,
    accessoires,
    montantGaranti: composantes.reduce<Montant>((s, c) => s.plus(c.assiette), ZERO),
  };
}
