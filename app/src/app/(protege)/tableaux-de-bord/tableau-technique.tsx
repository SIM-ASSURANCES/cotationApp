import Link from "next/link";

import { Bandeau, Bouton, Carte, CarteIndicateur, ChampDate, EnTetePage, LienBouton, Tableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import type { TableauTechnique } from "@/serveur/tableau-technique";

const f = (m: string) => `${formaterMontant(montant(m))} F`;
const TITRE_SOUS_SECTION = "mb-2 text-base font-semibold text-foreground";
const taux = (t: string | null) => (t === null ? "—" : `${t.replace(".", ",")} %`);

export function TableauDeBordTechnique({ t, erreur }: { t: TableauTechnique; erreur: string | null }) {
  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Tableau de bord Technique"
        sousTitre="File de travail opérationnelle : cotations à valider, primes à composer, contrats sous double validation, modèles et barèmes."
        actions={
          <div className="flex flex-wrap gap-2">
            <LienBouton href="/parametrage/produits" variante="secondaire">
              Paramétrage produits
            </LienBouton>
            <LienBouton href="/modeles" variante="secondaire">
              Modèles Word
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CarteIndicateur
          icone="document"
          etiquette="Cotations à valider"
          valeur={t.aValider.length}
          ton={t.aValider.length > 0 ? "avertissement" : "neutre"}
        />
        <CarteIndicateur
          icone="calculatrice"
          etiquette="Primes à composer"
          valeur={t.aComposer.length}
          ton={t.aComposer.length > 0 ? "info" : "neutre"}
        />
        <CarteIndicateur
          icone="bouclier"
          etiquette="Contrats à valider (seuil)"
          valeur={t.contratsAValider.length}
          ton={t.contratsAValider.length > 0 ? "danger" : "neutre"}
        />
        <CarteIndicateur
          icone="livre"
          etiquette="Modèles soumis (à relire)"
          valeur={t.modelesSoumis.length}
          ton={t.modelesSoumis.length > 0 ? "info" : "neutre"}
        />
      </div>

      {/* Cotations à valider */}
      <Carte titre="Cotations en attente de validation technique" description="Cotations avec prime forcée ou seuil dépassé : votre validation est requise.">
        <Tableau
          legende="Cotations à valider"
          lignes={t.aValider}
          cleLigne={(c) => String(c.id)}
          messageVide="Aucune cotation à valider pour le moment."
          colonnes={[
            {
              cle: "cotation",
              entete: "Cotation",
              rendu: (c) => (
                <Link href={`/cotations/${c.id}`} className="font-semibold text-primary underline">
                  {c.numero ?? `Brouillon n° ${c.id}`}
                </Link>
              ),
            },
            { cle: "produit", entete: "Produit", rendu: (c) => c.produitCode },
            { cle: "souscripteur", entete: "Souscripteur", rendu: (c) => c.souscripteur },
            { cle: "auteur", entete: "Demandeur", rendu: (c) => c.auteurIdentifiant },
            { cle: "raisons", entete: "Raison", rendu: (c) => c.raisonsValidation.join(", ") },
            { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (c) => (c.ttc ? f(c.ttc) : "—") },
            {
              cle: "action",
              entete: "Action",
              alignement: "droite",
              rendu: (c) => (
                <LienBouton href={`/cotations/${c.id}`} variante="secondaire">
                  Ouvrir
                </LienBouton>
              ),
            },
          ]}
        />
      </Carte>

      {/* Primes à composer & Contrats à valider */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Carte titre="Primes à composer" description="Produits tarifés par garanties nécessitant la composition de prime par la Technique.">
          <Tableau
            legende="Primes à composer"
            lignes={t.aComposer}
            cleLigne={(c) => String(c.id)}
            messageVide="Aucune prime en attente de composition."
            colonnes={[
              {
                cle: "id",
                entete: "Brouillon",
                rendu: (c) => (
                  <Link href={`/cotations/${c.id}`} className="font-medium text-primary underline">
                    N° {c.id} ({c.produitCode})
                  </Link>
                ),
              },
              { cle: "client", entete: "Client", rendu: (c) => c.souscripteur },
              { cle: "date", entete: "Créé le", rendu: (c) => formaterDate(c.creeLe) },
              {
                cle: "action",
                entete: "Action",
                alignement: "droite",
                rendu: (c) => (
                  <LienBouton href={`/cotations/${c.id}`} variante="secondaire">
                    Composer
                  </LienBouton>
                ),
              },
            ]}
          />
        </Carte>

        <Carte titre="Contrats sous double validation" description="Contrats dont le montant TTC dépasse le seuil paramétré.">
          <Tableau
            legende="Contrats à valider"
            lignes={t.contratsAValider}
            cleLigne={(v) => String(v.id)}
            messageVide="Aucune demande de validation de contrat."
            colonnes={[
              { cle: "police", entete: "Police", rendu: (v) => v.policeNumero },
              { cle: "produit", entete: "Produit", rendu: (v) => v.produitCode },
              { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (v) => f(v.ttc) },
              { cle: "seuil", entete: "Seuil", alignement: "droite", rendu: (v) => f(v.seuil) },
              { cle: "demandeur", entete: "Demandeur", rendu: (v) => v.demandeur },
            ]}
          />
        </Carte>
      </div>

      {/* Barèmes et modèles */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Carte titre="Barèmes en cours (brouillons)" description="Barèmes créés en cours de configuration ou de test.">
          <Tableau
            legende="Barèmes brouillons"
            lignes={t.baremesBrouillons}
            cleLigne={(b) => String(b.id)}
            messageVide="Aucun brouillon de barème en cours."
            colonnes={[
              { cle: "produit", entete: "Produit", rendu: (b) => `${b.produitCode} — ${b.produitLibelle}` },
              { cle: "effet", entete: "Effet", rendu: (b) => formaterDate(b.dateEffet) },
              { cle: "modifie", entete: "Modifié le", rendu: (b) => formaterDate(b.modifieLe) },
              {
                cle: "action",
                entete: "Action",
                alignement: "droite",
                rendu: (b) => (
                  <LienBouton href={`/parametrage/produits/${b.produitCode}`} variante="secondaire">
                    Gérer
                  </LienBouton>
                ),
              },
            ]}
          />
        </Carte>

        <div>
          <h3 className={TITRE_SOUS_SECTION}>Transformation par produit</h3>
          <Tableau
            legende="Transformation par produit"
            lignes={t.transformation.parProduit}
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
    </main>
  );
}

