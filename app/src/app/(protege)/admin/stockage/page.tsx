import { redirect } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Carte, EnTetePage, Tableau } from "@/composants/ui";
import { exigerUtilisateur } from "@/serveur/session";
import { lireEtatStockage } from "@/serveur/surveillance";
import { ErreurAcces } from "@/serveur/types";

import { relancerLesEcritures } from "./actions";

const heure = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });

/** Stockage des documents émis (T14, D11) : écritures différées, reprise automatique et relance manuelle. */
export default async function PageStockage() {
  const utilisateur = await exigerUtilisateur();
  let etat;
  try {
    etat = await lireEtatStockage(utilisateur);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Stockage des documents émis"
        sousTitre="Quand le stockage est indisponible au moment d'une émission, le document est émis quand même : son PDF attend ici, il reste téléchargeable, et la file de tâches retente l'écriture avec des délais croissants (30 s, 1 min, 2 min…). Chaque échec et chaque reprise sont inscrits au journal d'audit."
      />
      {etat.enAttente === 0 ? (
        <Bandeau ton="succes">Aucune écriture en attente : tous les documents émis sont dans le stockage.</Bandeau>
      ) : (
        <>
          <Carte className="max-w-3xl">
            <Bandeau ton="avertissement" className="mb-4">
              {etat.enAttente} document(s) en attente d'écriture. Dernière erreur : {etat.derniereErreur}
            </Bandeau>
            <FormulaireAction action={relancerLesEcritures} libelleBouton="Relancer maintenant">
              <span />
            </FormulaireAction>
          </Carte>
          <Tableau
            legende="Documents en attente d'écriture"
            lignes={etat.lignes}
            cleLigne={(l) => String(l.documentId)}
            colonnes={[
              {
                cle: "document",
                entete: "Document",
                rendu: (l) => (
                  <a href={`/api/documents/${l.documentId}`} className="text-primary underline">
                    {l.numero} v{l.version}
                  </a>
                ),
              },
              { cle: "chemin", entete: "Chemin", rendu: (l) => <span className="break-all font-mono text-xs">{l.chemin}</span> },
              { cle: "depuis", entete: "En attente depuis", rendu: (l) => heure(l.creeLe) },
              { cle: "essais", entete: "Essais", alignement: "droite", rendu: (l) => l.tentatives },
              { cle: "dernier", entete: "Dernier essai", rendu: (l) => heure(l.dernierEssai) },
              { cle: "erreur", entete: "Erreur", rendu: (l) => l.derniereErreur },
            ]}
          />
        </>
      )}
    </main>
  );
}
