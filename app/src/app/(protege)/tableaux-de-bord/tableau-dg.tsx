import Link from "next/link";

import { Bandeau, Bouton, Carte, CarteIndicateur, ChampDate, EnTetePage, LienBouton, Tableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import type { TableauDirectionGenerale } from "@/serveur/tableau-dg";

const f = (m: string) => `${formaterMontant(montant(m))} F`;
const taux = (t: string | null) => (t === null ? "—" : `${t.replace(".", ",")} %`);

export function TableauDeBordDG({ t, erreur }: { t: TableauDirectionGenerale; erreur: string | null }) {
  const { indicateurs: ind, approbations: app } = t;
  const totalApprobations = app.modelesAPublier.length + app.cotationsAValider.length + app.contratsAValider.length;

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Tableau de bord Direction Générale"
        sousTitre="Synthèse de la performance globale et approbations de niveau Direction Générale."
      />

      <Carte>
        <form className="flex flex-wrap items-end gap-4" method="get">
          <div className="w-full sm:w-56">
            <ChampDate label="Du (JJ/MM/AAAA)" name="debut" defaultValue={t.periode.debut} />
          </div>
          <div className="w-full sm:w-56">
            <ChampDate label="Au (JJ/MM/AAAA)" name="fin" defaultValue={t.periode.fin} />
          </div>
          <Bouton type="submit">Afficher</Bouton>
        </form>
        {erreur ? (
          <Bandeau ton="danger" role="alert" className="mt-4">
            {erreur} Période par défaut affichée.
          </Bandeau>
        ) : null}
      </Carte>

      {/* Indicateurs macro */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CarteIndicateur
          icone="graphique"
          etiquette="Taux de transformation"
          valeur={taux(ind.tauxTransformation)}
          ton="info"
        />
        <CarteIndicateur
          icone="portefeuille"
          etiquette="Prime TTC produite"
          valeur={f(ind.primeTtcTotale)}
          ton="succes"
        />
        <CarteIndicateur
          icone="recu"
          etiquette="Total encaissé"
          valeur={f(ind.encaisse)}
          ton="succes"
        />
        <CarteIndicateur
          icone="bouclier"
          etiquette="Polices en vigueur"
          valeur={ind.policesEnVigueur}
          ton="neutre"
        />
      </div>

      {/* File d'approbations DG */}
      <Carte
        titre={`Approbations en attente (${totalApprobations})`}
        description="Documents et décisions nécessitant le visa ou la publication de la Direction Générale."
      >
        <div className="space-y-6">
          {/* Modèles à publier */}
          <div>
            <h3 className="mb-2 text-base font-semibold text-foreground">
              Modèles Word soumis pour publication ({app.modelesAPublier.length})
            </h3>
            <Tableau
              legende="Modèles à publier"
              lignes={app.modelesAPublier}
              cleLigne={(m) => String(m.id)}
              messageVide="Aucun modèle Word en attente de publication."
              colonnes={[
                {
                  cle: "code",
                  entete: "Modèle",
                  rendu: (m) => (
                    <Link href={`/modeles/${m.modeleId}`} className="font-semibold text-primary underline">
                      {m.modeleCode} (v{m.numero})
                    </Link>
                  ),
                },
                { cle: "libelle", entete: "Libellé", rendu: (m) => m.modeleLibelle },
                { cle: "type", entete: "Type", rendu: (m) => m.type },
                { cle: "auteur", entete: "Auteur du dépôt", rendu: (m) => m.auteurIdentifiant },
                { cle: "date", entete: "Soumis le", rendu: (m) => (m.soumisLe ? formaterDate(m.soumisLe) : "—") },
                {
                  cle: "action",
                  entete: "Action",
                  alignement: "droite",
                  rendu: (m) => (
                    <LienBouton href={`/modeles/${m.modeleId}`} variante="secondaire">
                      Examiner
                    </LienBouton>
                  ),
                },
              ]}
            />
          </div>

          {/* Cotations au-dessus du seuil */}
          <div>
            <h3 className="mb-2 text-base font-semibold text-foreground">
              Cotations sous double validation ({app.cotationsAValider.length})
            </h3>
            <Tableau
              legende="Cotations à valider"
              lignes={app.cotationsAValider}
              cleLigne={(c) => String(c.id)}
              messageVide="Aucune cotation sous double validation."
              colonnes={[
                {
                  cle: "num",
                  entete: "Cotation",
                  rendu: (c) => (
                    <Link href={`/cotations/${c.id}`} className="font-semibold text-primary underline">
                      {c.numero ?? `Brouillon n° ${c.id}`}
                    </Link>
                  ),
                },
                { cle: "produit", entete: "Produit", rendu: (c) => c.produitCode },
                { cle: "client", entete: "Souscripteur", rendu: (c) => c.souscripteur },
                { cle: "ttc", entete: "Montant TTC", alignement: "droite", rendu: (c) => (c.ttc ? f(c.ttc) : "—") },
                { cle: "demandeur", entete: "Auteur", rendu: (c) => c.auteurIdentifiant },
                {
                  cle: "action",
                  entete: "Action",
                  alignement: "droite",
                  rendu: (c) => (
                    <LienBouton href={`/cotations/${c.id}`} variante="secondaire">
                      Valider
                    </LienBouton>
                  ),
                },
              ]}
            />
          </div>

          {/* Contrats au-dessus du seuil */}
          <div>
            <h3 className="mb-2 text-base font-semibold text-foreground">
              Contrats au-dessus du seuil ({app.contratsAValider.length})
            </h3>
            <Tableau
              legende="Contrats à valider"
              lignes={app.contratsAValider}
              cleLigne={(v) => String(v.id)}
              messageVide="Aucun contrat au-dessus du seuil en attente."
              colonnes={[
                { cle: "police", entete: "Police", rendu: (v) => v.policeNumero },
                { cle: "produit", entete: "Produit", rendu: (v) => v.produitCode },
                { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (v) => f(v.ttc) },
                { cle: "seuil", entete: "Seuil produit", alignement: "droite", rendu: (v) => f(v.seuil) },
                { cle: "demandeur", entete: "Demandeur", rendu: (v) => v.demandeur },
              ]}
            />
          </div>
        </div>
      </Carte>

      {/* Répartition de la production par produit */}
      <Carte titre="Production par produit" description="Polices émises et primes TTC produites sur la période.">
        <Tableau
          legende="Production par produit"
          lignes={t.repartitionProduits}
          cleLigne={(l) => l.produit}
          messageVide="Aucune production enregistrée sur la période."
          colonnes={[
            { cle: "produit", entete: "Produit", rendu: (l) => l.produit },
            { cle: "polices", entete: "Nombre de contrats", alignement: "droite", rendu: (l) => l.polices },
            { cle: "prime", entete: "Prime TTC totale", alignement: "droite", rendu: (l) => f(l.primeTtc) },
          ]}
        />
      </Carte>
    </main>
  );
}
