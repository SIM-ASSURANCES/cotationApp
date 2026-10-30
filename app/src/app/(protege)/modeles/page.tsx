import Link from "next/link";
import { redirect } from "next/navigation";

import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { FormulaireCreationModele } from "@/composants/FormulaireCreationModele";
import { Carte, EnTetePage, LienBouton, Pastille, Tableau, type ColonneTableau } from "@/composants/ui";
import { cx } from "@/composants/ui/classes";
import { formaterDate } from "@/domaine/calcul/dates";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { historiqueSeuilListe, lireSeuilListe, listerModeles, type LigneModele } from "@/serveur/modeles";
import { aujourdhui, listerBranchesPrincipales, listerProduits } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";

import { creerUnModele, enregistrerLeSeuil } from "./actions";
import { PastilleVersion } from "./pastille-version";

const COLONNES: ColonneTableau<LigneModele>[] = [
  {
    cle: "code",
    entete: "Code",
    rendu: (m) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Link href={`/modeles/${m.id}`} className="font-semibold text-primary hover:underline">
          {m.code || "—"}
        </Link>
        {m.codeCgManquant ? (
          <Pastille ton="avertissement">Code CG manquant</Pastille>
        ) : null}
      </span>
    ),
  },
  {
    cle: "type",
    entete: "Type",
    rendu: (m) => (
      <>
        <span className="font-medium text-foreground">{m.libelleType}</span>
        {m.precision ? <span className="block text-xs text-muted-foreground">{m.precision}</span> : null}
      </>
    ),
  },
  { cle: "libelle", entete: "Libellé", rendu: (m) => m.libelle },
  {
    cle: "branche",
    entete: "Branche",
    rendu: (m) =>
      m.branchePrincipaleLibelle ? (
        <span className="text-xs font-semibold text-foreground">{m.branchePrincipaleLibelle}</span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Transversal / Commun
        </span>
      ),
  },
  { cle: "produit", entete: "Produit", rendu: (m) => m.produitCode ?? "commun" },
  { cle: "vigueur", entete: "En vigueur", rendu: (m) => (m.enVigueur ? `v${m.enVigueur.numero} depuis le ${formaterDate(m.enVigueur.dateEffet)}` : "aucune") },
  {
    cle: "derniere",
    entete: "Dernière version",
    rendu: (m) =>
      m.derniere ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>v{m.derniere.numero}</span>
          <PastilleVersion statut={m.derniere.statut} libelle={m.derniere.libelleStatut} />
        </span>
      ) : (
        "aucun dépôt"
      ),
  },
];

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

  const [modeles, seuil, historique, produits, branches] = await Promise.all([
    listerModeles(utilisateur),
    lireSeuilListe(),
    historiqueSeuilListe(utilisateur),
    peutAgir(depot) ? listerProduits(utilisateur) : Promise.resolve([]),
    listerBranchesPrincipales(utilisateur),
  ]);

  // Filtrage des modèles selon la branche sélectionnée
  const modelesFiltres =
    brancheChoisie === "TRANSVERSAL"
      ? modeles.filter((m) => !m.branchePrincipale)
      : brancheChoisie
        ? modeles.filter((m) => m.branchePrincipale === brancheChoisie)
        : modeles;

  const nbTransversaux = modeles.filter((m) => !m.branchePrincipale).length;

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Modèles Word"
        sousTitre="Bibliothèque des modèles (CDC §6) : chaque dépôt est contrôlé, puis conservé comme une version qui n'est jamais écrasée. La Technique dépose et soumet ; un autre profil (Direction Générale) publie."
      />
      <p>
        <LienBouton href="/modeles/aide">Aide à la rédaction des modèles : syntaxe, filtres et dictionnaire des champs</LienBouton>
      </p>

      {/* Rangement par branches : Onglets / Filtres rapides */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3 text-sm">
          <Link
            href="/modeles"
            className={cx(
              "rounded-lg px-3 py-1.5 transition-colors font-medium text-xs",
              !brancheChoisie
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Tous les modèles ({modeles.length})
          </Link>
          {branches.map((b) => {
            const nb = modeles.filter((m) => m.branchePrincipale === b.code).length;
            const actif = brancheChoisie === b.code;
            return (
              <Link
                key={b.code}
                href={`/modeles?branche=${b.code}`}
                className={cx(
                  "rounded-lg px-3 py-1.5 transition-colors font-medium text-xs",
                  actif
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {b.libelle} ({nb})
              </Link>
            );
          })}
          <Link
            href="/modeles?branche=TRANSVERSAL"
            className={cx(
              "rounded-lg px-3 py-1.5 transition-colors font-medium text-xs",
              brancheChoisie === "TRANSVERSAL"
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            Transversaux & Communs ({nbTransversaux})
          </Link>
        </div>

        <Tableau
          colonnes={COLONNES}
          lignes={modelesFiltres}
          cleLigne={(m) => String(m.id)}
          messageVide={brancheChoisie ? "Aucun modèle enregistré pour cette branche." : "Aucun modèle."}
          legende="Modèles Word"
        />
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
