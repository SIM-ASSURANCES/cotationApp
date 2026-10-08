import Link from "next/link";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerBranches, listerProduits } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { creerUnProduit } from "./actions";

export default async function PageProduits() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [produits, branches, niveau] = await Promise.all([listerProduits(utilisateur), listerBranches(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-sim-bleu">Produits</h1>
      <p className="mb-6 max-w-3xl text-sm text-zinc-700">
        Aucun produit n'est codé en dur (CDC §2.3) : un produit, ses formules et ses règles de calcul se paramètrent ici,
        par versions datées.
      </p>

      {peutAgir(niveau) ? (
        <section className="mb-8 max-w-md rounded border border-bordure bg-surface p-5">
          <h2 className="mb-3 text-lg font-semibold">Créer un produit</h2>
          <FormulaireAction action={creerUnProduit} libelleBouton="Créer">
            <Champ nom="code" libelle="Code (ex. RELAXSANTE)" autoComplete="off" />
            <Champ nom="libelle" libelle="Libellé" autoComplete="off" />
            <Champ nom="gamme" libelle="Gamme (ex. RELAX)" autoComplete="off" />
            <label className="mb-4 block text-sm font-medium">
              Branche
              <select name="branche" defaultValue="" required className="mt-1 block w-full rounded border border-bordure bg-white px-3 py-2">
                <option value="" disabled>
                  Choisir une branche
                </option>
                {branches.filter((b) => b.actif).map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} · {b.libelle}
                  </option>
                ))}
              </select>
            </label>
          </FormulaireAction>
        </section>
      ) : null}

      <table className="w-full max-w-4xl border-collapse text-sm">
        <thead>
          <tr className="bg-sim-bleu text-left text-white">
            <th className="p-2">Code</th>
            <th className="p-2">Libellé</th>
            <th className="p-2">Gamme</th>
            <th className="p-2">Branche</th>
            <th className="p-2">Versions</th>
          </tr>
        </thead>
        <tbody>
          {produits.map((p) => (
            <tr key={p.code} className="border-b border-bordure">
              <td className="p-2">
                <Link href={`/parametrage/produits/${p.code}`} className="font-medium text-sim-bleu underline">
                  {p.code}
                </Link>
              </td>
              <td className="p-2">{p.libelle}</td>
              <td className="p-2">{p.gamme}</td>
              <td className="p-2">{p.branche}</td>
              <td className="p-2">{p.versions.length === 0 ? "aucune" : `${p.versions.length} (depuis le ${p.versions[p.versions.length - 1]}, dernière du ${p.versions[0]})`}</td>
            </tr>
          ))}
          {produits.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-4 text-center text-zinc-600">
                Aucun produit.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
