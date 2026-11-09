import { notFound } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Carte, EnTetePage, EtatVide, LienBouton, ListeDeroulante, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { afficheTableauFormules, baseDeNouvelleVersion, estEffetALaPublication, versionsProvisoiresSansBareme } from "@/domaine/calcul/parametrage";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { etatDuBareme } from "@/serveur/bareme";
import { aujourdhui, listerBranchesPrincipales, listerVersions, type VersionProduit } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { ajouterUneVersion, renseignerBranchePrincipale } from "./actions";
import { FormulaireNouvelleVersion } from "./formulaire-version";
import { LIBELLE_MODE, LIBELLE_NIVEAU, LIBELLE_SENS, net } from "./libelles-produit";
import { PanneauBareme } from "./panneau-bareme";

type Formule = VersionProduit["formules"][number];

const COLONNES_FORMULES: ColonneTableau<Formule>[] = [
  { cle: "code", entete: "Formule", rendu: (f) => <span className="font-medium">{f.code}</span> },
  { cle: "libelle", entete: "Libellé", rendu: (f) => f.libelle },
  { cle: "prime", entete: "Prime unitaire", alignement: "droite", rendu: (f) => net(f.primeUnitaire) },
  { cle: "accessoires", entete: "Accessoires", rendu: (f) => `${f.accessoireMode} ${f.accessoireMode === "AUCUN" ? "" : net(f.accessoireValeur)}` },
  { cle: "ages", entete: "Âges", rendu: (f) => (f.ageMin == null && f.ageMax == null ? "–" : `${f.ageMin ?? 0} à ${f.ageMax ?? "…"} ans`) },
];

function formaterGarantieResume(g: NonNullable<VersionProduit["garanties"]>[number]): string {
  const details = [
    g.branche,
    g.montantGaranti != null ? `capital ${net(g.montantGaranti)} F` : null,
    g.accessoires != null ? `acc. ${net(g.accessoires)} F` : null,
  ].filter(Boolean);
  return details.length > 0 ? `${g.libelle} (${details.join(", ")})` : g.libelle;
}

function Resume({ v, codeProduit, peutEcrire, autreVersionAvecBareme }: { v: VersionProduit; codeProduit: string; peutEcrire: boolean; autreVersionAvecBareme?: { id: number; dateEffet: string; publie: boolean } }) {
  return (
    <Carte>
      <h3 className="mb-2 text-base font-bold text-foreground">
        {v.enPreparation
          ? estEffetALaPublication(v.dateEffet)
            ? "Version au barème en préparation : en vigueur dès la publication de son barème"
            : `Version au barème en préparation : prévue le ${formaterDate(v.dateEffet)}, en vigueur à la publication de son barème`
          : `Version en vigueur depuis le ${formaterDate(v.dateEffet)}`}
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Tarification : {LIBELLE_MODE[v.modeTarification] ?? v.modeTarification}
        {v.garanties && v.garanties.length > 0 ? ` — garanties : ${v.garanties.map(formaterGarantieResume).join(", ")}${v.garantiesSaisieLibre === false ? " ; saisie libre interdite" : ""}` : ""} ·{" "}
        Arrondi : {v.arrondi.precision} F, {LIBELLE_SENS[v.arrondi.sens].toLowerCase()}, {LIBELLE_NIVEAU[v.arrondi.niveau].toLowerCase()} · Prorata {v.prorata.actif ? "actif" : "inactif"}{v.dureeImposeeUnAn ? " · Durée imposée : 1 an" : ""}
        {v.prorata.primeMinimale ? `, prime minimale ${net(v.prorata.primeMinimale)}` : ""} · Fractionnement jusqu'à {v.fractionnement.tranchesMax} tranche(s)
        {net(v.fractionnement.frais) !== "0" ? `, frais ${net(v.fractionnement.frais)}` : ""} · Validité {v.cotation.validiteMois} mois
        {v.seuilValidationTtc ? ` · Double validation au-delà de ${net(v.seuilValidationTtc)} F TTC` : ""}
      </p>
      {/* Une version « Par garanties » (6.2b) ou au barème (B6b) n'a pas de formule : pas de tableau vide à lire. */}
      {afficheTableauFormules(v) ? (
        <Tableau colonnes={COLONNES_FORMULES} lignes={v.formules} cleLigne={(f) => f.code} messageVide="Aucune formule." legende={`Formules de la version du ${formaterDate(v.dateEffet)}`} />
      ) : null}
      {peutEcrire ? <PanneauBareme codeProduit={codeProduit} version={v} autreVersionAvecBareme={autreVersionAvecBareme} /> : null}
    </Carte>
  );
}

export default async function PageProduit(props: PageProps<"/parametrage/produits/[code]">) {
  const { code } = await props.params;
  const utilisateur = await exigerDroit("PARAMETRER_PRODUITS", peutLire);
  const [donnees, branchesPrincipales, niveau] = await Promise.all([
    listerVersions(utilisateur, code),
    listerBranchesPrincipales(utilisateur),
    niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"),
  ]);
  if (!donnees) {
    notFound();
  }
  const { produit, versions } = donnees;
  // D66 — d'où viennent le mode et les paramètres pré-remplis de « Ajouter une version » :
  //  - le MODE est celui de la version la plus RÉCENTE par date, y compris une version au barème en préparation (c'est la règle du service : `creerVersion`) ;
  //  - les PARAMÈTRES (arrondi, prorata, durée imposée, fractionnement, validité, références) sont ceux de la dernière version RETENUE, hors préparation :
  //    ce qui sert (ou servira) vraiment, pas un travail en cours. Sans version retenue (produit neuf au barème), ceux de la version en préparation.
  const { base, mode: modeDuProduit } = baseDeNouvelleVersion(versions);
  // H140 : version future créée pour recevoir un barème, sans barème publié.
  const futures = versions.filter((v) => v.modeTarification === "GARANTIES" && v.dateEffet > aujourdhui());
  const publiees = new Set((await Promise.all(futures.map(async (v) => ((await etatDuBareme(v.id)).publie ? v.id : null)))).filter((id): id is number => id !== null));
  const alertesBareme = versionsProvisoiresSansBareme(versions, publiees, aujourdhui());
  // Une version À VENIR qui a déjà un barème (brouillon ou publié) : la correction d'un publié s'y ouvre au lieu de créer une autre version (H157).
  const etats = new Map(await Promise.all(versions.map(async (v) => [v.id, await etatDuBareme(v.id)] as const)));
  const avenirAvecBareme = versions
    .filter((v) => v.dateEffet > aujourdhui() && (etats.get(v.id)?.brouillon || etats.get(v.id)?.publie))
    .map((v) => ({ id: v.id, dateEffet: v.dateEffet, publie: Boolean(etats.get(v.id)?.publie) }));
  // Le produit a un barème publié : « Ajouter une version » au barème le reprend et se publie aussitôt (motif demandé).
  const baremePublie = [...etats.values()].some((e) => e.publie);

  return (
    <main className="space-y-6">
      <EnTetePage
        filAriane={[{ libelle: "Produits", href: "/parametrage/produits" }, { libelle: produit.code }]}
        titre={`${produit.code} — ${produit.libelle}`}
        sousTitre={`Gamme ${produit.gamme} · Branche : ${produit.branchePrincipaleLibelle ? `${produit.branchePrincipaleLibelle} (${produit.branchePrincipale})` : "à renseigner"} · Catégorie de taxe : ${produit.branche}. Le calcul utilise la version en vigueur à la date du document.`}
        actions={
          <LienBouton href={`/parametrage/produits/${produit.code}/relances`} title="Délai J-x, niveaux de relance">
            Avis d&apos;échéance et relances de ce produit
          </LienBouton>
        }
      />

      {alertesBareme.length > 0 ? (
        <Bandeau ton="avertissement" role="alert" titre="Version sans barème publié">
          {alertesBareme.map((v) => (
            <p key={v.id}>
              La version du {formaterDate(v.dateEffet)} (dans {v.joursRestants} jour{v.joursRestants > 1 ? "s" : ""}) n&apos;a pas de barème publié : sans bascule avant cette date, elle s&apos;appliquera « Par garanties »
              (composition manuelle de la prime). Importez et publiez son barème, puis basculez-la, sur sa fiche ci-dessous.
            </p>
          ))}
        </Bandeau>
      ) : null}

      {!produit.branchePrincipale ? (
        <Bandeau ton="avertissement">
          Ce produit n&apos;a pas encore de branche principale renseignée (produit existant avant D37) : choisissez-la ci-dessous pour alimenter le classement et la balise <code>produit.branche_libelle</code>.
        </Bandeau>
      ) : null}

      {peutAgir(niveau) ? (
        <Carte titre="Branche principale du produit" className="max-w-md">
          <FormulaireAction action={renseignerBranchePrincipale} garderApresSucces libelleBouton="Enregistrer la branche">
            <input type="hidden" name="codeProduit" value={produit.code} />
            <div className="mb-4">
              <ListeDeroulante
                label="Branche (classement)"
                name="branchePrincipale"
                required
                defaultValue={produit.branchePrincipale ?? ""}
                invite="Choisir une branche"
                options={branchesPrincipales.map((b) => ({ valeur: b.code, libelle: `${b.libelle} (${b.code})` }))}
              />
            </div>
          </FormulaireAction>
        </Carte>
      ) : null}

      {peutAgir(niveau) ? (
        <FormulaireNouvelleVersion codeProduit={produit.code} base={base ?? null} mode={modeDuProduit} action={ajouterUneVersion} baremePublie={baremePublie} />
      ) : (
        <Bandeau ton="neutre">Consultation seule.</Bandeau>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Historique des versions</h2>
        {versions.length === 0 ? (
          <EtatVide message="Aucune version : ce produit ne peut pas encore être calculé." />
        ) : (
          versions.map((v) => <Resume key={v.id} v={v} codeProduit={produit.code} peutEcrire={peutAgir(niveau)} autreVersionAvecBareme={avenirAvecBareme.find((x) => x.id !== v.id)} />)
        )}
      </section>
    </main>
  );
}
