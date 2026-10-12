import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { PROFILS } from "@/domaine/droits";
import { exigerDroit } from "@/serveur/session";
import { listerUtilisateurs } from "@/serveur/utilisateurs";

import { creerUnUtilisateur, modifierUnUtilisateur, reinitialiserUnMotDePasse } from "./actions";

const formatDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" });

function SelectProfil({ defaut }: { defaut?: string }) {
  return (
    <select name="profil" defaultValue={defaut} className="rounded border border-border bg-surface px-2 py-1">
      {PROFILS.map((p) => (
        <option key={p.code} value={p.code}>
          {p.libelle}
        </option>
      ))}
    </select>
  );
}

export default async function PageUtilisateurs() {
  const acteur = await exigerDroit("GERER_UTILISATEURS", (n) => n === "OUI");
  const utilisateurs = await listerUtilisateurs(acteur);

  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold text-primary">Utilisateurs</h1>

      <section className="mb-10 max-w-md rounded border border-border bg-muted p-5">
        <h2 className="mb-3 text-lg font-semibold">Créer un utilisateur</h2>
        <FormulaireAction action={creerUnUtilisateur} libelleBouton="Créer">
          <Champ nom="identifiant" libelle="Identifiant (3 à 64 caractères : lettres, chiffres, . _ - @)" autoComplete="off" />
          <Champ nom="nom" libelle="Nom complet" autoComplete="off" />
          <label className="mb-4 block text-sm font-medium">
            Profil
            <span className="mt-1 block">
              <SelectProfil defaut="COMMERCIAL" />
            </span>
          </label>
          <Champ nom="motDePasse" libelle="Mot de passe provisoire" type="password" autoComplete="new-password" />
        </FormulaireAction>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-left text-primary-foreground">
              <th className="p-2">Compte</th>
              <th className="p-2">Modifier</th>
              <th className="p-2">Dernière connexion</th>
              <th className="p-2">Mot de passe provisoire</th>
            </tr>
          </thead>
          <tbody>
            {utilisateurs.map((u) => (
              <tr key={u.id} className="border-b border-border align-top">
                <td className="p-2">
                  <strong>{u.identifiant}</strong>
                  {!u.actif ? <span className="ml-2 rounded bg-neutral-bg px-1 text-xs">désactivé</span> : null}
                  {u.verrouille ? <span className="ml-2 rounded bg-warning-bg px-1 text-xs">verrouillé</span> : null}
                </td>
                <td className="p-2">
                  <FormulaireAction action={modifierUnUtilisateur} libelleBouton="Enregistrer" discret className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="nom" defaultValue={u.nom} aria-label="Nom" required className="rounded border border-border px-2 py-1" />
                    <SelectProfil defaut={u.profil} />
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="actif" defaultChecked={u.actif} /> actif
                    </label>
                  </FormulaireAction>
                </td>
                <td className="p-2 whitespace-nowrap">{u.derniereConnexionLe ? formatDate.format(u.derniereConnexionLe) : "jamais"}</td>
                <td className="p-2">
                  <FormulaireAction action={reinitialiserUnMotDePasse} libelleBouton="Définir" discret className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <input
                      name="motDePasse"
                      type="password"
                      autoComplete="new-password"
                      aria-label={`Mot de passe provisoire de ${u.identifiant}`}
                      required
                      className="rounded border border-border px-2 py-1"
                    />
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
