import Link from "next/link";
import { redirect } from "next/navigation";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { LISTES_ANNEXE, REGLES, TYPES_MODELE } from "@/domaine/documents/modeles";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { historiqueSeuilListe, lireSeuilListe, listerModeles } from "@/serveur/modeles";
import { aujourdhui, listerProduits } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";

import { creerUnModele, enregistrerLeSeuil } from "./actions";

const select = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-base";

export default async function PageModeles() {
  const utilisateur = await exigerUtilisateur();
  const [depot, publication, parametrage] = await Promise.all([
    niveauDuProfil(utilisateur.profil, "DEPOSER_MODELE"),
    niveauDuProfil(utilisateur.profil, "PUBLIER_MODELE"),
    niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"),
  ]);
  if (!peutLire(depot) && !peutLire(publication)) redirect("/acces-refuse");

  const [modeles, seuil, historique, produits] = await Promise.all([
    listerModeles(utilisateur),
    lireSeuilListe(),
    historiqueSeuilListe(utilisateur),
    peutAgir(depot) ? listerProduits(utilisateur) : Promise.resolve([]),
  ]);

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Modèles Word</h1>
      <p className="mb-2 max-w-3xl text-sm text-neutral">
        Bibliothèque des modèles (CDC §6) : chaque dépôt est contrôlé, puis conservé comme une version qui n'est jamais écrasée.
        La Technique dépose et soumet ; un autre profil (Direction Générale) publie.
      </p>
      <p className="mb-6 text-sm">
        <Link href="/modeles/aide" className="font-medium text-primary underline">
          Aide à la rédaction des modèles : syntaxe, filtres et dictionnaire des champs
        </Link>
      </p>

      <table className="mb-8 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground">
            <th className="p-2">Code</th>
            <th className="p-2">Type</th>
            <th className="p-2">Libellé</th>
            <th className="p-2">Produit</th>
            <th className="p-2">En vigueur</th>
            <th className="p-2">Dernière version</th>
          </tr>
        </thead>
        <tbody>
          {modeles.map((m) => (
            <tr key={m.id} className="border-b border-border">
              <td className="p-2">
                <Link href={`/modeles/${m.id}`} className="font-medium text-primary underline">
                  {m.code}
                </Link>
              </td>
              <td className="p-2">
                {m.libelleType}
                {m.precision ? <span className="block text-xs text-neutral">{m.precision}</span> : null}
              </td>
              <td className="p-2">{m.libelle}</td>
              <td className="p-2">{m.produitCode ?? "commun"}</td>
              <td className="p-2">{m.enVigueur ? `v${m.enVigueur.numero} depuis le ${m.enVigueur.dateEffet}` : "aucune"}</td>
              <td className="p-2">{m.derniere ? `v${m.derniere.numero} : ${m.derniere.libelleStatut}` : "aucun dépôt"}</td>
            </tr>
          ))}
          {modeles.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-4 text-center text-neutral">
                Aucun modèle.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="grid gap-8 lg:grid-cols-2">
        {peutAgir(depot) ? (
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-3 text-lg font-semibold">Créer un modèle</h2>
            <FormulaireAction action={creerUnModele} libelleBouton="Créer, puis déposer le fichier">
              <label className="mb-4 block text-sm font-medium">
                Type
                <select name="type" required className={select} defaultValue="">
                  <option value="" disabled>
                    Choisir…
                  </option>
                  {TYPES_MODELE.map((t) => (
                    <option key={t} value={t}>
                      {REGLES[t].libelle}
                    </option>
                  ))}
                </select>
              </label>
              <Champ nom="code" libelle="Code (ex. CP_RELAXSANTE)" autoComplete="off" />
              <Champ nom="libelle" libelle="Libellé (pour les CG : celui cité dans les CP, ex. SECUR DOMMAGE)" autoComplete="off" />
              <label className="mb-4 block text-sm font-medium">
                Produit (obligatoire pour des CP ou une cotation ; aucun pour des CG ou CS)
                <select name="produitCode" className={select} defaultValue="">
                  <option value="">Commun à tous les produits</option>
                  {produits.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} — {p.libelle}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="mb-2 rounded border border-border p-3">
                <legend className="px-1 text-sm font-medium">Selon le type</legend>
                <label className="mb-4 block text-sm font-medium">
                  Annexe : liste reprise en entier
                  <select name="listeAnnexe" className={select} defaultValue="">
                    <option value="">—</option>
                    {LISTES_ANNEXE.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <Champ nom="niveauRelance" libelle="Relance : niveau (1, 2, 3…)" requis={false} autoComplete="off" />
                <Champ nom="blocNom" libelle={'Sous-modèle : nom du bloc, tel qu\'écrit dans bloc("garanties", …)'} requis={false} autoComplete="off" />
                <Champ nom="blocCle" libelle="Sous-modèle : clé (ex. code de formule : SOLO, 80…)" requis={false} autoComplete="off" />
              </fieldset>
            </FormulaireAction>
          </section>
        ) : null}

        <section className="rounded border border-border bg-surface p-5">
          <h2 className="mb-1 text-lg font-semibold">Listes longues (CDC §6.5)</h2>
          <p className="mb-3 text-sm text-neutral">
            Au-delà de <strong>{seuil}</strong> lignes, une liste (assurés, bénéficiaires, formules, échéances) est remplacée dans le corps
            du document par « Voir annexe – … » et rendue en entier par le modèle d'annexe, à la fin du PDF.
          </p>
          {historique.length > 0 ? (
            <ul className="mb-3 text-sm">
              {historique.map((h) => (
                <li key={h.dateEffet}>
                  {h.valeur} à partir du {h.dateEffet} (par {h.creePar})
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-neutral">Valeur par défaut du CDC : 10.</p>
          )}
          {peutAgir(parametrage) ? (
            <FormulaireAction action={enregistrerLeSeuil} libelleBouton="Enregistrer le seuil">
              <Champ nom="seuil" libelle="Nouveau seuil (nombre de lignes)" autoComplete="off" />
              <Champ nom="dateEffet" libelle="À partir du (AAAA-MM-JJ, jamais dans le passé)" valeur={aujourdhui()} autoComplete="off" />
            </FormulaireAction>
          ) : null}
        </section>
      </div>
    </main>
  );
}
