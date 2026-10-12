import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerBranches } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { creerUneBranche, modifierUneBranche } from "./actions";

export default async function PageBranches() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [branches, niveau] = await Promise.all([listerBranches(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const peutModifier = peutAgir(niveau);

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Branches fiscales</h1>
      <p className="mb-6 max-w-3xl text-sm text-neutral">
        La branche d'un produit détermine son taux de taxe (écran « Taxes »). Cette liste est paramétrable : un code ne change jamais et ne se
        supprime pas. Une branche désactivée garde ses taux et ses produits, mais ne peut plus en recevoir de nouveaux. Chaque modification est
        journalisée.
      </p>

      {peutModifier ? (
        <section className="mb-8 max-w-md rounded border border-border bg-muted p-5">
          <h2 className="mb-3 text-lg font-semibold">Ajouter une branche</h2>
          <FormulaireAction action={creerUneBranche} libelleBouton="Ajouter">
            <Champ nom="code" libelle="Code (ex. SANTE, MOTO)" autoComplete="off" />
            <Champ nom="libelle" libelle="Libellé" autoComplete="off" />
          </FormulaireAction>
        </section>
      ) : null}

      <table className="w-full max-w-4xl border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground">
            <th className="p-2">Code</th>
            <th className="p-2">Libellé</th>
            <th className="p-2">État</th>
            {peutModifier ? <th className="p-2">Modifier</th> : null}
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.code} className="border-b border-border align-top">
              <td className="p-2 font-medium">{b.code}</td>
              <td className="p-2">{b.libelle}</td>
              <td className="p-2">{b.actif ? "Active" : "Désactivée"}</td>
              {peutModifier ? (
                <td className="p-2">
                  <FormulaireAction action={modifierUneBranche} libelleBouton="Enregistrer">
                    <input type="hidden" name="code" value={b.code} />
                    <Champ nom="libelle" libelle="Libellé" valeur={b.libelle} autoComplete="off" />
                    <label className="mb-4 flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" name="actif" defaultChecked={b.actif} /> Active
                    </label>
                  </FormulaireAction>
                </td>
              ) : null}
            </tr>
          ))}
          {branches.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-4 text-center text-neutral">
                Aucune branche. Lancez « npm run initialiser » ou ajoutez-en une.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
