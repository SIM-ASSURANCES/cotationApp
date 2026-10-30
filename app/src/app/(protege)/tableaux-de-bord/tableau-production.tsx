import Link from "next/link";

import { Bandeau, Bouton, Carte, CarteIndicateur, ChampDate, EnTetePage, LienBouton, Tableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { DOCUMENTS, estTypeDocument } from "@/domaine/documents/emission";
import type { TableauProduction } from "@/serveur/tableau-production";

const f = (m: string) => `${formaterMontant(montant(m))} F`;

export function TableauDeBordProduction({ t, erreur }: { t: TableauProduction; erreur: string | null }) {
  const { indicateurs: ind } = t;

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Tableau de bord Production"
        sousTitre="Gestion des affaires nouvelles : cotations acceptées prêtes pour contrat, tâches post-import et lots d'adhérents."
        actions={
          <div className="flex flex-wrap gap-2">
            <LienBouton href="/cotations" variante="secondaire">
              Cotations
            </LienBouton>
            <LienBouton href="/imports" variante="secondaire">
              Imports en masse
            </LienBouton>
          </div>
        }
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

      {/* Indicateurs clés */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CarteIndicateur
          icone="document"
          etiquette="Cotations acceptées sans contrat"
          valeur={ind.cotationsEnAttenteContrat}
          ton={ind.cotationsEnAttenteContrat > 0 ? "avertissement" : "neutre"}
        />
        <CarteIndicateur
          icone="horloge"
          etiquette="Tâches de police en attente"
          valeur={ind.tachesEnAttente}
          ton={ind.tachesEnAttente > 0 ? "info" : "neutre"}
        />
        <CarteIndicateur
          icone="televerser"
          etiquette="Lots d'import en cours"
          valeur={ind.importsEnCours}
          ton="neutre"
        />
      </div>

      {/* Cotations acceptées en attente d'émission du contrat */}
      <Carte
        titre="Affaires acceptées à finaliser"
        description="Cotations acceptées par le client nécessitant l'émission des conditions particulières (police)."
      >
        <Tableau
          legende="Cotations prêtes"
          lignes={t.cotationsAProduire}
          cleLigne={(c) => String(c.id)}
          messageVide="Aucune cotation acceptée en attente d'émission."
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
            { cle: "ttc", entete: "Prime TTC", alignement: "droite", rendu: (c) => (c.ttc ? f(c.ttc) : "—") },
            { cle: "date", entete: "Acceptée le", rendu: (c) => (c.accepteeLe ? formaterDate(c.accepteeLe) : "—") },
            {
              cle: "action",
              entete: "Action",
              alignement: "droite",
              rendu: (c) => (
                <LienBouton href={`/cotations/${c.id}`} variante="secondaire">
                  Émettre CP
                </LienBouton>
              ),
            },
          ]}
        />
      </Carte>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tâches de police */}
        <Carte titre="Tâches de police en attente" description="Pièces ou cartes d'assurés à émettre suite à un import.">
          <Tableau
            legende="Tâches de police"
            lignes={t.tachesPolice}
            cleLigne={(tp) => String(tp.id)}
            messageVide="Aucune tâche de police en attente."
            colonnes={[
              { cle: "police", entete: "Police", rendu: (tp) => tp.policeNumero },
              { cle: "client", entete: "Souscripteur", rendu: (tp) => tp.souscripteur },
              { cle: "type", entete: "Action requise", rendu: (tp) => tp.type },
              { cle: "date", entete: "Créée le", rendu: (tp) => formaterDate(tp.creeLe) },
            ]}
          />
        </Carte>

        {/* Lots d'import */}
        <Carte titre="Lots d'import récents" description="Derniers imports de listes d'adhérents.">
          <Tableau
            legende="Imports récents"
            lignes={t.lotsImports}
            cleLigne={(i) => String(i.id)}
            messageVide="Aucun import récent."
            colonnes={[
              {
                cle: "id",
                entete: "Lot",
                rendu: (i) => (
                  <Link href={`/imports/${i.id}`} className="font-medium text-primary underline">
                    Lot #{i.id}
                  </Link>
                ),
              },
              { cle: "police", entete: "Police", rendu: (i) => i.policeNumero },
              { cle: "lignes", entete: "Lignes", alignement: "droite", rendu: (i) => i.lignes },
              { cle: "statut", entete: "Statut", rendu: (i) => i.statut },
              { cle: "date", entete: "Date", rendu: (i) => formaterDate(i.creeLe) },
            ]}
          />
        </Carte>
      </div>

      {/* Production par type et par mois */}
      <Carte titre="Documents émis par mois" description="Volume des documents produits sur la période.">
        <Tableau
          legende="Documents émis par mois"
          lignes={t.documentsParType}
          cleLigne={(d) => `${d.mois}-${d.type}`}
          messageVide="Aucun document émis sur la période."
          colonnes={[
            { cle: "mois", entete: "Mois", rendu: (d) => d.mois },
            { cle: "type", entete: "Type de pièce", rendu: (d) => (estTypeDocument(d.type) ? DOCUMENTS[d.type].libelle : d.type) },
            { cle: "nombre", entete: "Nombre", alignement: "droite", rendu: (d) => d.nombre },
          ]}
        />
      </Carte>
    </main>
  );
}
