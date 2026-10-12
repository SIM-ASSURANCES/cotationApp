import { FormulaireAction } from "@/composants/FormulaireAction";
import { ACTIONS, NIVEAUX, PROFILS } from "@/domaine/droits";
import { lireMatrice } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { enregistrerLesDroits } from "./actions";

export default async function PageDroits() {
  await exigerDroit("GERER_UTILISATEURS", (n) => n === "OUI");
  const matrice = await lireMatrice();

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Droits par profil</h1>
      <p className="mb-6 max-w-3xl text-sm text-neutral">
        Tableau du cahier des charges (§4), modifiable. Chaque changement est journalisé. L'Admin système garde
        toujours la gestion des utilisateurs, pour ne jamais se verrouiller hors de l'administration.
      </p>
      <FormulaireAction action={enregistrerLesDroits} libelleBouton="Enregistrer les droits">
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[60rem] border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-left text-primary-foreground">
                <th className="p-2">Action</th>
                {PROFILS.map((p) => (
                  <th key={p.code} className="p-2">
                    {p.libelle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map((action) => (
                <tr key={action.code} className="border-b border-border">
                  <th scope="row" className="p-2 text-left font-medium">
                    {action.libelle}
                  </th>
                  {PROFILS.map((profil) => {
                    const verrouille = profil.code === "ADMIN_SYSTEME" && action.code === "GERER_UTILISATEURS";
                    return (
                      <td key={profil.code} className="p-1">
                        <select
                          name={`${profil.code}|${action.code}`}
                          defaultValue={matrice[profil.code][action.code]}
                          disabled={verrouille}
                          aria-label={`${action.libelle} : ${profil.libelle}`}
                          className="w-full rounded border border-border bg-surface px-1 py-1 disabled:bg-neutral-bg"
                        >
                          {NIVEAUX.map((n) => (
                            <option key={n.code} value={n.code}>
                              {n.libelle}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormulaireAction>
    </main>
  );
}
