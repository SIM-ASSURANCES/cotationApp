import Link from "next/link";

import { Bandeau, Bouton, Carte, CarteIndicateur, Champ, EnTetePage, LienBouton, PastilleStatut, Tableau } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT, STATUTS } from "@/domaine/cotation/statuts";
import { LIBELLE_TRANCHE, TRANCHES_ANCIENNETE } from "@/domaine/tableaux/indicateurs";
import type { TableauCommercial } from "@/serveur/tableau-commercial";

const f = (m: string) => `${formaterMontant(montant(m))} F`;
const formatDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Africa/Abidjan" });
const TITRE_SOUS_SECTION = "mb-2 text-base font-semibold text-foreground";
const taux = (t: string | null) => (t === null ? "—" : `${t.replace(".", ",")} %`);

/** Tableau de bord du commercial : ses cotations, sa production et l'encaissement de ses polices (H102 à H104). */
export function TableauDeBordCommercial({ t, erreur }: { t: TableauCommercial; erreur: string | null }) {
  const { cotations: c, production: p, encaissement: e } = t;
  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Mon tableau de bord"
        sousTitre="Vos chiffres personnels : les cotations dont vous êtes l'auteur et les polices qui en sont issues."
        actions={
          <LienBouton variante="principal" href="/cotations/nouvelle">
            Nouvelle cotation
          </LienBouton>
        }
      />

      <Carte>
        <form className="flex flex-wrap items-end gap-4" method="get">
          <div className="w-full sm:w-56">
            <Champ label="Du (AAAA-MM-JJ)" name="debut" defaultValue={t.periode.debut} />
          </div>
          <div className="w-full sm:w-56">
            <Champ label="Au" name="fin" defaultValue={t.periode.fin} />
          </div>
          <Bouton type="submit">Afficher</Bouton>
        </form>
        {erreur ? (
          <Bandeau ton="danger" role="alert" className="mt-4">
            {erreur} Période par défaut affichée.
          </Bandeau>
        ) : null}
      </Carte>

      <Carte titre="Mes cotations" description={`Créées du ${t.periode.debut} au ${t.periode.fin}, à leur statut d'aujourd'hui.`}>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STATUTS.map((s) => (
            <CarteIndicateur key={s} icone="document" etiquette={LIBELLE_STATUT[s]} valeur={c.parStatut[s]} ton="neutre" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <CarteIndicateur icone="graphique" etiquette="Mon taux de transformation" valeur={taux(c.taux)} ton="info" />
            <p className="text-sm text-muted-foreground">
              {c.acceptees} acceptée(s) sur {c.emises} cotation(s) émise(s) dans la période.
            </p>
          </div>
          <div>
            <h3 className={TITRE_SOUS_SECTION}>Transformation par produit</h3>
            <Tableau
              legende="Transformation par produit"
              lignes={c.parProduit}
              cleLigne={(l) => l.cle}
              messageVide="Aucune cotation émise sur la période."
              colonnes={[
                { cle: "produit", entete: "Produit", rendu: (l) => l.cle },
                { cle: "emises", entete: "Émises", alignement: "droite", rendu: (l) => l.emises },
                { cle: "acceptees", entete: "Acceptées", alignement: "droite", rendu: (l) => l.acceptees },
                { cle: "taux", entete: "Taux", alignement: "droite", rendu: (l) => taux(l.taux) },
              ]}
            />
          </div>
        </div>
      </Carte>

      <Carte titre="Ma production" description="Cotations acceptées dans la période : chacune a donné une police. Montants TTC.">
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <CarteIndicateur icone="fichiers" etiquette="Polices produites" valeur={p.polices} ton="succes" />
          <CarteIndicateur icone="portefeuille" etiquette="Prime TTC produite" valeur={f(p.primeTtc)} ton="succes" />
        </div>
        <Tableau
          legende="Production par produit"
          lignes={p.parProduit}
          cleLigne={(l) => l.produit}
          messageVide="Aucune cotation acceptée sur la période."
          colonnes={[
            { cle: "produit", entete: "Produit", rendu: (l) => l.produit },
            { cle: "polices", entete: "Polices", alignement: "droite", rendu: (l) => l.polices },
            { cle: "prime", entete: "Prime TTC", alignement: "droite", rendu: (l) => f(l.primeTtc) },
          ]}
        />
      </Carte>

      <Carte titre="Encaissement de mes polices" description="Factures des polices issues de vos cotations.">
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <CarteIndicateur icone="document" etiquette="Facturé sur la période" valeur={f(e.emis)} ton="info" />
          <CarteIndicateur icone="portefeuille" etiquette="Encaissé sur la période" valeur={f(e.encaisse)} ton="succes" />
          <CarteIndicateur icone="horloge" etiquette="Restant dû à ce jour" valeur={f(e.restantDu)} ton="avertissement" />
        </div>
        <h3 className={TITRE_SOUS_SECTION}>Impayés par ancienneté (échéances échues)</h3>
        <Tableau
          legende="Impayés par ancienneté"
          lignes={TRANCHES_ANCIENNETE}
          cleLigne={(tr) => tr}
          colonnes={[
            { cle: "tranche", entete: "Ancienneté", rendu: (tr) => LIBELLE_TRANCHE[tr] },
            { cle: "nombre", entete: "Échéances", alignement: "droite", rendu: (tr) => `${e.impayes[tr].nombre} échéance(s)` },
            { cle: "montant", entete: "Montant", alignement: "droite", rendu: (tr) => f(e.impayes[tr].montant) },
          ]}
        />
      </Carte>

      <Carte titre="Mes cotations en cours" description="Brouillons, cotations à valider et émises, les plus récentes d'abord (10 au plus).">
        <Tableau
          legende="Mes cotations en cours"
          lignes={t.enCours}
          cleLigne={(l) => String(l.id)}
          messageVide="Aucune cotation en cours."
          colonnes={[
            {
              cle: "numero",
              entete: "N°",
              rendu: (l) => (
                <Link href={`/cotations/${l.id}`} className="font-medium text-primary underline">
                  {l.numero ?? `Brouillon n° ${l.id}`}
                </Link>
              ),
            },
            { cle: "statut", entete: "Statut", rendu: (l) => <PastilleStatut libelle={LIBELLE_STATUT[l.statut]} /> },
            { cle: "produit", entete: "Produit", rendu: (l) => l.produit },
            { cle: "souscripteur", entete: "Souscripteur", rendu: (l) => l.souscripteur },
            { cle: "ttc", entete: "TTC (F CFA)", alignement: "droite", rendu: (l) => (l.ttc ? formaterMontant(montant(l.ttc)) : "—") },
            { cle: "validite", entete: "Valide jusqu'au", rendu: (l) => (l.dateValidite ? formatDate.format(new Date(`${l.dateValidite}T00:00:00Z`)) : "—") },
          ]}
        />
      </Carte>
    </main>
  );
}
