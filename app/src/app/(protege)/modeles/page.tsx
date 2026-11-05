import Link from "next/link";
import { redirect } from "next/navigation";

import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { FormulaireCreationModele } from "@/composants/FormulaireCreationModele";
import { Carte, EnTetePage, LienBouton } from "@/composants/ui";
import { cx } from "@/composants/ui/classes";
import { formaterDate } from "@/domaine/calcul/dates";
import { peutAgir, peutLire } from "@/domaine/droits";
import { regrouperParProduit } from "@/domaine/documents/regroupement-modeles";
import { niveauDuProfil } from "@/serveur/droits";
import { historiqueSeuilListe, lireSeuilListe, listerBranchesDesModeles, listerModeles, listerModelesAPublier, listerProduitsDesModeles } from "@/serveur/modeles";
import { aujourdhui, listerProduits } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";

import { creerUnModele, enregistrerLeSeuil } from "./actions";
import { GroupeBrancheModeles, TableauAPublier } from "./groupes-modeles";

const ONGLET = "inline-flex min-h-10 items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors lg:min-h-0";
const ONGLET_ACTIF = "bg-primary text-primary-foreground font-semibold";
const ONGLET_INACTIF = "bg-muted text-neutral hover:text-foreground";

export default async function PageModeles(props: PageProps<"/modeles">) {
  const utilisateur = await exigerUtilisateur();
  const searchParams = await props.searchParams;
  const brancheChoisie = typeof searchParams.branche === "string" ? searchParams.branche.trim() : "";

  const [depot, publication, parametrage] = await Promise.all([
    niveauDuProfil(utilisateur.profil, "DEPOSER_MODELE"),
    niveauDuProfil(utilisateur.profil, "PUBLIER_MODELE"),
    niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"),
  ]);
  if (!peutLire(depot) && !peutLire(publication)) redirect("/acces-refuse");

  // « À valider / À publier » : réservé au droit de publication (aussi contrôlé dans `listerModelesAPublier`) ; l'onglet et son compteur
  // n'existent que pour ce profil.
  const peutPublier = peutAgir(publication);
  const vueAPublier = peutPublier && searchParams.vue === "a-publier";

  const [modeles, seuil, historique, produits, branches, produitsDesModeles, aPublier] = await Promise.all([
    listerModeles(utilisateur),
    lireSeuilListe(),
    historiqueSeuilListe(utilisateur),
    peutAgir(depot) ? listerProduits(utilisateur) : Promise.resolve([]),
    listerBranchesDesModeles(utilisateur),
    listerProduitsDesModeles(utilisateur),
    peutPublier ? listerModelesAPublier(utilisateur) : Promise.resolve([]),
  ]);

  // Un produit désactivé sans modèle n'apporte que du bruit (trois « manquants ») : il ne figure que s'il porte des modèles.
  const produitsARanger = produitsDesModeles.filter((p) => p.actif || modeles.some((m) => m.produitCode === p.code));
  const nbTransversaux = modeles.filter((m) => !m.branchePrincipale).length;
  const lienOnglet = (actif: boolean) => cx(ONGLET, actif ? ONGLET_ACTIF : ONGLET_INACTIF);

  // Branches à montrer : celle qui est choisie, sinon toutes (puis les modèles et produits sans branche).
  const groupes =
    brancheChoisie === "TRANSVERSAL"
      ? [{ titre: undefined, groupe: regrouperParProduit(null, produitsARanger, modeles) }]
      : brancheChoisie
        ? [{ titre: undefined, groupe: regrouperParProduit(brancheChoisie, produitsARanger, modeles) }]
        : [
            ...branches.map((b) => ({ titre: b.libelle as string | undefined, groupe: regrouperParProduit(b.code, produitsARanger, modeles) })),
            { titre: "Transversaux et communs" as string | undefined, groupe: regrouperParProduit(null, produitsARanger, modeles) },
          ];
  const rienAMontrer = groupes.every(({ groupe }) => groupe.produits.length === 0 && groupe.communs.length === 0);

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Modèles Word"
        sousTitre="Bibliothèque des modèles (CDC §6) : chaque dépôt est contrôlé, puis conservé comme une version qui n'est jamais écrasée. La Technique dépose et soumet ; un autre profil (Direction Générale) publie."
      />
      <p>
        <LienBouton href="/modeles/aide">Aide à la rédaction des modèles : syntaxe, filtres et dictionnaire des champs</LienBouton>
      </p>

      {/* Rangement par branches, puis par produit : onglets */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3 text-sm">
          <Link href="/modeles" className={lienOnglet(!brancheChoisie && !vueAPublier)}>
            Tous les modèles ({modeles.length})
          </Link>
          {branches.map((b) => {
            const nb = modeles.filter((m) => m.branchePrincipale === b.code).length;
            return (
              <Link key={b.code} href={`/modeles?branche=${b.code}`} className={lienOnglet(!vueAPublier && brancheChoisie === b.code)}>
                {b.libelle} ({nb})
              </Link>
            );
          })}
          <Link href="/modeles?branche=TRANSVERSAL" className={lienOnglet(!vueAPublier && brancheChoisie === "TRANSVERSAL")}>
            Transversaux & Communs ({nbTransversaux})
          </Link>
          {peutPublier ? (
            <Link href="/modeles?vue=a-publier" className={lienOnglet(vueAPublier)}>
              À valider / À publier ({aPublier.length})
            </Link>
          ) : null}
        </div>

        {vueAPublier ? (
          <TableauAPublier lignes={aPublier} />
        ) : rienAMontrer ? (
          <p className="text-sm text-muted-foreground">{brancheChoisie ? "Aucun modèle enregistré pour cette branche." : "Aucun modèle."}</p>
        ) : (
          <div className="space-y-8">
            {groupes.map(({ titre, groupe }) => (
              <GroupeBrancheModeles key={groupe.branche ?? "transversal"} groupe={groupe} titre={titre} />
            ))}
          </div>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Formulaire intelligent de création de modèle */}
        {peutAgir(depot) ? (
          <Carte titre="Créer un modèle">
            <FormulaireCreationModele action={creerUnModele} produits={produits} branches={branches} />
          </Carte>
        ) : null}

        <Carte
          titre="Listes longues (CDC §6.5)"
          description={
            <>
              Au-delà de <strong>{seuil}</strong> lignes, une liste (assurés, bénéficiaires, formules, échéances) est remplacée dans le corps du document par
              « Voir annexe – … » et rendue en entier par le modèle d&apos;annexe, à la fin du PDF.
            </>
          }
        >
          {historique.length > 0 ? (
            <ul className="mb-4 space-y-1 text-sm text-foreground">
              {historique.map((h) => (
                <li key={h.dateEffet}>
                  {h.valeur} à partir du {formaterDate(h.dateEffet)} (par {h.creePar})
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">Valeur par défaut du CDC : 10.</p>
          )}
          {peutAgir(parametrage) ? (
            <FormulaireAction action={enregistrerLeSeuil} garderApresSucces libelleBouton="Enregistrer le seuil">
              <Champ nom="seuil" libelle="Nouveau seuil (nombre de lignes)" autoComplete="off" />
              <ChampDate nom="dateEffet" libelle="À partir du (JJ/MM/AAAA, jamais dans le passé)" valeur={aujourdhui()} min={aujourdhui()} />
            </FormulaireAction>
          ) : null}
        </Carte>
      </div>
    </main>
  );
}
