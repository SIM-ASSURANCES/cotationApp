import Link from "next/link";
import { redirect } from "next/navigation";

import { Bouton, Carte, Champ, EnTetePage, ListeDeroulante, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT_FACTURE, STATUTS_FACTURE } from "@/domaine/facturation/factures";
import { listerFactures, type LigneFactureLue } from "@/serveur/factures";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const f = (m: string) => formaterMontant(montant(m));

const COLONNES: ColonneTableau<LigneFactureLue>[] = [
  { cle: "numero", entete: "Numéro", rendu: (x) => <Link href={`/factures/${x.id}`} className="text-primary underline">{x.numero ?? `Brouillon n° ${x.id}`}</Link> },
  { cle: "type", entete: "Type", rendu: (x) => x.libelleType },
  { cle: "statut", entete: "Statut", rendu: (x) => <PastilleStatut libelle={x.libelleStatut} /> },
  { cle: "police", entete: "Police", rendu: (x) => <Link href={`/cotations/${x.cotationId}/factures`} className="text-primary underline">{x.policeNumero}</Link> },
  { cle: "souscripteur", entete: "Souscripteur", rendu: (x) => x.souscripteur },
  { cle: "emission", entete: "Émise le", rendu: (x) => x.dateEmission ?? "—" },
  { cle: "ttc", entete: "TTC", alignement: "droite", rendu: (x) => f(x.ttc) },
  { cle: "restant", entete: "Restant dû", alignement: "droite", rendu: (x) => (x.restantDu === null ? "—" : f(x.restantDu)) },
  // Le libellé du PDF en attente est celui d'avant la refonte ; la pastille suit la table unique des statuts.
  { cle: "pdf", entete: "PDF", rendu: (x) => (x.pdfEnAttente > 0 ? <PastilleStatut libelle="PDF en attente">En attente</PastilleStatut> : x.numero ? "Produit" : "—") },
];

export default async function PageFactures(props: PageProps<"/factures">) {
  const params = await props.searchParams;
  const texte = (nom: string) => (typeof params[nom] === "string" ? (params[nom] as string) : "");
  const filtres = { statut: texte("statut"), numero: texte("numero"), police: texte("police") };
  const utilisateur = await exigerUtilisateur();
  let lignes;
  try {
    lignes = await listerFactures(utilisateur, { statut: filtres.statut || undefined, numero: filtres.numero || undefined, police: filtres.police || undefined });
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Factures et avoirs"
        sousTitre="Une facture se prépare depuis la police (fiche de la cotation acceptée, lien « Factures »). Les 200 plus récentes."
      />
      <Carte>
        <form className="grid max-w-4xl gap-3 sm:grid-cols-4 sm:items-end" method="get">
          <ListeDeroulante
            label="Statut"
            name="statut"
            defaultValue={filtres.statut}
            options={[{ valeur: "", libelle: "Tous" }, ...STATUTS_FACTURE.map((s) => ({ valeur: s, libelle: LIBELLE_STATUT_FACTURE[s] }))]}
          />
          <Champ label="Numéro" name="numero" defaultValue={filtres.numero} />
          <Champ label="Police" name="police" defaultValue={filtres.police} />
          <div>
            <Bouton type="submit">Filtrer</Bouton>
          </div>
        </form>
      </Carte>
      <Tableau colonnes={COLONNES} lignes={lignes} cleLigne={(x) => String(x.id)} messageVide="Aucune facture." legende="Factures et avoirs" />
    </main>
  );
}
