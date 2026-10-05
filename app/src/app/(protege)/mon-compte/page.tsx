import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { MOT_DE_PASSE_LONGUEUR_MIN } from "@/domaine/securite";
import { exigerUtilisateur } from "@/serveur/session";

import { changerSonMotDePasse } from "./actions";

export default async function MonCompte() {
  const utilisateur = await exigerUtilisateur({ autoriserChangementMotDePasse: true });
  return (
    <main className="max-w-md">
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">Mon compte</h1>
      <p className="mb-6 text-sm text-zinc-700">
        {utilisateur.nom} ({utilisateur.identifiant}), profil {utilisateur.libelleProfil}.
      </p>
      {utilisateur.doitChangerMotDePasse ? (
        <p role="status" className="mb-4 rounded border border-sim-ciel bg-surface p-3 text-sm">
          Votre mot de passe a été défini par un administrateur : choisissez-en un nouveau pour continuer.
        </p>
      ) : null}
      <h2 className="mb-3 text-lg font-semibold">Changer de mot de passe</h2>
      <FormulaireAction action={changerSonMotDePasse} libelleBouton="Enregistrer">
        <Champ nom="actuel" libelle="Mot de passe actuel" type="password" autoComplete="current-password" />
        <Champ nom="nouveau" libelle="Nouveau mot de passe" type="password" autoComplete="new-password" />
        <Champ nom="confirmation" libelle="Confirmation" type="password" autoComplete="new-password" />
        <p className="mb-4 text-xs text-zinc-600">
          Au moins {MOT_DE_PASSE_LONGUEUR_MIN} caractères : une phrase de passe courte à retenir, sans votre identifiant.
        </p>
      </FormulaireAction>
    </main>
  );
}
