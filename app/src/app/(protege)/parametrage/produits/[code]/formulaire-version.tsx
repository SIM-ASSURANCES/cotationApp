import { Champ, ChampDate, ChampMontant, FormulaireAction } from "@/composants/FormulaireAction";
import { LignesFormules } from "@/composants/LignesFormules";
import { SectionSelonMode } from "@/composants/SectionSelonMode";
import type { ActionFormulaire } from "@/composants/types";
import { Carte, Champ as ChampSimple, ListeDeroulante, ZoneTexte } from "@/composants/ui";
import { NIVEAUX_ARRONDI } from "@/domaine/calcul/calcul";
import { PRECISIONS, SENS_ARRONDI } from "@/domaine/calcul/montant";
import { MODES_TARIFICATION, type ModeTarification } from "@/domaine/calcul/parametrage";
import type { VersionProduit } from "@/serveur/parametrage";

import { LIBELLE_MODE, LIBELLE_NIVEAU, LIBELLE_SENS, net } from "./libelles-produit";

/** Intertitre d'un bloc à l'intérieur d'une carte de formulaire. */
const SOUS_TITRE = "mb-1 text-base font-bold text-foreground";
const CASE = "size-4 accent-primary";

function formaterGarantieSaisie(g: NonNullable<VersionProduit["garanties"]>[number]): string {
  if (g.accessoires != null) return `${g.libelle} ; ${g.branche ?? ""} ; ${g.montantGaranti != null ? net(g.montantGaranti) : ""} ; ${net(g.accessoires)}`;
  if (g.montantGaranti != null) return `${g.libelle} ; ${g.branche ?? ""} ; ${net(g.montantGaranti)}`;
  return g.branche ? `${g.libelle} ; ${g.branche}` : g.libelle;
}

/** Section d'un mode : affichée seule quand le mode est figé (D66), sinon pilotée par la liste déroulante du premier formulaire. */
function SectionMode({ mode, modeFige, modeInitial, children }: { mode: ModeTarification; modeFige: ModeTarification | null; modeInitial: ModeTarification; children: React.ReactNode }) {
  if (modeFige) return modeFige === mode ? <>{children}</> : null;
  return (
    <SectionSelonMode mode={mode} modeInitial={modeInitial}>
      {children}
    </SectionSelonMode>
  );
}

/**
 * « Ajouter une version » d'un produit (D63, D66). Le mode de tarification est FIGÉ PAR PRODUIT : il ne se choisit qu'à la première version
 * (`base` absent) ; ensuite il s'affiche en lecture seule (le champ caché le renvoie, le service refuse tout autre mode), et seules les sections de
 * ce mode sont rendues : formules pour « Par formule », garanties pour « Par garanties », renvoi vers le barème pour « Au barème ». Les paramètres
 * communs (date, arrondi, prorata ou durée imposée, fractionnement, validité, références) restent pour tous les modes.
 */
export function FormulaireNouvelleVersion({ codeProduit, base, action, baremePublie }: { codeProduit: string; base: VersionProduit | null; action: ActionFormulaire; baremePublie: boolean }) {
  const modeFige: ModeTarification | null = base?.modeTarification ?? null;
  const modeInitial: ModeTarification = modeFige ?? "FORMULE";
  const peutEtreBareme = modeFige === null || modeFige === "BAREME";

  return (
    <Carte
      titre="Ajouter une version"
      description={
        <>
          Une version en vigueur ne se modifie jamais : on en ajoute une avec sa date d&apos;effet
          {base ? ", pré-remplie avec la dernière version" : ""}. Les primes unitaires se saisissent avec leurs décimales.
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {modeFige === null
          ? "Le mode de tarification se choisit ici, à la première version du produit, puis il ne change plus : pour tarifer autrement, on crée un nouveau produit. Un produit tarifé par garanties (SECURHOME, SECURHOME +, RELAXACCIDENTS) a son mode « Par garanties » dès sa première version ; un produit tarifé au barème (SECURPRO) est créé « Au barème »."
          : "Le mode de tarification est figé par produit : toute nouvelle version prend celui de la précédente. Pour tarifer autrement, créez un nouveau produit."}
      </p>
      <FormulaireAction action={action} libelleBouton="Enregistrer la version">
        <input type="hidden" name="codeProduit" value={codeProduit} />
        <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
          {modeFige ? (
            <div className="mb-4 sm:col-span-2" data-mode-fige={modeFige}>
              <p className="mb-1 text-sm font-medium text-foreground">Mode de tarification</p>
              <p className="text-sm text-foreground">{LIBELLE_MODE[modeFige]}</p>
              <p className="text-sm text-muted-foreground">Lecture seule : le mode est figé pour ce produit.</p>
              <input type="hidden" name="modeTarification" value={modeFige} />
            </div>
          ) : (
            <div className="mb-4 sm:col-span-2">
              <ListeDeroulante label="Mode de tarification (définitif pour ce produit)" name="modeTarification" defaultValue={modeInitial} options={MODES_TARIFICATION.map((m) => ({ valeur: m, libelle: LIBELLE_MODE[m] }))} />
            </div>
          )}
          {peutEtreBareme ? (
            <SectionMode mode="BAREME" modeFige={modeFige} modeInitial={modeInitial}>
              <div className="mb-4">
                <ListeDeroulante
                  label="Entrée en vigueur de la version au barème"
                  name="effet"
                  defaultValue="PUBLICATION"
                  aide="« Dès la publication » : la version précédente continue de servir jusqu'à la publication du barème de cette version, qui la fait entrer en vigueur le jour même. Sinon, saisissez une date future ci-contre."
                  options={[
                    { valeur: "PUBLICATION", libelle: "Dès la publication du barème" },
                    { valeur: "DATE", libelle: "À la date future saisie" },
                  ]}
                />
              </div>
            </SectionMode>
          ) : null}
          <ChampDate
            nom="dateEffet"
            libelle="Date d'effet (JJ/MM/AAAA)"
            requis={modeFige !== null && modeFige !== "BAREME"}
            aide={peutEtreBareme ? "Version au barème : à remplir seulement pour une entrée en vigueur à une date future." : undefined}
          />
          <ChampMontant nom="primeMinimale" libelle="Prime minimale (facultative)" requis={false} valeur={base?.prorata.primeMinimale ? net(base.prorata.primeMinimale) : ""} />
          <div className="mb-4">
            <ListeDeroulante
              label="Précision d'arrondi (F)"
              aide="Les montants sont arrondis à ce multiple de francs : 1 = au franc, 10 = à la dizaine, 100 = à la centaine, 1 000 = au millier."
              name="precision"
              defaultValue={String(base?.arrondi.precision ?? 1)}
              options={PRECISIONS.map((p) => ({ valeur: String(p), libelle: String(p) }))}
            />
          </div>
          <div className="mb-4">
            <ListeDeroulante label="Sens d'arrondi" name="sens" defaultValue={base?.arrondi.sens ?? "PROCHE"} options={SENS_ARRONDI.map((s) => ({ valeur: s, libelle: LIBELLE_SENS[s] }))} />
          </div>
          <div className="mb-4">
            <ListeDeroulante label="Niveau d'arrondi" name="niveau" defaultValue={base?.arrondi.niveau ?? "LIGNE"} options={NIVEAUX_ARRONDI.map((n) => ({ valeur: n, libelle: LIBELLE_NIVEAU[n] }))} />
          </div>
          <label className="mb-4 flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
            <input type="checkbox" name="prorataActif" defaultChecked={base?.prorata.actif ?? true} className={CASE} /> Prorata temporis actif (jours inclus / 365)
          </label>
          <label className="mb-4 flex min-h-10 items-center gap-2 text-sm font-medium lg:min-h-0">
            <input type="checkbox" name="dureeImposeeUnAn" defaultChecked={base?.dureeImposeeUnAn ?? false} className={CASE} /> Durée du contrat imposée : 1 an, sans prorata (échéance = effet + 1 an − 1 jour)
          </label>
          <Champ nom="tranchesMax" libelle="Nombre maximal de tranches (1 à 12)" valeur={String(base?.fractionnement.tranchesMax ?? 1)} autoComplete="off" />
          <Champ nom="repartition" libelle="Répartition en % (ex. 40 ; 30 ; 30), vide = tranches égales" requis={false} valeur={base?.fractionnement.repartitionPourcent?.join(" ; ") ?? ""} autoComplete="off" />
          <Champ nom="decalages" libelle="Décalages en mois (ex. 0 ; 3 ; 6), vide = réguliers" requis={false} valeur={base?.fractionnement.decalagesMois?.join(" ; ") ?? ""} autoComplete="off" />
          <ChampMontant nom="frais" libelle="Frais de fractionnement (ajoutés aux accessoires)" valeur={base ? net(base.fractionnement.frais) : "0"} />
          <Champ nom="validiteMois" libelle="Validité d'une cotation (mois, à partir de la date d'établissement)" valeur={String(base?.cotation.validiteMois ?? 3)} autoComplete="off" />
          <Champ nom="formulesMax" libelle="Formules comparées au plus" valeur={String(base?.cotation.formulesMax ?? 3)} autoComplete="off" aide="Nombre maximal de formules que l'on peut comparer dans une même cotation." />
        </div>

        {peutEtreBareme ? (
          <SectionMode mode="BAREME" modeFige={modeFige} modeInitial={modeInitial}>
            <h3 className={SOUS_TITRE}>Barème de la version</h3>
            <p className="mb-2 text-sm text-muted-foreground">
              {baremePublie
                ? "Cette version reprend à l'identique le barème publié du produit, rejoue ses jeux d'essai avec les paramètres ci-dessus et, si tous sont verts, se publie aussitôt (motif obligatoire) : elle s'applique dès la publication, ou à la date future saisie. Un essai en écart annule tout : aucune version n'est créée."
                : "Le produit n'a pas encore de barème publié : la version est créée « en préparation ». Créez ou importez son barème sur sa fiche (historique ci-dessous), puis publiez-le : la version entre alors en vigueur. D'ici là, aucun calcul ne la retient."}
            </p>
            {baremePublie ? (
              <div className="mb-4 max-w-4xl">
                <ChampSimple label="Motif de la publication (obligatoire)" name="motifPublication" autoComplete="off" />
              </div>
            ) : null}
          </SectionMode>
        ) : null}

        {modeFige === null || modeFige === "GARANTIES" ? (
          <SectionMode mode="GARANTIES" modeFige={modeFige} modeInitial={modeInitial}>
            <h3 className={SOUS_TITRE}>Garanties du produit</h3>
            <p className="mb-2 text-sm text-muted-foreground">
              Une garantie par ligne : « Libellé ; CATÉGORIE_TAXE ; MONTANT_GARANTI ; ACCESSOIRES » (catégorie de taxe proposée, montant garanti par défaut en FCFA ≥ 0 facultatif,
              accessoires par défaut en FCFA ≥ 0 facultatifs). Elles pré-remplissent la composition de la prime. Aucune formule n&apos;est nécessaire dans ce mode : la prime est composée par la
              Technique, garantie par garantie, sur chaque cotation.
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
          </SectionMode>
        ) : null}

        <h3 className={SOUS_TITRE}>Références contractuelles (CDC §7)</h3>
        <p className="mb-2 text-sm text-muted-foreground">
          Les conditions générales ne se saisissent plus ici : le produit reçoit celles de sa branche principale, avec le visa de leur
          version publiée (écran « Conditions générales »). Seules les conventions spéciales (codes de la bibliothèque « Modèles Word »)
          restent propres au produit ; à l&apos;émission, le visa cité doit être celui des CS jointes, sinon l&apos;émission est refusée.
        </p>
        <div className="mb-4 grid max-w-4xl gap-x-6 sm:grid-cols-2">
          <Champ nom="csModeleCode" libelle="Code du modèle de CS (facultatif)" requis={false} valeur={base?.references?.csModeleCode ?? ""} autoComplete="off" />
          <Champ nom="csVisa" libelle="Visa des CS" requis={false} valeur={base?.references?.csVisa ?? ""} autoComplete="off" />
        </div>

        {modeFige === null || modeFige === "FORMULE" ? (
          <SectionMode mode="FORMULE" modeFige={modeFige} modeInitial={modeInitial}>
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
          </SectionMode>
        ) : null}
      </FormulaireAction>
    </Carte>
  );
}
