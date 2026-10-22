import { ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Carte, EnTetePage, ListeDefinitions, ListeDeroulante, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { aujourdhui } from "@/domaine/calcul/dates";
import { peutAgir, peutLire } from "@/domaine/droits";
import { listerCgBranches, listerModelesCg, type LigneHistoriqueCg } from "@/serveur/cg-branches";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { rattacherUneCg } from "./actions";

const COLONNES_HISTORIQUE: ColonneTableau<LigneHistoriqueCg>[] = [
  { cle: "dateEffet", entete: "À partir du", rendu: (l) => l.dateEffet },
  { cle: "modele", entete: "Modèle de CG", rendu: (l) => `${l.modeleLibelle} (${l.modeleCode})` },
  { cle: "creePar", entete: "Saisi par", rendu: (l) => l.creePar },
];

export default async function PageConditionsGenerales() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [branches, modeles, niveau] = await Promise.all([listerCgBranches(utilisateur), listerModelesCg(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);
  const peutModifier = peutAgir(niveau);
  const aujourd = aujourdhui();
  const manquantes = branches.filter((b) => !b.enVigueur);

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Conditions générales par branche"
        sousTitre="Une CG par branche principale : chaque produit reçoit celle de sa branche, en vigueur à la date d'émission du contrat. Le visa est lu dans la version publiée du modèle. Une ligne ne se modifie jamais : une nouvelle CG s'ajoute avec sa date d'effet. Les conventions spéciales restent propres au produit."
      />

      {manquantes.length > 0 ? (
        <Bandeau ton="avertissement" titre="Branches sans conditions générales en vigueur">
          L'émission des conditions particulières est refusée pour les produits de : {manquantes.map((b) => b.libelle).join(", ")}.
        </Bandeau>
      ) : null}

      {branches.map((b) => (
        <Carte key={b.code} titre={b.libelle} description={`Code ${b.code}`}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <PastilleStatut libelle={b.enVigueur ? "En vigueur" : "CG à renseigner"} />
          </div>
          {b.enVigueur ? (
            <ListeDefinitions
              className="mb-4"
              elements={[
                { libelle: "Modèle", valeur: `${b.enVigueur.modeleLibelle} (${b.enVigueur.modeleCode})` },
                { libelle: "Depuis le", valeur: b.enVigueur.dateEffet },
                { libelle: "Visa (version publiée)", valeur: b.enVigueur.visa },
                { libelle: "Version publiée", valeur: b.enVigueur.version === null ? null : `v${b.enVigueur.version}` },
              ]}
            />
          ) : null}
          {b.historique.length > 0 ? (
            <div className="relative mb-4 overflow-x-auto">
              <Tableau colonnes={COLONNES_HISTORIQUE} lignes={b.historique} cleLigne={(l) => `${l.dateEffet}-${l.modeleCode}`} messageVide="" legende={`Historique des CG de la branche ${b.libelle}`} zebre={false} />
            </div>
          ) : null}
          {peutModifier ? (
            <FormulaireAction action={rattacherUneCg} libelleBouton="Rattacher cette CG">
              <input type="hidden" name="branchePrincipale" value={b.code} />
              <div className="mb-4 max-w-md">
                <ListeDeroulante
                  label="Modèle de CG"
                  name="modeleCode"
                  required
                  invite="Choisir un modèle de CG"
                  options={modeles.map((m) => ({ valeur: m.code, libelle: `${m.libelle} (${m.code})${m.visa ? ` · visa ${m.visa}` : " · aucune version publiée"}` }))}
                />
              </div>
              <ChampDate nom="dateEffet" libelle="Date d'effet" valeur={aujourd} min={aujourd} />
            </FormulaireAction>
          ) : null}
        </Carte>
      ))}
    </main>
  );
}
