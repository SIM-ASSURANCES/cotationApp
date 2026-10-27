import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, EnTetePage, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerBranches } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { creerUneBranche, modifierUneBranche } from "./actions";

type LigneBranche = Awaited<ReturnType<typeof listerBranches>>[number];

export default async function PageBranches() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [branches, niveau] = await Promise.all([listerBranches(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const peutModifier = peutAgir(niveau);

  const colonnes: ColonneTableau<LigneBranche>[] = [
    { cle: "code", entete: "Code", rendu: (b) => <span className="font-medium">{b.code}</span> },
    { cle: "libelle", entete: "Libellé", rendu: (b) => b.libelle },
    { cle: "etat", entete: "État", rendu: (b) => <PastilleStatut libelle={b.actif ? "Active" : "Désactivée"} /> },
    ...(peutModifier
      ? [
          {
            cle: "modifier",
            entete: "Modifier",
            className: "min-w-64 align-top",
            // Le formulaire reste celui de l'ancien écran (mêmes champs, même action) : le `Tableau` ne fait que le loger.
            rendu: (b: LigneBranche) => (
              <FormulaireAction action={modifierUneBranche} garderApresSucces libelleBouton="Enregistrer">
                <input type="hidden" name="code" value={b.code} />
                <Champ nom="libelle" libelle="Libellé" valeur={b.libelle} autoComplete="off" />
                <label className="mb-4 flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
                  <input type="checkbox" name="actif" defaultChecked={b.actif} className="size-4 accent-primary" /> Active
                </label>
              </FormulaireAction>
            ),
          },
        ]
      : []),
  ];

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Branches fiscales"
        sousTitre="La branche d'un produit détermine son taux de taxe (écran « Taxes »). Cette liste est paramétrable : un code ne change jamais et ne se supprime pas. Une branche désactivée garde ses taux et ses produits, mais ne peut plus en recevoir de nouveaux. Chaque modification est journalisée."
      />

      {peutModifier ? (
        <Carte titre="Ajouter une branche" className="max-w-md">
          <FormulaireAction action={creerUneBranche} libelleBouton="Ajouter">
            <Champ nom="code" libelle="Code (ex. SANTE, MOTO)" autoComplete="off" />
            <Champ nom="libelle" libelle="Libellé" autoComplete="off" />
          </FormulaireAction>
        </Carte>
      ) : null}

      <Tableau colonnes={colonnes} lignes={branches} cleLigne={(b) => b.code} messageVide="Aucune branche. Lancez « npm run initialiser » ou ajoutez-en une." legende="Branches fiscales" zebre={false} />
    </main>
  );
}
