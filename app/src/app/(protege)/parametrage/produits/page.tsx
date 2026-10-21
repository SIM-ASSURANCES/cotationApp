import Link from "next/link";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Bouton, Carte, EnTetePage, LienBouton, ListeDeroulante, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerBranches, listerBranchesPrincipales, listerProduits } from "@/serveur/parametrage";
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
  {
    cle: "branchePrincipale",
    entete: "Branche",
    rendu: (p) =>
      p.branchePrincipaleLibelle ? (
        <span>
          {p.branchePrincipaleLibelle} <span className="text-xs text-muted">({p.branchePrincipale})</span>
        </span>
      ) : (
        <PastilleStatut libelle="Branche à renseigner" />
      ),
  },
  { cle: "branche", entete: "Catégorie de taxe", rendu: (p) => p.branche },
  {
    cle: "versions",
    entete: "Versions",
    rendu: (p) => (p.versions.length === 0 ? "aucune" : `${p.versions.length} (depuis le ${formaterDate(p.versions[p.versions.length - 1])}, dernière du ${formaterDate(p.versions[0])})`),
  },
];

export default async function PageProduits({ searchParams }: { searchParams?: Promise<{ branche?: string }> }) {
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const { branche: filtreBranche } = (await searchParams) ?? {};
  const [produits, branchesPrincipales, branches, niveau] = await Promise.all([
    listerProduits(utilisateur, { branchePrincipale: filtreBranche }),
    listerBranchesPrincipales(utilisateur),
    listerBranches(utilisateur),
    niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"),
  ]);

  const branchesAffichees = filtreBranche
    ? branchesPrincipales.filter((b) => b.code === filtreBranche)
    : branchesPrincipales;
  const sansBranche = filtreBranche
    ? []
    : produits.filter((p) => !p.branchePrincipale);

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Produits"
        sousTitre="Aucun produit n'est codé en dur (CDC §2.3) : un produit est rattaché à l'une des 5 branches principales (classement) et à une catégorie de taxe (fiscalité), puis paramétré par versions datées."
      />

      {peutAgir(niveau) ? (
        <Carte titre="Créer un produit" className="max-w-md">
          <FormulaireAction action={creerUnProduit} libelleBouton="Créer">
            <Champ nom="code" libelle="Code (ex. RELAXSANTE)" autoComplete="off" />
            <Champ nom="libelle" libelle="Libellé" autoComplete="off" />
            <Champ nom="gamme" libelle="Gamme (ex. RELAX)" autoComplete="off" />
            <div className="mb-4">
              <ListeDeroulante
                label="Branche (classement)"
                name="branchePrincipale"
                required
                invite="Choisir une branche"
                options={branchesPrincipales.map((b) => ({ valeur: b.code, libelle: `${b.libelle} (${b.code})` }))}
              />
            </div>
            <div className="mb-4">
              <ListeDeroulante
                label="Catégorie de taxe (fiscalité)"
                name="branche"
                required
                invite="Choisir une catégorie de taxe"
                options={branches.filter((b) => b.actif).map((b) => ({ valeur: b.code, libelle: `${b.code} · ${b.libelle}` }))}
              />
            </div>
          </FormulaireAction>
        </Carte>
      ) : null}

      <Carte titre="Filtrer par branche">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <ListeDeroulante
              label="Branche"
              name="branche"
              defaultValue={filtreBranche ?? ""}
              invite="Toutes les branches"
              options={branchesPrincipales.map((b) => ({ valeur: b.code, libelle: `${b.libelle} (${b.code})` }))}
            />
          </div>
          <Bouton type="submit" variante="secondaire">
            Filtrer
          </Bouton>
          {filtreBranche ? (
            <LienBouton href="/parametrage/produits" variante="secondaire">
              Tout afficher
            </LienBouton>
          ) : null}
        </form>
      </Carte>

      {branchesAffichees.map((b) => {
        const prods = produits.filter((p) => p.branchePrincipale === b.code);
        return (
          <Carte key={b.code} titre={`${b.libelle} (${b.code})`} description={`${prods.length} produit(s) rattaché(s)`}>
            <Tableau
              colonnes={COLONNES}
              lignes={prods}
              cleLigne={(p) => p.code}
              messageVide="Aucun produit rattaché à cette branche."
              legende={`Produits de la branche ${b.libelle}`}
            />
          </Carte>
        );
      })}

      {sansBranche.length > 0 ? (
        <Carte titre="Autres produits" description="Produits dont la branche principale reste à renseigner">
          <Tableau
            colonnes={COLONNES}
            lignes={sansBranche}
            cleLigne={(p) => p.code}
            messageVide="Aucun produit sans branche."
            legende="Produits sans branche principale"
          />
        </Carte>
      ) : null}
    </main>
  );
}
