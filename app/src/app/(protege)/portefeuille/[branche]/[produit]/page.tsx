import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EnTetePage, LienBouton, Pastille, Tableau, type ColonneTableau } from "@/composants/ui";
import { listerClientsPortefeuille, type ClientPortefeuille } from "@/serveur/portefeuille";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

export default async function PagePortefeuilleProduit(props: { params: Promise<{ branche: string; produit: string }> }) {
  const { branche: codeBranche, produit: codeProduit } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let vue;
  try {
    vue = await listerClientsPortefeuille(utilisateur, codeBranche, codeProduit);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!vue) notFound();

  const { branche, produit, clients } = vue;

  const colonnes: ColonneTableau<ClientPortefeuille>[] = [
    {
      cle: "identifiant",
      entete: "Identifiant",
      className: "font-medium",
      rendu: (c) => (
        <Link
          href={`/portefeuille/${branche.code}/${produit.code}/${c.identifiant}`}
          className="font-semibold text-primary underline"
        >
          {c.identifiant}
        </Link>
      ),
    },
    {
      cle: "nom",
      entete: "Nom / Raison sociale",
      rendu: (c) => c.nom,
    },
    {
      cle: "type",
      entete: "Type",
      rendu: (c) => (
        <Pastille ton="neutre">
          {c.type === "MORALE" ? "Morale" : "Physique"}
        </Pastille>
      ),
    },
    {
      cle: "contact",
      entete: "Contact",
      rendu: (c) => (
        <span>
          {c.telephone}
          {c.email && c.email !== "—" ? <span className="block text-xs text-neutral">{c.email}</span> : null}
        </span>
      ),
    },
    {
      cle: "cotations",
      entete: "Cotations",
      alignement: "droite",
      rendu: (c) => c.nombreCotations,
    },
    {
      cle: "polices",
      entete: "Contrats émis",
      alignement: "droite",
      rendu: (c) => c.nombrePolices,
    },
    {
      cle: "actions",
      entete: "Action",
      alignement: "droite",
      rendu: (c) => (
        <LienBouton href={`/portefeuille/${branche.code}/${produit.code}/${c.identifiant}`} variante="secondaire">
          Voir les pièces
        </LienBouton>
      ),
    },
  ];

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={`${produit.libelle} (${produit.code})`}
        sousTitre={`Portefeuille de clients et prospects sur ce produit (Branche : ${branche.libelle}).`}
        filAriane={[
          { libelle: "Portefeuille", href: "/portefeuille" },
          { libelle: branche.libelle, href: `/portefeuille/${branche.code}` },
          { libelle: produit.code },
        ]}
      />

      <Tableau
        colonnes={colonnes}
        lignes={clients}
        cleLigne={(c) => c.identifiant}
        messageVide="Aucun client n'a encore souscrit ou coté pour ce produit."
        legende={`Souscripteurs du produit ${produit.code}`}
      />
    </main>
  );
}

