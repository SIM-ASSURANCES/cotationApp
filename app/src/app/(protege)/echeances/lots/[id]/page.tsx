import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BarreProgression, RafraichissementAuto } from "@/composants/RafraichissementAuto";
import { Bandeau, Carte, EnTetePage, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { lireLotEcheances } from "@/serveur/echeances";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const LIBELLE_STATUT: Record<string, string> = { A_FAIRE: "À faire", PRODUIT: "Produit", DEJA_PRODUIT: "Déjà produit", SANS_OBJET: "Sans objet", ECHEC: "En échec" };

/** Avancement d'un lot d'avis et de relances (file de tâches) : rafraîchi toutes les 3 secondes tant qu'il tourne. */
export default async function PageLotEcheances(props: PageProps<"/echeances/lots/[id]">) {
  const { id } = await props.params;
  const { horsFile } = await props.searchParams;
  const utilisateur = await exigerUtilisateur();
  let lot;
  try {
    lot = Number.isInteger(Number(id)) ? await lireLotEcheances(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!lot) notFound();
  const enCours = lot.statut === "EN_COURS";

  // Aucun identifiant propre à un élément du lot : l'indice sert de clé (la liste est figée par le lot).
  type Element = { e: (typeof lot.elements)[number]; i: number };
  const colonnes: ColonneTableau<Element>[] = [
    { cle: "document", entete: "Document", rendu: ({ e }) => (e.type === "AVIS_ECHEANCE" ? "Avis d'échéance" : `Relance niveau ${e.niveau}`) },
    { cle: "facture", entete: "Facture", rendu: ({ e }) => <Link href={`/factures/${e.factureId}`} className="text-primary underline">facture</Link> },
    { cle: "echeance", entete: "Échéance", rendu: ({ e }) => `n° ${e.echeanceNumero}` },
    { cle: "etat", entete: "État", rendu: ({ e }) => <PastilleStatut libelle={LIBELLE_STATUT[e.statut] ?? e.statut} /> },
    { cle: "numero", entete: "Numéro", rendu: ({ e }) => e.numero ?? "—" },
    { cle: "message", entete: "Message", rendu: ({ e }) => e.message ?? "" },
  ];

  return (
    <main className="space-y-6">
      <RafraichissementAuto actif={enCours} />
      <EnTetePage
        titre={`Lot n° ${lot.id} d'avis et de relances`}
        sousTitre={`Liste du ${formaterDate(lot.dateListe)}, lancé par ${lot.creePar}. Vous pouvez continuer à travailler : le lot tourne en tâche de fond.`}
        filAriane={[{ libelle: "Liste du jour", href: "/echeances" }, { libelle: `Lot n° ${lot.id}` }]}
      />
      {horsFile ? (
        <Bandeau ton="avertissement" role="alert">
          La file de tâches est injoignable : le lot sera traité au retour du travailleur. Prévenez l&apos;administrateur.
        </Bandeau>
      ) : null}
      <Carte>
        <BarreProgression faits={lot.faits} total={lot.total} libelle={enCours ? "Documents traités" : "Lot terminé"} />
        <ul className="flex flex-wrap gap-2">
          {Object.entries(lot.parStatut).map(([s, n]) => (
            <li key={s}>
              <PastilleStatut libelle={LIBELLE_STATUT[s] ?? s}>
                {LIBELLE_STATUT[s] ?? s} : {n}
              </PastilleStatut>
            </li>
          ))}
        </ul>
      </Carte>
      <Tableau colonnes={colonnes} lignes={lot.elements.map((e, i) => ({ e, i }))} cleLigne={({ i }) => String(i)} messageVide="Aucun document dans ce lot." legende="Documents du lot" />
    </main>
  );
}
