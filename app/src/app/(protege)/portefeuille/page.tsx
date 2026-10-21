import Link from "next/link";
import { redirect } from "next/navigation";

import { EnTetePage, LienBouton, Tableau, type ColonneTableau } from "@/composants/ui";
import { listerBranchesPortefeuille, type BranchePortefeuille } from "@/serveur/portefeuille";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const COLONNES: ColonneTableau<BranchePortefeuille>[] = [
  {
    cle: "branche",
    entete: "Branche",
    className: "font-medium",
    rendu: (b) => (
      <Link href={`/portefeuille/${b.code}`} className="font-semibold text-primary underline">
        {b.libelle} <span className="text-xs text-neutral">({b.code})</span>
      </Link>
    ),
  },
  {
    cle: "produits",
    entete: "Produits",
    alignement: "droite",
    rendu: (b) => b.nombreProduits,
  },
  {
    cle: "clients",
    entete: "Clients",
    alignement: "droite",
    rendu: (b) => b.nombreClients,
  },
  {
    cle: "polices",
    entete: "Contrats émis",
    alignement: "droite",
    rendu: (b) => b.nombrePolices,
  },
  {
    cle: "actions",
    entete: "Action",
    alignement: "droite",
    rendu: (b) => (
      <LienBouton href={`/portefeuille/${b.code}`} variante="secondaire">
        Parcourir
      </LienBouton>
    ),
  },
];

export default async function PagePortefeuille() {
  const utilisateur = await exigerUtilisateur();
  let branches: BranchePortefeuille[];
  try {
    branches = await listerBranchesPortefeuille(utilisateur);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Portefeuille"
        sousTitre="Exploration hiérarchique du portefeuille : Branche → Produit → Client → Cotation → Contrat."
        filAriane={[{ libelle: "Portefeuille" }]}
      />

      <Tableau
        colonnes={COLONNES}
        lignes={branches}
        cleLigne={(b) => b.code}
        messageVide="Aucune branche principale trouvée."
        legende="Branches principales du portefeuille"
      />
    </main>
  );
}

