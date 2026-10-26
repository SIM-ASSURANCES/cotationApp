/** Refus du barème : un message en français qui nomme le champ, la table ou la garantie en cause. */
export type Refus = { code: string; message: string; champ?: string; garantie?: string };

/** Problème trouvé dans la définition d'un barème (`verifierBareme`). */
export type Probleme = { code: string; message: string };

/** Erreur interne d'un calcul ; `calculerBareme` la convertit en `Refus`. */
export class ErreurBareme extends Error {
  override name = "ErreurBareme";
  constructor(
    public readonly code: string,
    message: string,
    public readonly champ?: string,
    public readonly garantie?: string,
  ) {
    super(message);
  }
  versRefus(): Refus {
    return { code: this.code, message: this.message, ...(this.champ ? { champ: this.champ } : {}), ...(this.garantie ? { garantie: this.garantie } : {}) };
  }
}

/** Valeur d'un champ qui n'existe pas dans la saisie (champ non applicable) : seule `PREMIER` la saute. */
export class ValeurAbsente extends ErreurBareme {
  override name = "ValeurAbsente";
  constructor(champ: string, message: string) {
    super("VALEUR_ABSENTE", message, champ);
  }
}
