import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerIntermediaires } from "@/serveur/intermediaires";
import { exigerDroit } from "@/serveur/session";

import { creerUnIntermediaire, modifierUnIntermediaire } from "./actions";

export default async function PageIntermediaires() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [intermediaires, niveau] = await Promise.all([listerIntermediaires(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const peutModifier = peutAgir(niveau);

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Intermédiaires</h1>
      <p className="mb-6 max-w-3xl text-sm text-neutral">
        Courtiers et agents qui apportent les affaires (CDC §10.1). Une cotation en compte de 0 à 2, repris dans les documents (
        <code>intermediaires[]</code>) et dans le taux de transformation du tableau de bord. Un code ne change jamais et ne se supprime pas : un
        intermédiaire désactivé ne peut plus être choisi, mais les cotations qui l&apos;ont gardent sa copie. Chaque modification est journalisée.
      </p>

      {peutModifier ? (
        <section className="mb-8 max-w-md rounded border border-border bg-muted p-5">
          <h2 className="mb-3 text-lg font-semibold">Ajouter un intermédiaire</h2>
          <FormulaireAction action={creerUnIntermediaire} libelleBouton="Ajouter">
            <Champ nom="code" libelle="Code (ex. BENI-01)" autoComplete="off" />
            <Champ nom="nom" libelle="Nom" autoComplete="off" />
            <Champ nom="role" libelle="Rôle (ex. Apporteur, Gestionnaire)" autoComplete="off" />
          </FormulaireAction>
        </section>
      ) : null}

      <table className="w-full max-w-5xl border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground">
            <th className="p-2">Code</th>
            <th className="p-2">Nom</th>
            <th className="p-2">Rôle</th>
            <th className="p-2">État</th>
            {peutModifier ? <th className="p-2">Modifier</th> : null}
          </tr>
        </thead>
        <tbody>
          {intermediaires.map((i) => (
            <tr key={i.code} className="border-b border-border align-top">
              <td className="p-2 font-medium">{i.code}</td>
              <td className="p-2">{i.nom}</td>
              <td className="p-2">{i.role}</td>
              <td className="p-2">{i.actif ? "Actif" : "Désactivé"}</td>
              {peutModifier ? (
                <td className="p-2">
                  <FormulaireAction action={modifierUnIntermediaire} libelleBouton="Enregistrer">
                    <input type="hidden" name="code" value={i.code} />
                    <Champ nom="nom" libelle="Nom" valeur={i.nom} autoComplete="off" />
                    <Champ nom="role" libelle="Rôle" valeur={i.role} autoComplete="off" />
                    <label className="mb-4 flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" name="actif" defaultChecked={i.actif} /> Actif
                    </label>
                  </FormulaireAction>
                </td>
              ) : null}
            </tr>
          ))}
          {intermediaires.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-4 text-center text-neutral">
                Aucun intermédiaire. Ajoutez-en un pour pouvoir le choisir sur une cotation.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
