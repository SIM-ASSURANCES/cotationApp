import Link from "next/link";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, EnTetePage, ListeDeroulante, Tableau, type ColonneTableau } from "@/composants/ui";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerBranches, listerProduits } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { creerUnProduit } from "./actions";

type LigneProduit = Awaited<ReturnType<typeof listerProduits>>[number];

const COLONNES: ColonneTableau<LigneProduit>[] = [
  {
    cle: "code",
    entete: "Code",
    rendu: (p) => (
      <Link href={`/parametrage/produits/${p.code}`} className="font-medium text-primary underline">
        {p.code}
      </Link>
    ),
  },
  { cle: "libelle", entete: "Libellé", rendu: (p) => p.libelle },
  { cle: "gamme", entete: "Gamme", rendu: (p) => p.gamme },
  { cle: "branche", entete: "Branche", rendu: (p) => p.branche },
  {
    cle: "versions",
    entete: "Versions",
    rendu: (p) => (p.versions.length === 0 ? "aucune" : `${p.versions.length} (depuis le ${p.versions[p.versions.length - 1]}, dernière du ${p.versions[0]})`),
  },
];

export default async function PageProduits() {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [produits, branches, niveau] = await Promise.all([listerProduits(utilisateur), listerBranches(utilisateur), niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS")]);

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Produits"
        sousTitre="Aucun produit n'est codé en dur (CDC §2.3) : un produit, ses formules et ses règles de calcul se paramètrent ici, par versions datées."
      />

      {peutAgir(niveau) ? (
        <Carte titre="Créer un produit" className="max-w-md">
          <FormulaireAction action={creerUnProduit} libelleBouton="Créer">
            <Champ nom="code" libelle="Code (ex. RELAXSANTE)" autoComplete="off" />
            <Champ nom="libelle" libelle="Libellé" autoComplete="off" />
            <Champ nom="gamme" libelle="Gamme (ex. RELAX)" autoComplete="off" />
            <div className="mb-4">
              <ListeDeroulante
                label="Branche"
                name="branche"
                required
                invite="Choisir une branche"
                options={branches.filter((b) => b.actif).map((b) => ({ valeur: b.code, libelle: `${b.code} · ${b.libelle}` }))}
              />
            </div>
          </FormulaireAction>
        </Carte>
      ) : null}

      <Tableau colonnes={COLONNES} lignes={produits} cleLigne={(p) => p.code} messageVide="Aucun produit." legende="Produits" />
    </main>
  );
}
