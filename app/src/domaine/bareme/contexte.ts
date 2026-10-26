import { dateValide } from "../calcul/dates";
import { DecimalMontant, analyserMontant, montant, type Montant } from "../calcul/montant";
import { ErreurBareme, ValeurAbsente, type Refus } from "./erreurs";
import type { Bareme, Champ, ConditionAffichage, Garantie, Saisie, ValeurSaisie } from "./schema";

type Lecture = { valeur?: ValeurSaisie; erreur?: string; absent?: string };

const nomDuChamp = (c: Champ): string => c.libelle ?? c.code;
export const codeValeur = (v: NonNullable<Champ["valeurs"]>[number]): string => (typeof v === "string" ? v : v.v);

/** Texte d'une valeur pour une comparaison ou une clé de table : OUI / NON pour un oui/non, le code pour une liste. */
export const texteDeValeur = (v: ValeurSaisie): string => (typeof v === "boolean" ? (v ? "OUI" : "NON") : Array.isArray(v) ? v.join(",") : v);

/**
 * Ce que le moteur sait d'une saisie : champs applicables (conditions d'affichage), valeurs contrôlées et normalisées, souscriptions.
 * Rien n'est lu hors de ce contexte : un champ non applicable n'a pas de valeur (`ValeurAbsente`), jamais un zéro.
 */
export class Contexte {
  private readonly champs = new Map<string, Champ>();
  private readonly lectures = new Map<string, Lecture>();
  private readonly enCours = new Set<string>();

  constructor(
    readonly bareme: Bareme,
    readonly saisie: Saisie,
  ) {
    for (const c of bareme.champs) this.champs.set(c.code, c);
  }

  champ(code: string): Champ | undefined {
    return this.champs.get(code);
  }

  private condition(si: ConditionAffichage): boolean {
    if ("souscrit" in si) return this.estSouscrit(si.souscrit);
    const v = this.lire(si.champ).valeur;
    if (v === undefined) return false;
    return "egal" in si ? texteDeValeur(v) === si.egal : texteDeValeur(v) !== si.different;
  }

  /** Condition d'un champ ou d'une garantie « selon une condition ». */
  evaluerSi(si: ConditionAffichage): boolean {
    return this.condition(si);
  }

  estActif(code: string): boolean {
    const c = this.champs.get(code);
    if (!c) return false;
    if (!c.si) return true;
    const cle = `actif:${code}`;
    if (this.enCours.has(cle)) return false;
    this.enCours.add(cle);
    try {
      return this.condition(c.si);
    } finally {
      this.enCours.delete(cle);
    }
  }

  private garantie(code: string): Garantie | undefined {
    return this.bareme.garanties.find((g) => g.code === code);
  }

  garantieSouscrite(g: Garantie): boolean {
    if (g.souscription === "OBLIGATOIRE") return true;
    if (g.souscription === "CONDITION") return g.si ? this.condition(g.si) : false;
    return this.saisie.souscrit.some((s) => s === g.code || s.startsWith(`${g.code}.`));
  }

  composanteSouscrite(g: Garantie, codeComposante: string): boolean {
    if (!this.garantieSouscrite(g)) return false;
    const c = g.composantes.find((x) => x.code === codeComposante);
    if (!c) return false;
    return c.souscription !== "OPTIONNELLE" || this.saisie.souscrit.includes(`${g.code}.${codeComposante}`);
  }

  /** `vol` (garantie) ou `vol.caisse` (composante). Référence inconnue : faux. */
  estSouscrit(ref: string): boolean {
    const [g, c] = ref.split(".");
    const garantie = this.garantie(g);
    if (!garantie) return false;
    return c === undefined ? this.garantieSouscrite(garantie) : this.composanteSouscrite(garantie, c);
  }

  /** Lecture contrôlée d'un champ : valeur normalisée, ou erreur de saisie, ou absence (champ non applicable ou facultatif vide). */
  lire(code: string): Lecture {
    const memo = this.lectures.get(code);
    if (memo) return memo;
    const c = this.champs.get(code);
    let lecture: Lecture;
    if (!c) lecture = { absent: `Le champ « ${code} » n'existe pas dans le barème.` };
    else if (!this.estActif(code)) lecture = { absent: `Le champ « ${nomDuChamp(c)} » ne s'applique pas à cette saisie.` };
    else lecture = this.controler(c, this.saisie.champs[code]);
    this.lectures.set(code, lecture);
    return lecture;
  }

  private controler(c: Champ, brut: ValeurSaisie | undefined): Lecture {
    const nom = nomDuChamp(c);
    const vide = brut === undefined || brut === "" || (Array.isArray(brut) && brut.length === 0);
    if (vide) return c.obligatoire === false ? { absent: `Le champ « ${nom} » n'est pas renseigné.` } : { erreur: `Le champ « ${nom} » est obligatoire.` };
    const erreur = (m: string): Lecture => ({ erreur: `Le champ « ${nom} » : ${m}` });
    switch (c.type) {
      case "TEXTE":
        return typeof brut === "string" && brut.trim() !== "" ? { valeur: brut.trim() } : erreur("un texte est attendu.");
      case "OUI_NON":
        return typeof brut === "boolean" ? { valeur: brut } : erreur("répondez par oui ou par non.");
      case "DATE":
        return typeof brut === "string" && /^\d{4}-\d{2}-\d{2}$/.test(brut) && dateValide(brut) ? { valeur: brut } : erreur("date invalide (AAAA-MM-JJ).");
      case "NOMBRE":
      case "MONTANT": {
        if (typeof brut !== "string") return erreur("un nombre est attendu.");
        let n: string;
        try {
          n = analyserMontant(brut);
        } catch (e) {
          return erreur(e instanceof Error ? e.message : "nombre invalide.");
        }
        if (c.min !== undefined && montant(n).lt(c.min)) return erreur(`la valeur doit être au moins ${c.min}.`);
        if (c.max !== undefined && montant(n).gt(c.max)) return erreur(`la valeur doit être au plus ${c.max}.`);
        return { valeur: n };
      }
      case "LISTE": {
        if (typeof brut !== "string") return erreur("choisissez une valeur de la liste.");
        const trouvee = (c.valeurs ?? []).map(codeValeur).find((v) => (c.numerique ? egalNumerique(v, brut) : v === brut));
        return trouvee !== undefined ? { valeur: trouvee } : erreur(`« ${brut} » n'est pas une valeur de la liste.`);
      }
      case "CHOIX_MULTIPLES": {
        if (!Array.isArray(brut)) return erreur("choisissez une ou plusieurs valeurs de la liste.");
        const permises = (c.valeurs ?? []).map(codeValeur);
        const hors = brut.find((v) => !permises.includes(v));
        return hors === undefined ? { valeur: [...brut] } : erreur(`« ${hors} » n'est pas une valeur de la liste.`);
      }
    }
  }

  /** Tous les refus de saisie : champs obligatoires, valeurs, bornes, champs ou souscriptions inconnus, effectif. */
  controlerSaisie(): Refus[] {
    const refus: Refus[] = [];
    for (const code of Object.keys(this.saisie.champs)) {
      if (!this.champs.has(code)) refus.push({ code: "CHAMP_INCONNU", message: `Le champ « ${code} » n'existe pas dans le barème de ce produit.`, champ: code });
    }
    for (const ref of this.saisie.souscrit) {
      const [g, c] = ref.split(".");
      const garantie = this.garantie(g);
      if (!garantie || (c !== undefined && !garantie.composantes.some((x) => x.code === c))) {
        refus.push({ code: "SOUSCRIPTION_INCONNUE", message: `La garantie « ${ref} » n'existe pas dans le barème de ce produit.` });
      }
    }
    for (const c of this.bareme.champs) {
      const l = this.lire(c.code);
      if (l.erreur) refus.push({ code: "SAISIE_INVALIDE", message: l.erreur, champ: c.code });
    }
    const effectif = this.saisie.effectif;
    if (effectif !== undefined && (!Number.isInteger(effectif) || effectif < 1)) {
      refus.push({ code: "EFFECTIF_INVALIDE", message: "L'effectif doit être un entier d'au moins 1." });
    } else if (effectif === undefined && this.besoinEffectif()) {
      refus.push({ code: "EFFECTIF_MANQUANT", message: "L'effectif est obligatoire : une garantie souscrite se tarife par tête." });
    }
    return refus;
  }

  private besoinEffectif(): boolean {
    return this.bareme.garanties.some(
      (g) =>
        this.garantieSouscrite(g) &&
        ((g.accessoires ?? this.bareme.produit.accessoires)?.mode === "PAR_TETE" || g.composantes.some((c) => c.parTete && this.composanteSouscrite(g, c.code))),
    );
  }

  /** Valeur numérique d'un champ. Absent ou non applicable : `ValeurAbsente`. Non numérique : erreur de définition. */
  nombre(code: string): Montant {
    const l = this.lire(code);
    if (l.absent !== undefined) throw new ValeurAbsente(code, l.absent);
    if (l.erreur !== undefined || l.valeur === undefined) throw new ErreurBareme("SAISIE_INVALIDE", l.erreur ?? `Le champ « ${code} » est invalide.`, code);
    const c = this.champs.get(code)!;
    const numerique = c.type === "MONTANT" || c.type === "NOMBRE" || (c.type === "LISTE" && c.numerique === true);
    if (!numerique || typeof l.valeur !== "string") throw new ErreurBareme("CHAMP_NON_NUMERIQUE", `Le champ « ${nomDuChamp(c)} » n'est pas un nombre : il ne peut pas servir de montant.`, code);
    return montant(l.valeur);
  }

  /** Une clé de table : `champ` (valeur choisie) ou `champ.attribut` (valeur tarifaire de la valeur choisie, ex. la classe). */
  cle(spec: string, table: string): string {
    const [code, attribut] = spec.split(".");
    const l = this.lire(code);
    const c = this.champs.get(code);
    if (l.absent !== undefined) throw new ValeurAbsente(code, l.absent);
    if (l.erreur !== undefined || l.valeur === undefined || !c) throw new ErreurBareme("SAISIE_INVALIDE", l.erreur ?? `Le champ « ${code} » est invalide.`, code);
    const texte = texteDeValeur(l.valeur);
    if (attribut === undefined) return texte;
    const entree = (c.valeurs ?? []).find((v) => codeValeur(v) === texte);
    const tarif = entree !== undefined && typeof entree !== "string" ? entree[attribut] : undefined;
    if (tarif === undefined) {
      throw new ErreurBareme("TARIF_ABSENT", `La valeur « ${texte} » du champ « ${nomDuChamp(c)} » n'a pas de « ${attribut} » : la table « ${table} » ne peut pas la lire.`, code);
    }
    return String(tarif);
  }
}

function egalNumerique(a: string, b: string): boolean {
  try {
    return new DecimalMontant(a).eq(montant(analyserMontant(b)));
  } catch {
    return false;
  }
}
