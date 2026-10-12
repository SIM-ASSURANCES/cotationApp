import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, EnTetePage, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerIntermediaires } from "@/serveur/intermediaires";
import { exigerDroit } from "@/serveur/session";

import { creerUnIntermediaire, modifierUnIntermediaire } from "./actions";

type LigneIntermediaire = Awaited<ReturnType<typeof listerIntermediaires>>[number];

export default async function PageIntermediaires() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [intermediaires, niveau] = await Promise.all([listerIntermediaires(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const peutModifier = peutAgir(niveau);

  const colonnes: ColonneTableau<LigneIntermediaire>[] = [
    { cle: "code", entete: "Code", rendu: (i) => <span className="font-medium">{i.code}</span> },
    { cle: "nom", entete: "Nom", rendu: (i) => i.nom },
    { cle: "role", entete: "Rôle", rendu: (i) => i.role },
    { cle: "etat", entete: "État", rendu: (i) => <PastilleStatut libelle={i.actif ? "Actif" : "Désactivé"} /> },
    ...(peutModifier
      ? [
          {
            cle: "modifier",
            entete: "Modifier",
            className: "min-w-64 align-top",
            // Le formulaire reste celui de l'ancien écran (mêmes champs, même action) : le `Tableau` ne fait que le loger.
            rendu: (i: LigneIntermediaire) => (
              <FormulaireAction action={modifierUnIntermediaire} libelleBouton="Enregistrer">
                <input type="hidden" name="code" value={i.code} />
                <Champ nom="nom" libelle="Nom" valeur={i.nom} autoComplete="off" />
                <Champ nom="role" libelle="Rôle" valeur={i.role} autoComplete="off" />
                <label className="mb-4 flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
                  <input type="checkbox" name="actif" defaultChecked={i.actif} className="size-4 accent-primary" /> Actif
                </label>
              </FormulaireAction>
            ),
          },
        ]
      : []),
  ];

  return (
    <main className="space-y-6">
      <EnTetePage titre="Intermédiaires" />
      <p className="max-w-3xl text-sm text-muted-foreground">
        Courtiers et agents qui apportent les affaires (CDC §10.1). Une cotation en compte de 0 à 2, repris dans les documents (
        <code>intermediaires[]</code>) et dans le taux de transformation du tableau de bord. Un code ne change jamais et ne se supprime pas : un
        intermédiaire désactivé ne peut plus être choisi, mais les cotations qui l&apos;ont gardent sa copie. Chaque modification est journalisée.
      </p>

      {peutModifier ? (
        <Carte titre="Ajouter un intermédiaire" className="max-w-md">
          <FormulaireAction action={creerUnIntermediaire} libelleBouton="Ajouter">
            <Champ nom="code" libelle="Code (ex. BENI-01)" autoComplete="off" />
            <Champ nom="nom" libelle="Nom" autoComplete="off" />
            <Champ nom="role" libelle="Rôle (ex. Apporteur, Gestionnaire)" autoComplete="off" />
          </FormulaireAction>
        </Carte>
      ) : null}

      <Tableau
        colonnes={colonnes}
        lignes={intermediaires}
        cleLigne={(i) => i.code}
        messageVide="Aucun intermédiaire. Ajoutez-en un pour pouvoir le choisir sur une cotation."
        legende="Intermédiaires"
        zebre={false}
      />
    </main>
  );
}
