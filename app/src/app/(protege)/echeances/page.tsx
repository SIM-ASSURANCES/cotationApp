import Link from "next/link";
import { redirect } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { Bouton, Carte, EnTetePage, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { peutAgir } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listeDuJour, listerLotsEcheances, type ElementListe } from "@/serveur/echeances";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { genererDepuisLaListe } from "./actions";

const f = (m: string) => formaterMontant(montant(m));
const valeur = (e: ElementListe) => `${e.type}|${e.factureId}|${e.echeance.numero}|${e.niveau?.niveau ?? 0}`;

/**
 * Liste des avis ou des relances à produire. Les cellules portent des cases à cocher et des boutons d'envoi : ce sont ceux du
 * formulaire parent (FormulaireAction), le `Tableau` ne fait que les loger.
 */
function TableauAProduire({ lignes, agit, relances, legende }: { lignes: ElementListe[]; agit: boolean; relances: boolean; legende: string }) {
  const colonnes: ColonneTableau<ElementListe>[] = [
    ...(agit
      ? [
          {
            cle: "lot",
            entete: "Lot",
            // La case reste une vraie case native ; l'étiquette l'entoure pour offrir une cible tactile de 40 px sous lg.
            rendu: (e: ElementListe) => (
              <label className="grid size-10 place-items-center lg:size-auto">
                <input type="checkbox" name="selection" value={valeur(e)} defaultChecked className="size-4 accent-primary" aria-label={`Inclure ${e.factureNumero} échéance ${e.echeance.numero} dans le lot`} />
              </label>
            ),
          },
        ]
      : []),
    { cle: "facture", entete: "Facture", rendu: (e) => <Link href={`/factures/${e.factureId}`} className="text-primary underline">{e.factureNumero}</Link> },
    { cle: "police", entete: "Police", rendu: (e) => e.policeNumero },
    { cle: "souscripteur", entete: "Souscripteur", rendu: (e) => e.souscripteur },
    { cle: "echeance", entete: "Échéance", rendu: (e) => `n° ${e.echeance.numero}` },
    { cle: "date", entete: "Date", rendu: (e) => e.echeance.date },
    { cle: "montant", entete: "Montant", alignement: "droite", rendu: (e) => f(e.echeance.montant) },
    { cle: "reste", entete: "Reste dû", alignement: "droite", rendu: (e) => f(e.echeance.restant) },
    ...(relances
      ? [
          { cle: "retard", entete: "Retard", rendu: (e: ElementListe) => `${e.joursRetard} j` },
          { cle: "niveau", entete: "Niveau", rendu: (e: ElementListe) => `${e.niveau?.niveau} — ${e.niveau?.libelle}` },
        ]
      : [{ cle: "dans", entete: "Dans", rendu: (e: ElementListe) => `${-e.joursRetard} j` }]),
    ...(agit
      ? [
          {
            cle: "action",
            entete: "Action",
            rendu: (e: ElementListe) => (
              <Bouton type="submit" variante="secondaire" name="un" value={valeur(e)} className="py-1">
                Générer
              </Bouton>
            ),
          },
        ]
      : []),
  ];
  return <Tableau colonnes={colonnes} lignes={lignes} cleLigne={valeur} messageVide="Rien à produire." legende={legende} />;
}

/** Liste du jour (CDC §12) : avis d'échéance (J-x) et relances (J+x) à produire, recalculée depuis la base à chaque affichage. */
export default async function PageEcheances() {
  const utilisateur = await exigerUtilisateur();
  let liste, lots;
  try {
    [liste, lots] = await Promise.all([listeDuJour(utilisateur), listerLotsEcheances(utilisateur)]);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  const agit = peutAgir(await niveauDuProfil(utilisateur.profil, "EMETTRE_FACTURE"));
  const total = liste.avis.length + liste.relances.length;

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={`Avis d'échéance et relances du ${liste.date}`}
        sousTitre={
          "Échéances non payées des factures émises et non annulées, selon les délais de chaque produit (Produits → Avis et relances). Une échéance payée, " +
          "ou dont la facture est annulée par un avoir, ne produit plus rien : c'est vérifié aussi au moment de la génération. Un seul avis par " +
          "échéance, une seule relance par niveau. Aucun envoi automatique : les PDF se téléchargent depuis « Documents émis »."
        }
      />
      <FormulaireAction action={genererDepuisLaListe} libelleBouton={`Générer par lot les ${total} lignes cochées`}>
        <div className="mb-4 space-y-6">
          <Carte titre={`Avis d'échéance à produire (${liste.avis.length})`}>
            <TableauAProduire lignes={liste.avis} agit={agit} relances={false} legende="Avis d'échéance à produire" />
          </Carte>
          <Carte titre={`Relances à produire (${liste.relances.length})`}>
            <TableauAProduire lignes={liste.relances} agit={agit} relances legende="Relances à produire" />
          </Carte>
          {!agit || total === 0 ? <p className="text-sm text-neutral">{agit ? "Rien à générer aujourd'hui." : "Consultation seule."}</p> : null}
        </div>
      </FormulaireAction>

      <Carte titre="Derniers lots">
        <Tableau
          colonnes={[
            { cle: "lot", entete: "Lot", rendu: (l) => <Link href={`/echeances/lots/${l.id}`} className="text-primary underline">Lot n° {l.id}</Link> },
            { cle: "liste", entete: "Liste du", rendu: (l) => l.dateListe },
            { cle: "documents", entete: "Documents", alignement: "droite", rendu: (l) => l.total },
            { cle: "etat", entete: "État", rendu: (l) => <PastilleStatut libelle={l.statut === "TERMINE" ? "Terminé" : "En cours"} /> },
            { cle: "par", entete: "Lancé par", rendu: (l) => l.creePar },
          ]}
          lignes={lots}
          cleLigne={(l) => String(l.id)}
          messageVide="Aucun lot pour l'instant."
          legende="Derniers lots d'avis et de relances"
        />
      </Carte>
    </main>
  );
}
