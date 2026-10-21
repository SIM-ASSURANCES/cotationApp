import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Carte, EnTetePage, LienBouton, ListeDefinitions, PastilleStatut, Tableau, type ColonneTableau, type ElementDefinition } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { listerPiecesClientPortefeuille, type PieceClientPortefeuille } from "@/serveur/portefeuille";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const f = (m: string) => formaterMontant(montant(m));

type LigneCotationClient = PieceClientPortefeuille["cotations"][number];

export default async function PagePortefeuilleClient(
  props: { params: Promise<{ branche: string; produit: string; client: string }> },
) {
  const { branche: codeBranche, produit: codeProduit, client: identifiantClient } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let vue: PieceClientPortefeuille;
  try {
    vue = await listerPiecesClientPortefeuille(utilisateur, codeBranche, codeProduit, identifiantClient);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!vue) notFound();

  const { branche, produit, client, cotations } = vue;

  const ficheClient: ElementDefinition[] = [
    { libelle: "Identifiant", valeur: client.identifiant },
    { libelle: "Nom / Raison sociale", valeur: client.nom },
    { libelle: "Type", valeur: client.type === "MORALE" ? "Personne morale" : "Personne physique" },
    { libelle: "Téléphone", valeur: client.telephone },
    { libelle: "E-mail", valeur: client.email },
    { libelle: "Adresse", valeur: client.adresse },
  ];

  const colonnes: ColonneTableau<LigneCotationClient>[] = [
    {
      cle: "cotation",
      entete: "Cotation",
      className: "font-medium",
      rendu: (c) => (
        <Link href={`/cotations/${c.id}`} className="font-semibold text-primary underline">
          {c.numero ?? `Brouillon n° ${c.id}`}
        </Link>
      ),
    },
    {
      cle: "statut",
      entete: "Statut",
      rendu: (c) => <PastilleStatut libelle={c.statutLibelle} />,
    },
    {
      cle: "periode",
      entete: "Période",
      rendu: (c) => `${c.dateEffet} → ${c.dateEcheance}`,
    },
    {
      cle: "ttc",
      entete: "Montant TTC",
      alignement: "droite",
      className: "font-semibold",
      rendu: (c) => (c.ttc ? `${f(c.ttc)} F` : "—"),
    },
    {
      cle: "police",
      entete: "Police (contrat)",
      rendu: (c) =>
        c.police ? (
          <span className="font-medium text-foreground">
            {c.police.numero}
          </span>
        ) : (
          <span className="text-neutral">—</span>
        ),
    },
    {
      cle: "actions",
      entete: "Action",
      alignement: "droite",
      rendu: (c) => (
        <LienBouton href={`/cotations/${c.id}`} variante="secondaire">
          Ouvrir la fiche
        </LienBouton>
      ),
    },
  ];

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={client.nom}
        sousTitre={`Pièces du client sur le produit ${produit.code} (${branche.libelle}).`}
        filAriane={[
          { libelle: "Portefeuille", href: "/portefeuille" },
          { libelle: branche.libelle, href: `/portefeuille/${branche.code}` },
          { libelle: produit.code, href: `/portefeuille/${branche.code}/${produit.code}` },
          { libelle: client.identifiant },
        ]}
      />

      <Carte titre="Caractéristiques du client">
        <ListeDefinitions elements={ficheClient} />
      </Carte>

      <Carte titre="Cotations et contrats">
        <Tableau
          colonnes={colonnes}
          lignes={cotations}
          cleLigne={(c) => String(c.id)}
          messageVide="Aucune pièce trouvée pour ce souscripteur."
          legende={`Pièces de ${client.nom} sur ${produit.code}`}
        />
      </Carte>
    </main>
  );
}

