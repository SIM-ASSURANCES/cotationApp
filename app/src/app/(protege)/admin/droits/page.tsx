import { FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, EnTetePage, ListeDeroulante } from "@/composants/ui";
import { ACTIONS, NIVEAUX, PROFILS } from "@/domaine/droits";
import { lireMatrice } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { enregistrerLesDroits } from "./actions";

const OPTIONS_NIVEAUX = NIVEAUX.map((n) => ({ valeur: n.code, libelle: n.libelle }));

export default async function PageDroits() {
  await exigerDroit("GERER_UTILISATEURS", (n) => n === "OUI");
  const matrice = await lireMatrice();

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Droits par profil"
        sousTitre="Tableau du cahier des charges (§4), modifiable. Chaque changement est journalisé. L'Admin système garde toujours la gestion des utilisateurs, pour ne jamais se verrouiller hors de l'administration."
      />
      <Carte>
        <FormulaireAction action={enregistrerLesDroits} garderApresSucces libelleBouton="Enregistrer les droits">
          {/* Matrice à cases de formulaire : tableau manuel aux classes du composant Tableau (région défilante, en-tête collant). */}
          <div tabIndex={0} role="region" aria-label="Droits par profil" className="relative mb-4 max-h-[calc(100vh-18rem)] overflow-auto rounded-md border border-border shadow-elevated">
            <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 z-[1] border-b border-border bg-muted px-4 py-2 text-left font-medium text-neutral">
                    Action
                  </th>
                  {PROFILS.map((p) => (
                    <th key={p.code} scope="col" className="sticky top-0 z-[1] border-b border-border bg-muted px-4 py-2 text-left font-medium text-neutral">
                      {p.libelle}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-surface">
                {ACTIONS.map((action) => (
                  <tr key={action.code}>
                    <th scope="row" className="border-b border-border px-4 py-2 text-left font-medium text-foreground">
                      {action.libelle}
                    </th>
                    {PROFILS.map((profil) => {
                      const verrouille = profil.code === "ADMIN_SYSTEME" && action.code === "GERER_UTILISATEURS";
                      return (
                        <td key={profil.code} className="border-b border-border px-2 py-1.5">
                          <ListeDeroulante
                            name={`${profil.code}|${action.code}`}
                            defaultValue={matrice[profil.code][action.code]}
                            disabled={verrouille}
                            aria-label={`${action.libelle} : ${profil.libelle}`}
                            options={OPTIONS_NIVEAUX}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormulaireAction>
      </Carte>
    </main>
  );
}
