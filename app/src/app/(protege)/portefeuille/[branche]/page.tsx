import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EnTetePage, LienBouton, Pastille, Tableau, type ColonneTableau } from "@/composants/ui";
import { listerProduitsPortefeuille, type ProduitPortefeuille } from "@/serveur/portefeuille";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

export default async function PagePortefeuilleBranche(props: { params: Promise<{ branche: string }> }) {
  const { branche: codeBranche } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let vue;
  try {
    vue = await listerProduitsPortefeuille(utilisateur, codeBranche);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!vue) notFound();

  const { branche, produits } = vue;

  const colonnes: ColonneTableau<ProduitPortefeuille>[] = [
    {
      cle: "produit",
      entete: "Produit",
      className: "font-medium",
      rendu: (p) => (
        <Link href={`/portefeuille/${branche.code}/${p.code}`} className="font-semibold text-primary underline">
          {p.libelle} <span className="text-xs text-neutral">({p.code})</span>
        </Link>
      ),
    },
    {
      cle: "gamme",
      entete: "Gamme",
      rendu: (p) => p.gamme,
    },
    {
      cle: "mode",
      entete: "Tarification",
      rendu: (p) => (
        <Pastille ton={p.modeTarification === "GARANTIES" ? "info" : "neutre"}>
          {p.modeTarification === "GARANTIES" ? "Par garanties" : "Par formule"}
        </Pastille>
      ),
    },
    {
      cle: "clients",
      entete: "Clients",
      alignement: "droite",
      rendu: (p) => p.nombreClients,
    },
    {
      cle: "cotations",
      entete: "Cotations",
      alignement: "droite",
      rendu: (p) => p.nombreCotations,
    },
    {
      cle: "polices",
      entete: "Contrats émis",
      alignement: "droite",
      rendu: (p) => p.nombrePolices,
    },
    {
      cle: "actions",
      entete: "Action",
      alignement: "droite",
      rendu: (p) => (
        <LienBouton href={`/portefeuille/${branche.code}/${p.code}`} variante="secondaire">
          Parcourir
        </LienBouton>
      ),
    },
  ];

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={`${branche.libelle} (${branche.code})`}
        sousTitre="Produits d'assurance rattachés à cette branche principale."
        filAriane={[{ libelle: "Portefeuille", href: "/portefeuille" }, { libelle: branche.libelle }]}
      />

      <Tableau
        colonnes={colonnes}
        lignes={produits}
        cleLigne={(p) => p.code}
        messageVide="Aucun produit rattaché à cette branche."
        legende={`Produits de la branche ${branche.libelle}`}
      />
    </main>
  );
}

