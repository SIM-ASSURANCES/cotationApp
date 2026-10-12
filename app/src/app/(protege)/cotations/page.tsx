import Link from "next/link";

import { EnTetePage, LienBouton, PastilleStatut, Tableau } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT, STATUTS, estStatut } from "@/domaine/cotation/statuts";
import { peutAgir, peutLire } from "@/domaine/droits";
import { listerCotations } from "@/serveur/cotations";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

const formatDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Africa/Abidjan" });

export default async function PageCotations(props: PageProps<"/cotations">) {
  const utilisateur = await exigerDroit("CREER_COTATION", peutLire);
  const q = await props.searchParams;
  const statut = typeof q.statut === "string" && estStatut(q.statut) ? q.statut : undefined;
  const [cotations, niveau] = await Promise.all([listerCotations(utilisateur, { statut }), niveauDuProfil(utilisateur.profil, "CREER_COTATION")]);

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Cotations"
        actions={
          <>
            {peutAgir(niveau) ? <LienBouton variante="principal" href="/cotations/nouvelle">Nouvelle cotation</LienBouton> : null}
            <LienBouton href="/clients">Clients</LienBouton>
          </>
        }
      />
      {/* Filtre actif en bouton principal, les autres en secondaire : la page n'a pas (encore) de composant « puce de filtre ». */}
      <nav aria-label="Filtre par statut" className="flex flex-wrap gap-2">
        <LienBouton variante={!statut ? "principal" : "secondaire"} href="/cotations" aria-current={!statut ? "page" : undefined}>
          Tous
        </LienBouton>
        {STATUTS.map((s) => (
          <LienBouton key={s} variante={statut === s ? "principal" : "secondaire"} href={`/cotations?statut=${s}`} aria-current={statut === s ? "page" : undefined}>
            {LIBELLE_STATUT[s]}
          </LienBouton>
        ))}
      </nav>
      <Tableau
        legende="Cotations"
        lignes={cotations}
        cleLigne={(c) => String(c.id)}
        messageVide="Aucune cotation."
        colonnes={[
          {
            cle: "numero",
            entete: "N°",
            rendu: (c) => (
              <Link href={`/cotations/${c.id}`} className="font-medium text-primary underline">
                {c.numero ?? `Brouillon n° ${c.id}`}
              </Link>
            ),
          },
          { cle: "statut", entete: "Statut", rendu: (c) => <PastilleStatut libelle={LIBELLE_STATUT[c.statut]} /> },
          { cle: "produit", entete: "Produit", rendu: (c) => c.produit },
          { cle: "souscripteur", entete: "Souscripteur", rendu: (c) => c.souscripteur },
          { cle: "ttc", entete: "TTC (F CFA)", alignement: "droite", rendu: (c) => (c.aComposer ? "À composer" : c.ttc ? formaterMontant(montant(c.ttc)) : "—") },
          { cle: "validite", entete: "Valide jusqu'au", rendu: (c) => (c.dateValidite ? formatDate.format(new Date(`${c.dateValidite}T00:00:00Z`)) : "—") },
          { cle: "auteur", entete: "Auteur", rendu: (c) => c.auteur },
        ]}
      />
    </main>
  );
}
