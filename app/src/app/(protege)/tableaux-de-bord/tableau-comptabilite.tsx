import Link from "next/link";

import { Bandeau, Bouton, Carte, CarteIndicateur, ChampDate, EnTetePage, LienBouton, Tableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_TRANCHE, TRANCHES_ANCIENNETE } from "@/domaine/tableaux/indicateurs";
import type { TableauComptabilite } from "@/serveur/tableau-comptabilite";

const f = (m: string) => `${formaterMontant(montant(m))} F`;

export function TableauDeBordComptabilite({ t, erreur }: { t: TableauComptabilite; erreur: string | null }) {
  const { financier } = t;
  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Tableau de bord Comptabilité"
        sousTitre="Suivi financier : factures, avoirs, encaissements, échéances impayées et relances."
        actions={
          <div className="flex flex-wrap gap-2">
            <LienBouton href="/factures" variante="secondaire">
              Factures et avoirs
            </LienBouton>
            <LienBouton href="/echeances" variante="secondaire">
              Échéances & Relances
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

      {/* Synthèse financière */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CarteIndicateur icone="document" etiquette="Facturé (émis) sur la période" valeur={f(financier.emis)} ton="info" />
        <CarteIndicateur icone="recu" etiquette="Avoirs sur la période" valeur={f(financier.avoirs)} ton="neutre" />
        <CarteIndicateur icone="portefeuille" etiquette="Encaissé sur la période" valeur={f(financier.encaisse)} ton="succes" />
        <CarteIndicateur icone="horloge" etiquette="Restant dû à ce jour" valeur={f(financier.restantDu)} ton="avertissement" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Impayés par ancienneté */}
        <Carte titre="Impayés par ancienneté" description="Échéances échues restant dues à ce jour, classées par retard.">
          <Tableau
            legende="Impayés par ancienneté"
            lignes={TRANCHES_ANCIENNETE}
            cleLigne={(tr) => tr}
            colonnes={[
              { cle: "tranche", entete: "Ancienneté", rendu: (tr) => LIBELLE_TRANCHE[tr] },
              { cle: "nombre", entete: "Échéances", alignement: "droite", rendu: (tr) => `${financier.impayes[tr].nombre} échéance(s)` },
              { cle: "montant", entete: "Montant", alignement: "droite", rendu: (tr) => f(financier.impayes[tr].montant) },
            ]}
          />
        </Carte>

        {/* Derniers encaissements */}
        <Carte titre="Derniers encaissements enregistrés" description="Paiements récents enregistrés sur la période.">
          <Tableau
            legende="Derniers paiements"
            lignes={t.derniersPaiements}
            cleLigne={(p) => String(p.id)}
            messageVide="Aucun paiement sur la période."
            colonnes={[
              { cle: "date", entete: "Date", rendu: (p) => formaterDate(p.date) },
              { cle: "police", entete: "Police", rendu: (p) => p.policeNumero },
              { cle: "canal", entete: "Mode", rendu: (p) => p.canal },
              { cle: "montant", entete: "Montant", alignement: "droite", rendu: (p) => f(p.montant) },
              {
                cle: "facture",
                entete: "Facture",
                alignement: "droite",
                rendu: (p) => (
                  <Link href={`/factures/${p.factureId}`} className="font-medium text-primary underline">
                    {p.factureNumero ?? `Fac #${p.factureId}`}
                  </Link>
                ),
              },
            ]}
          />
        </Carte>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Factures en attente / récentes */}
        <Carte titre="Factures récentes" description="Factures émises ou sous validation sur la période.">
          <Tableau
            legende="Factures récentes"
            lignes={t.facturesEnAttente}
            cleLigne={(fa) => String(fa.id)}
            messageVide="Aucune facture récente."
            colonnes={[
              {
                cle: "num",
                entete: "Numéro",
                rendu: (fa) => (
                  <Link href={`/factures/${fa.id}`} className="font-semibold text-primary underline">
                    {fa.numero ?? `Fac #${fa.id}`}
                  </Link>
                ),
              },
              { cle: "client", entete: "Client", rendu: (fa) => fa.souscripteur },
              { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (fa) => f(fa.ttc) },
              {
                cle: "action",
                entete: "Action",
                alignement: "droite",
                rendu: (fa) => (
                  <LienBouton href={`/factures/${fa.id}`} variante="secondaire">
                    Consulter
                  </LienBouton>
                ),
              },
            ]}
          />
        </Carte>

        {/* Avis d'échéance et relances */}
        <Carte titre="Avis d'échéance et relances" description="Actions de relance produites sur la période.">
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Avis d&apos;échéance émis : <strong>{t.relancesEtAvis.avis}</strong>
            </p>
            {t.relancesEtAvis.relancesParNiveau.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune relance émise sur cette période.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm text-foreground">
                {t.relancesEtAvis.relancesParNiveau.map((r) => (
                  <li key={r.niveau}>
                    Niveau {r.niveau} : <strong>{r.nombre}</strong> relance(s)
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Carte>
      </div>
    </main>
  );
}
