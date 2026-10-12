import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Carte, EnTetePage } from "@/composants/ui";
import { MOT_DE_PASSE_LONGUEUR_MIN } from "@/domaine/securite";
import { exigerUtilisateur } from "@/serveur/session";

import { changerSonMotDePasse } from "./actions";

export default async function MonCompte() {
  const utilisateur = await exigerUtilisateur({ autoriserChangementMotDePasse: true });
  return (
    <main className="space-y-6">
      <EnTetePage titre="Mon compte" sousTitre={`${utilisateur.nom} (${utilisateur.identifiant}), profil ${utilisateur.libelleProfil}.`} />
      {utilisateur.doitChangerMotDePasse ? (
        <Bandeau ton="info" role="status" className="max-w-md">
          Votre mot de passe a été défini par un administrateur : choisissez-en un nouveau pour continuer.
        </Bandeau>
      ) : null}
      <Carte titre="Changer de mot de passe" className="max-w-md">
        <FormulaireAction action={changerSonMotDePasse} libelleBouton="Enregistrer">
          <Champ nom="actuel" libelle="Mot de passe actuel" type="password" autoComplete="current-password" />
          <Champ nom="nouveau" libelle="Nouveau mot de passe" type="password" autoComplete="new-password" />
          <Champ nom="confirmation" libelle="Confirmation" type="password" autoComplete="new-password" />
          <p className="mb-4 text-xs text-muted-foreground">
            Au moins {MOT_DE_PASSE_LONGUEUR_MIN} caractères : une phrase de passe courte à retenir, sans votre identifiant.
          </p>
        </FormulaireAction>
      </Carte>
    </main>
  );
}
