import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { ASSIETTES_TAXE } from "@/domaine/calcul/calcul";
import { montant } from "@/domaine/calcul/montant";
import { peutAgir, peutLire } from "@/domaine/droits";
import { listerTaxes } from "@/serveur/parametrage";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { creerUneTaxe } from "./actions";

const LIBELLE_ASSIETTE = { NETTE_ACCESSOIRES: "Nette + accessoires", NETTE: "Nette seule" } as const;

export default async function PageTaxes() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [taxes, niveau] = await Promise.all([listerTaxes(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-sim-bleu">Table des taxes</h1>
      <p className="mb-6 max-w-3xl text-sm text-zinc-700">
        Taux de taxe par branche (CDC §8.3), historisé : on ajoute une ligne avec une date d'effet, on ne modifie jamais
        une ligne en vigueur. Le taux appliqué à une police est celui en vigueur à sa <strong>date d'effet</strong>.
      </p>

      {peutAgir(niveau) ? (
        <section className="mb-8 max-w-md rounded border border-bordure bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">Ajouter une ligne</h2>
          <FormulaireAction action={creerUneTaxe} libelleBouton="Ajouter">
            <Champ nom="branche" libelle="Branche (ex. SANTE)" autoComplete="off" />
            <Champ nom="tauxPourcent" libelle="Taux en % (ex. 1,5)" autoComplete="off" />
            <label className="mb-4 block text-sm font-medium">
              Assiette
              <select name="assiette" defaultValue="NETTE_ACCESSOIRES" className="mt-1 block w-full rounded border border-bordure bg-white px-3 py-2">
                {ASSIETTES_TAXE.map((a) => (
                  <option key={a} value={a}>
                    {LIBELLE_ASSIETTE[a]}
                  </option>
                ))}
              </select>
            </label>
            <Champ nom="dateEffet" libelle="Date d'effet (AAAA-MM-JJ)" autoComplete="off" />
            <Champ nom="dateFin" libelle="Date de fin (facultative)" requis={false} autoComplete="off" />
          </FormulaireAction>
        </section>
      ) : (
        <p className="mb-6 rounded border border-bordure bg-surface p-3 text-sm">
          Consultation seule : votre profil peut proposer mais pas enregistrer de taux.
        </p>
      )}

      <table className="w-full max-w-3xl border-collapse text-sm">
        <thead>
          <tr className="bg-sim-bleu text-left text-white">
            <th className="p-2">Branche</th>
            <th className="p-2">Taux</th>
            <th className="p-2">Assiette</th>
            <th className="p-2">Date d'effet</th>
            <th className="p-2">Date de fin</th>
          </tr>
        </thead>
        <tbody>
          {taxes.map((t) => (
            <tr key={t.id} className="border-b border-bordure">
              <td className="p-2 font-medium">{t.branche}</td>
              <td className="p-2">{montant(t.tauxPourcent).toString().replace(".", ",")} %</td>
              <td className="p-2">{LIBELLE_ASSIETTE[t.assiette]}</td>
              <td className="p-2">{t.dateEffet}</td>
              <td className="p-2">{t.dateFin ?? "—"}</td>
            </tr>
          ))}
          {taxes.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-4 text-center text-zinc-600">
                Aucune taxe enregistrée.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
