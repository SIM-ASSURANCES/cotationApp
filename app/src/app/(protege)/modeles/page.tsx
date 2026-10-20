import Link from "next/link";
import { redirect } from "next/navigation";

import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, EnTetePage, LienBouton, ListeDeroulante, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { LISTES_ANNEXE, REGLES, TYPES_MODELE } from "@/domaine/documents/modeles";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { historiqueSeuilListe, lireSeuilListe, listerModeles, type LigneModele } from "@/serveur/modeles";
import { aujourdhui, listerProduits } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";

import { creerUnModele, enregistrerLeSeuil } from "./actions";
import { PastilleVersion } from "./pastille-version";

const COLONNES: ColonneTableau<LigneModele>[] = [
  {
    cle: "code",
    entete: "Code",
    rendu: (m) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Link href={`/modeles/${m.id}`} className="font-medium text-primary underline">
          {m.code || "—"}
        </Link>
        {m.codeCgManquant ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Code CG manquant</span>
        ) : null}
      </span>
    ),
  },
  {
    cle: "type",
    entete: "Type",
    rendu: (m) => (
      <>
        {m.libelleType}
        {m.precision ? <span className="block text-xs text-neutral">{m.precision}</span> : null}
      </>
    ),
  },
  { cle: "libelle", entete: "Libellé", rendu: (m) => m.libelle },
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

export default async function PageModeles() {
  const utilisateur = await exigerUtilisateur();
  const [depot, publication, parametrage] = await Promise.all([
    niveauDuProfil(utilisateur.profil, "DEPOSER_MODELE"),
    niveauDuProfil(utilisateur.profil, "PUBLIER_MODELE"),
    niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"),
  ]);
  if (!peutLire(depot) && !peutLire(publication)) redirect("/acces-refuse");

  const [modeles, seuil, historique, produits] = await Promise.all([
    listerModeles(utilisateur),
    lireSeuilListe(),
    historiqueSeuilListe(utilisateur),
    peutAgir(depot) ? listerProduits(utilisateur) : Promise.resolve([]),
  ]);

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Modèles Word"
        sousTitre="Bibliothèque des modèles (CDC §6) : chaque dépôt est contrôlé, puis conservé comme une version qui n'est jamais écrasée. La Technique dépose et soumet ; un autre profil (Direction Générale) publie."
      />
      <p>
        <LienBouton href="/modeles/aide">Aide à la rédaction des modèles : syntaxe, filtres et dictionnaire des champs</LienBouton>
      </p>

      <Tableau colonnes={COLONNES} lignes={modeles} cleLigne={(m) => String(m.id)} messageVide="Aucun modèle." legende="Modèles Word" />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {peutAgir(depot) ? (
          <Carte titre="Créer un modèle">
            <FormulaireAction action={creerUnModele} libelleBouton="Créer, puis déposer le fichier">
              <div className="mb-4">
                <ListeDeroulante
                  label="Type"
                  name="type"
                  required
                  defaultValue=""
                  invite="Choisir…"
                  options={TYPES_MODELE.map((t) => ({ valeur: t, libelle: REGLES[t].libelle }))}
                />
              </div>
              <Champ nom="code" libelle="Code (ex. CP_RELAXSANTE)" autoComplete="off" />
              <Champ nom="libelle" libelle="Libellé (pour les CG : celui cité dans les CP, ex. SECUR DOMMAGE)" autoComplete="off" />
              <div className="mb-4">
                <ListeDeroulante
                  label="Produit (obligatoire pour des CP ou une cotation ; aucun pour des CG ou CS)"
                  name="produitCode"
                  defaultValue=""
                  options={[{ valeur: "", libelle: "Commun à tous les produits" }, ...produits.map((p) => ({ valeur: p.code, libelle: `${p.code} — ${p.libelle}` }))]}
                />
              </div>
              <fieldset className="mb-4 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-medium text-foreground">Selon le type</legend>
                <div className="mb-4">
                  <ListeDeroulante
                    label="Annexe : liste reprise en entier"
                    name="listeAnnexe"
                    defaultValue=""
                    options={[{ valeur: "", libelle: "—" }, ...LISTES_ANNEXE.map((l) => ({ valeur: l, libelle: l }))]}
                  />
                </div>
                <Champ nom="niveauRelance" libelle="Relance : niveau (1, 2, 3…)" requis={false} autoComplete="off" />
                <Champ nom="blocNom" libelle={'Sous-modèle : nom du bloc, tel qu\'écrit dans bloc("garanties", …)'} requis={false} autoComplete="off" />
                <Champ nom="blocCle" libelle="Sous-modèle : clé (ex. code de formule : SOLO, 80…)" requis={false} autoComplete="off" />
              </fieldset>
            </FormulaireAction>
          </Carte>
        ) : null}

        <Carte
          titre="Listes longues (CDC §6.5)"
          description={
            <>
              Au-delà de <strong>{seuil}</strong> lignes, une liste (assurés, bénéficiaires, formules, échéances) est remplacée dans le corps du document par
              « Voir annexe – … » et rendue en entier par le modèle d'annexe, à la fin du PDF.
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
            <FormulaireAction action={enregistrerLeSeuil} libelleBouton="Enregistrer le seuil">
              <Champ nom="seuil" libelle="Nouveau seuil (nombre de lignes)" autoComplete="off" />
              <ChampDate nom="dateEffet" libelle="À partir du (JJ/MM/AAAA, jamais dans le passé)" valeur={aujourdhui()} min={aujourdhui()} />
            </FormulaireAction>
          ) : null}
        </Carte>
      </div>
    </main>
  );
}
