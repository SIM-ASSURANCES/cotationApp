/**
 * Calcul différé du formulaire de cotation (D62) : après une modification, le calcul part au serveur une fois la frappe terminée
 * (anti-rebond), UNE SEULE requête à la fois, et la réponse d'une saisie dépassée est ignorée. Aucun calcul ici : `executer` appelle le
 * serveur, seule source des montants (D4). Sans React, pour être testé avec des minuteurs simulés.
 */
/** Attente après la dernière modification avant d'interroger le serveur. */
export const DELAI_CALCUL_MS = 600;

export type CalculDiffere = {
  /** Une modification a eu lieu : (re)lance le décompte ; le calcul part à son terme. */
  planifier: () => void;
  /** Calcul tout de suite (bouton « Calculer », touche Entrée). */
  maintenant: () => void;
  /** La saisie est incomplète ou l'écran se ferme : plus rien ne part, la réponse en vol sera ignorée. */
  annuler: () => void;
};

export function creerCalculDiffere<T>({
  delaiMs,
  executer,
  surResultat,
  surErreur,
  surAttente,
}: {
  delaiMs: number;
  /** Lit la saisie ACTUELLE et interroge le serveur. */
  executer: () => Promise<T>;
  surResultat: (resultat: T) => void;
  surErreur: (erreur: unknown) => void;
  /** Vrai tant qu'un calcul est attendu ou en vol. */
  surAttente: (attente: boolean) => void;
}): CalculDiffere {
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  let generation = 0; // augmente à chaque modification : une réponse d'une génération plus ancienne est périmée
  let enVol = false;
  let aRelancer = false;

  const arreterMinuteur = () => {
    if (minuteur !== null) clearTimeout(minuteur);
    minuteur = null;
  };

  const lancer = () => {
    enVol = true;
    aRelancer = false;
    const maGeneration = generation;
    surAttente(true);
    executer().then(
      (resultat) => fin(maGeneration, () => surResultat(resultat)),
      (erreur) => fin(maGeneration, () => surErreur(erreur)),
    );
  };

  const fin = (maGeneration: number, livrer: () => void) => {
    enVol = false;
    if (maGeneration === generation) livrer(); // sinon : réponse périmée, ignorée
    if (aRelancer) lancer();
    else surAttente(minuteur !== null);
  };

  const declencher = () => {
    minuteur = null;
    if (enVol) aRelancer = true; // une seule requête en vol : la suivante part à sa réponse
    else lancer();
  };

  return {
    planifier() {
      generation++;
      arreterMinuteur();
      minuteur = setTimeout(declencher, delaiMs);
      surAttente(true);
    },
    maintenant() {
      generation++;
      arreterMinuteur();
      declencher();
    },
    annuler() {
      generation++;
      arreterMinuteur();
      aRelancer = false;
      surAttente(enVol);
    },
  };
}
