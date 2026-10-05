/** Résultat d'une action de formulaire : un message d'erreur ou de réussite à afficher. */
export type EtatFormulaire = { erreur?: string; succes?: string };

/** Action de formulaire (Server Action) telle que la reçoivent les composants. */
export type ActionFormulaire = (etat: EtatFormulaire, donnees: FormData) => Promise<EtatFormulaire>;
