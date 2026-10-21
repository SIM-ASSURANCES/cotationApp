import { notFound } from "next/navigation";

import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { LignesFormules } from "@/composants/LignesFormules";
import { Bandeau, Carte, EnTetePage, EtatVide, LienBouton, ListeDeroulante, Tableau, ZoneTexte, type ColonneTableau } from "@/composants/ui";
import { NIVEAUX_ARRONDI } from "@/domaine/calcul/calcul";
import { formaterDate } from "@/domaine/calcul/dates";
import { PRECISIONS, SENS_ARRONDI, montant } from "@/domaine/calcul/montant";
import { MODES_TARIFICATION } from "@/domaine/calcul/parametrage";
import { peutAgir, peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listerBranchesPrincipales, listerVersions, type VersionProduit } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { ajouterUneVersion, renseignerBranchePrincipale } from "./actions";

const LIBELLE_SENS = { PROCHE: "Au plus proche", SUPERIEUR: "Au supérieur", INFERIEUR: "À l'inférieur" } as const;
const LIBELLE_NIVEAU = { LIGNE: "Chaque ligne", TOTAL: "Total seulement" } as const;
const LIBELLE_MODE = { FORMULE: "Par formule (calcul automatique)", GARANTIES: "Par garanties (prime composée par la Technique, calcul automatique refusé)" } as const;
/** Intertitre d'un bloc à l'intérieur d'une carte de formulaire. */
const SOUS_TITRE = "mb-1 text-base font-bold text-foreground";
const CASE = "size-4 accent-primary";

/** Décimal en texte sans zéros inutiles (« 3000.000000 » devient « 3000 »). */
const net = (texte: string) => montant(texte).toString();

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

function formaterGarantieSaisie(g: NonNullable<VersionProduit["garanties"]>[number]): string {
  if (g.accessoires != null) return `${g.libelle} ; ${g.branche ?? ""} ; ${g.montantGaranti != null ? net(g.montantGaranti) : ""} ; ${net(g.accessoires)}`;
  if (g.montantGaranti != null) return `${g.libelle} ; ${g.branche ?? ""} ; ${net(g.montantGaranti)}`;
  return g.branche ? `${g.libelle} ; ${g.branche}` : g.libelle;
}

function Resume({ v }: { v: VersionProduit }) {
  return (
    <Carte>
      <h3 className="mb-2 text-base font-bold text-foreground">Version en vigueur depuis le {formaterDate(v.dateEffet)}</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Tarification : {LIBELLE_MODE[v.modeTarification] ?? v.modeTarification}
        {v.garanties && v.garanties.length > 0 ? ` — garanties : ${v.garanties.map(formaterGarantieResume).join(", ")}${v.garantiesSaisieLibre === false ? " ; saisie libre interdite" : ""}` : ""} ·{" "}
        Arrondi : {v.arrondi.precision} F, {LIBELLE_SENS[v.arrondi.sens].toLowerCase()}, {LIBELLE_NIVEAU[v.arrondi.niveau].toLowerCase()} · Prorata {v.prorata.actif ? "actif" : "inactif"}
        {v.prorata.primeMinimale ? `, prime minimale ${net(v.prorata.primeMinimale)}` : ""} · Fractionnement jusqu'à {v.fractionnement.tranchesMax} tranche(s)
        {net(v.fractionnement.frais) !== "0" ? `, frais ${net(v.fractionnement.frais)}` : ""} · Validité {v.cotation.validiteMois} mois
        {v.seuilValidationTtc ? ` · Double validation au-delà de ${net(v.seuilValidationTtc)} F TTC` : ""}
      </p>
      {/* Une version « Par garanties » n'a pas de formule (6.2b) : pas de tableau vide à lire. */}
      {v.formules.length > 0 || v.modeTarification !== "GARANTIES" ? (
        <Tableau colonnes={COLONNES_FORMULES} lignes={v.formules} cleLigne={(f) => f.code} messageVide="Aucune formule." legende={`Formules de la version du ${formaterDate(v.dateEffet)}`} />
      ) : null}
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
  const base = versions[0]; // la plus récente : point de départ de la nouvelle version

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

      {!produit.branchePrincipale ? (
        <Bandeau ton="avertissement">
          Ce produit n&apos;a pas encore de branche principale renseignée (produit existant avant D37) : choisissez-la ci-dessous pour alimenter le classement et la balise <code>produit.branche_libelle</code>.
        </Bandeau>
      ) : null}

      {peutAgir(niveau) ? (
        <Carte titre="Branche principale du produit" className="max-w-md">
          <FormulaireAction action={renseignerBranchePrincipale} libelleBouton="Enregistrer la branche">
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
        <Carte
          titre="Ajouter une version"
          description={
            <>
              Une version en vigueur ne se modifie jamais : on en ajoute une avec sa date d'effet
              {base ? ", pré-remplie avec la dernière version" : ""}. Les primes unitaires se saisissent avec leurs décimales.
            </>
          }
        >
          <p className="mb-4 text-sm text-muted-foreground">
            Un produit tarifé par garanties (SECURPRO, SECURHOME, SECURHOME +, RELAXACCIDENTS) a son mode « Par garanties » dès sa première version : une
            version « Par formule » plus ancienne resterait en vigueur, et calculée, pour tout document daté avant la date d&apos;effet de la suivante.
            Une version « Par garanties » ne calcule rien : la prime est composée par la Technique, garantie par garantie, sur chaque cotation. Elle n&apos;a besoin d&apos;aucune
            formule (la liste des garanties ci-dessous est facultative) ; un assuré n&apos;y a pas de formule.
          </p>
          <FormulaireAction action={ajouterUneVersion} libelleBouton="Enregistrer la version">
            <input type="hidden" name="codeProduit" value={produit.code} />
            <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
              <ChampDate nom="dateEffet" libelle="Date d'effet (JJ/MM/AAAA)" />
              <div className="mb-4">
                <ListeDeroulante
                  label="Mode de tarification"
                  name="modeTarification"
                  defaultValue={base?.modeTarification ?? "FORMULE"}
                  options={MODES_TARIFICATION.map((m) => ({ valeur: m, libelle: LIBELLE_MODE[m] }))}
                />
              </div>
              <Champ nom="primeMinimale" libelle="Prime minimale (facultative)" requis={false} valeur={base?.prorata.primeMinimale ? net(base.prorata.primeMinimale) : ""} autoComplete="off" />
              <div className="mb-4">
                <ListeDeroulante
                  label="Précision d'arrondi (F)"
                  name="precision"
                  defaultValue={String(base?.arrondi.precision ?? 1)}
                  options={PRECISIONS.map((p) => ({ valeur: String(p), libelle: String(p) }))}
                />
              </div>
              <div className="mb-4">
                <ListeDeroulante
                  label="Sens d'arrondi"
                  name="sens"
                  defaultValue={base?.arrondi.sens ?? "PROCHE"}
                  options={SENS_ARRONDI.map((s) => ({ valeur: s, libelle: LIBELLE_SENS[s] }))}
                />
              </div>
              <div className="mb-4">
                <ListeDeroulante
                  label="Niveau d'arrondi"
                  name="niveau"
                  defaultValue={base?.arrondi.niveau ?? "LIGNE"}
                  options={NIVEAUX_ARRONDI.map((n) => ({ valeur: n, libelle: LIBELLE_NIVEAU[n] }))}
                />
              </div>
              <label className="mb-4 flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
                <input type="checkbox" name="prorataActif" defaultChecked={base?.prorata.actif ?? true} className={CASE} /> Prorata temporis actif (jours inclus / 365)
              </label>
              <Champ nom="tranchesMax" libelle="Nombre maximal de tranches (1 à 12)" valeur={String(base?.fractionnement.tranchesMax ?? 1)} autoComplete="off" />
              <Champ nom="repartition" libelle="Répartition en % (ex. 40 ; 30 ; 30), vide = tranches égales" requis={false} valeur={base?.fractionnement.repartitionPourcent?.join(" ; ") ?? ""} autoComplete="off" />
              <Champ nom="decalages" libelle="Décalages en mois (ex. 0 ; 3 ; 6), vide = réguliers" requis={false} valeur={base?.fractionnement.decalagesMois?.join(" ; ") ?? ""} autoComplete="off" />
              <Champ nom="frais" libelle="Frais de fractionnement (ajoutés aux accessoires)" valeur={base ? net(base.fractionnement.frais) : "0"} autoComplete="off" />
              <Champ nom="validiteMois" libelle="Validité d'une cotation (mois, à partir de la date d'établissement)" valeur={String(base?.cotation.validiteMois ?? 3)} autoComplete="off" />
              <Champ nom="formulesMax" libelle="Formules comparées au plus" valeur={String(base?.cotation.formulesMax ?? 3)} autoComplete="off" />
            </div>
            <h3 className={SOUS_TITRE}>Garanties du produit (mode « Par garanties » seulement)</h3>
            <p className="mb-2 text-sm text-muted-foreground">
              Une garantie par ligne : « Libellé ; CATÉGORIE_TAXE ; MONTANT_GARANTI ; ACCESSOIRES » (catégorie de taxe proposée, montant garanti par défaut en FCFA ≥ 0 facultatif,
              accessoires par défaut en FCFA ≥ 0 facultatifs). Elles pré-remplissent la composition de la prime. Aucune formule n&apos;est nécessaire dans ce mode.
            </p>
            <div className="mb-4 max-w-4xl">
              <input type="hidden" name="garantiesPresentes" value="1" />
              <div className="mb-2">
                <ZoneTexte
                  label="Garanties"
                  name="garanties"
                  rows={6}
                  defaultValue={(base?.garanties ?? []).map(formaterGarantieSaisie).join("\n")}
                  placeholder={"Incendie ; INCENDIE ; 50000000 ; 5000\nVol ; IARD ; 10000000 ; 2500"}
                />
              </div>
              <label className="flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
                <input type="checkbox" name="garantiesSaisieLibre" defaultChecked={base?.garantiesSaisieLibre ?? true} className={CASE} /> Saisie libre autorisée (décochée : seuls les libellés de la liste sont acceptés)
              </label>
            </div>
            <h3 className={SOUS_TITRE}>Références contractuelles (CDC §7)</h3>
            <p className="mb-2 text-sm text-muted-foreground">
              Modèles de conditions générales et spéciales joints au contrat (codes de la bibliothèque « Modèles Word ») et visas cités
              dans les CP. À l'émission, le visa doit être celui des CG jointes, sinon l'émission est refusée.
            </p>
            <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
              <Champ nom="cgModeleCode" libelle="Code du modèle de CG (facultatif)" requis={false} valeur={base?.references?.cgModeleCode ?? ""} autoComplete="off" />
              <Champ nom="cgVisa" libelle="Visa des CG cité dans les CP" requis={false} valeur={base?.references?.cgVisa ?? ""} autoComplete="off" />
              <Champ nom="csModeleCode" libelle="Code du modèle de CS (facultatif)" requis={false} valeur={base?.references?.csModeleCode ?? ""} autoComplete="off" />
              <Champ nom="csVisa" libelle="Visa des CS" requis={false} valeur={base?.references?.csVisa ?? ""} autoComplete="off" />
            </div>
            <h3 className="mb-2 text-base font-bold text-foreground">Formules</h3>
            <LignesFormules
              initiales={(base?.formules ?? []).map((f) => ({
                code: f.code,
                libelle: f.libelle,
                tauxCouverture: f.tauxCouverture ? net(f.tauxCouverture) : "",
                primeUnitaire: net(f.primeUnitaire),
                accessoireMode: f.accessoireMode,
                accessoireValeur: net(f.accessoireValeur),
                ageMin: f.ageMin == null ? "" : String(f.ageMin),
                ageMax: f.ageMax == null ? "" : String(f.ageMax),
              }))}
            />
          </FormulaireAction>
        </Carte>
      ) : (
        <Bandeau ton="neutre">Consultation seule.</Bandeau>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Historique des versions</h2>
        {versions.length === 0 ? (
          <EtatVide message="Aucune version : ce produit ne peut pas encore être calculé." />
        ) : (
          versions.map((v) => <Resume key={v.id} v={v} />)
        )}
      </section>
    </main>
  );
}
