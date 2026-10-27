import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, Champ as ChampSaisie, EnTetePage, ListeDeroulante, PastilleStatut } from "@/composants/ui";
import { PROFILS } from "@/domaine/droits";
import { exigerDroit } from "@/serveur/session";
import { listerUtilisateurs } from "@/serveur/utilisateurs";

import { creerUnUtilisateur, modifierUnUtilisateur, reinitialiserUnMotDePasse } from "./actions";

const formatDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" });

const OPTIONS_PROFILS = PROFILS.map((p) => ({ valeur: p.code, libelle: p.libelle }));

function SelectProfil({ defaut, label, ariaLabel }: { defaut?: string; label?: string; ariaLabel?: string }) {
  return <ListeDeroulante label={label} aria-label={ariaLabel} name="profil" defaultValue={defaut} options={OPTIONS_PROFILS} />;
}

const ENTETE_COLONNE = "sticky top-0 z-[1] border-b border-border bg-muted px-4 py-2 text-left font-medium text-neutral";
const CELLULE = "border-b border-border px-4 py-2 align-top text-foreground";

export default async function PageUtilisateurs() {
  const acteur = await exigerDroit("GERER_UTILISATEURS", (n) => n === "OUI");
  const utilisateurs = await listerUtilisateurs(acteur);

  return (
    <main className="space-y-6">
      <EnTetePage titre="Utilisateurs" />

      <Carte titre="Créer un utilisateur" className="max-w-md">
        <FormulaireAction action={creerUnUtilisateur} libelleBouton="Créer">
          <Champ nom="identifiant" libelle="Identifiant (3 à 64 caractères : lettres, chiffres, . _ - @)" autoComplete="off" />
          <Champ nom="nom" libelle="Nom complet" autoComplete="off" />
          <div className="mb-4">
            <SelectProfil label="Profil" defaut="COMMERCIAL" />
          </div>
          <Champ nom="motDePasse" libelle="Mot de passe provisoire" type="password" autoComplete="new-password" />
        </FormulaireAction>
      </Carte>

      {/* Les cellules portent des formulaires : tableau manuel aux classes du composant Tableau. */}
      <div tabIndex={0} role="region" aria-label="Comptes utilisateurs" className="relative overflow-auto rounded-md border border-border shadow-elevated">
        <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={ENTETE_COLONNE}>Compte</th>
              <th scope="col" className={ENTETE_COLONNE}>Modifier</th>
              <th scope="col" className={ENTETE_COLONNE}>Dernière connexion</th>
              <th scope="col" className={ENTETE_COLONNE}>Mot de passe provisoire</th>
            </tr>
          </thead>
          <tbody className="bg-surface">
            {utilisateurs.map((u) => (
              <tr key={u.id}>
                <td className={CELLULE}>
                  <strong>{u.identifiant}</strong>
                  {!u.actif ? <PastilleStatut libelle="désactivé" className="ml-2" /> : null}
                  {u.verrouille ? <PastilleStatut libelle="verrouillé" className="ml-2" /> : null}
                </td>
                <td className={CELLULE}>
                  <FormulaireAction action={modifierUnUtilisateur} garderApresSucces libelleBouton="Enregistrer" discret className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <div className="min-w-40 flex-1">
                      <ChampSaisie name="nom" defaultValue={u.nom} aria-label="Nom" required />
                    </div>
                    <div className="w-48">
                      <SelectProfil defaut={u.profil} ariaLabel={`Profil de ${u.identifiant}`} />
                    </div>
                    <label className="inline-flex min-h-10 items-center gap-2 text-sm text-foreground lg:min-h-0">
                      <input type="checkbox" name="actif" defaultChecked={u.actif} className="size-4 accent-primary" /> actif
                    </label>
                  </FormulaireAction>
                </td>
                <td className={`${CELLULE} whitespace-nowrap`}>{u.derniereConnexionLe ? formatDate.format(u.derniereConnexionLe) : "jamais"}</td>
                <td className={CELLULE}>
                  <FormulaireAction action={reinitialiserUnMotDePasse} libelleBouton="Définir" discret className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <div className="min-w-48 flex-1">
                      <ChampSaisie
                        name="motDePasse"
                        type="password"
                        autoComplete="new-password"
                        aria-label={`Mot de passe provisoire de ${u.identifiant}`}
                        required
                      />
                    </div>
                  </FormulaireAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
