import Link from "next/link";
import { redirect } from "next/navigation";

import { EnTetePage, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { listerLots, type ResumeLot } from "@/serveur/imports";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { LIBELLE_STATUT_LOT } from "./libelles";

const COLONNES: ColonneTableau<ResumeLot>[] = [
  {
    cle: "import",
    entete: "Import",
    rendu: (l) => (
      <Link href={`/imports/${l.id}`} className="text-primary underline">
        n° {l.id}
      </Link>
    ),
  },
  { cle: "police", entete: "Police", rendu: (l) => l.policeNumero },
  { cle: "fichier", entete: "Fichier", rendu: (l) => l.fichierNom },
  { cle: "total", entete: "Lignes", alignement: "droite", rendu: (l) => l.total },
  { cle: "erreurs", entete: "En erreur", alignement: "droite", rendu: (l) => l.erreurs },
  { cle: "etat", entete: "État", rendu: (l) => <PastilleStatut libelle={LIBELLE_STATUT_LOT[l.statut]} /> },
  { cle: "creePar", entete: "Déposé par", rendu: (l) => l.creePar },
];

/** Imports en masse (CDC §13) : les 100 plus récents. Un import se dépose depuis l'écran des adhérents d'une police mère. */
export default async function PageImports() {
  const utilisateur = await exigerUtilisateur();
  let lots;
  try {
    lots = await listerLots(utilisateur);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Imports en masse"
        sousTitre="Un import se dépose depuis l'écran des adhérents d'une police mère (fiche de la cotation acceptée, lien « Adhérents »)."
      />
      <Tableau colonnes={COLONNES} lignes={lots} cleLigne={(l) => String(l.id)} messageVide="Aucun import pour l'instant." legende="Imports en masse" />
    </main>
  );
}
