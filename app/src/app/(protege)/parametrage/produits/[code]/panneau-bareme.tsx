import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Champ as ChampFichier, LienBouton, ListeDeroulante } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { actionsDeBareme, estEffetALaPublication } from "@/domaine/calcul/parametrage";
import { etatDuBareme, type EtatBareme } from "@/serveur/bareme";
import { aujourdhui, type VersionProduit } from "@/serveur/parametrage";

import { basculerAuBareme, creerUnBaremeVide, creerUneVersionDepuisLeBareme, importerLeBareme, publierLeBareme, rejouerLesEssais } from "./actions";

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** « du 15/11/2026 » ou « dès la publication » (date provisoire d'une version au barème en préparation, D66). */
const quand = (date: string) => (estEffetALaPublication(date) ? "« dès la publication » (en préparation)" : `du ${formaterDate(date)}`);


/**
 * Barème d'une version (B9, D50) : télécharger le modèle, importer un classeur (→ brouillon), rejouer les essais, publier (motif),
 * exporter le barème publié, puis basculer la version au barème. B4 (D58) : créer un barème vide et le modifier à l'écran ; la correction d'un
 * barème publié passe par une NOUVELLE version (date saisie) qui en reçoit la copie en brouillon (H157). B5 (D59) : tables, sous-jacents, jeux d'essai, aperçu et publication se font aussi à l'écran ; le classeur reste une autre voie vers le même document.
 */
export async function PanneauBareme(props: { codeProduit: string; version: VersionProduit; autreVersionAvecBareme?: { id: number; dateEffet: string; publie: boolean } }) {
  return <PresentationPanneauBareme {...props} etat={await etatDuBareme(props.version.id)} />;
}

/** Le panneau lui-même : ne propose que ce que `actionsDeBareme` permet (rien du tout pour une version « Par formule » ou « Par garanties » sans barème). */
export function PresentationPanneauBareme({ codeProduit, version, etat, autreVersionAvecBareme }: { codeProduit: string; version: VersionProduit; etat: EtatBareme; autreVersionAvecBareme?: { id: number; dateEffet: string; publie: boolean } }) {
  const a = actionsDeBareme(version, etat, aujourdhui());
  if (!a.afficher) return null;
  const caches = (
    <>
      <input type="hidden" name="codeProduit" value={codeProduit} />
      <input type="hidden" name="versionId" value={version.id} />
    </>
  );
  const editeur = `/parametrage/produits/${codeProduit}/bareme/${version.id}`;
  const peutBasculer = a.basculer;

  return (
    <section id={`bareme-${version.id}`} className="mt-4 space-y-3 border-t border-border pt-4" aria-label={`Barème de la version ${quand(version.dateEffet)}`}>
      <h4 className="text-base font-bold text-foreground">Barème de cette version</h4>
      <p className="text-sm text-muted-foreground">
        {etat.publie
          ? `Barème publié le ${formaterDate(iso(etat.publie.publieLe))} par ${etat.publie.publiePar} (empreinte ${etat.publie.empreinte}). Motif : ${etat.publie.motif}. Il ne se modifie plus.`
          : etat.brouillon
            ? `Brouillon enregistré par ${etat.brouillon.creePar} (empreinte ${etat.brouillon.empreinte}). Il n'est pas encore publié.`
            : "Aucun barème pour cette version."}
      </p>
      {!etat.publie && version.modeTarification !== "BAREME" ? (
        <p className="text-sm text-muted-foreground">
          Version provisoire d&apos;avant D66 qui a déjà un barème : modifiez-le à l&apos;écran, rejouez les essais, publiez-le, puis basculez la version au barème. Un barème ne se crée plus sur une version qui n&apos;est pas au barème.
        </p>
      ) : null}
      {!etat.publie && version.enPreparation ? (
        <p className="text-sm text-muted-foreground">
          Version au barème en préparation : importez un classeur ou saisissez le barème à l&apos;écran, puis publiez-le. La publication fait entrer la version en vigueur
          ({estEffetALaPublication(version.dateEffet) ? "le jour même" : `le ${formaterDate(version.dateEffet)}`}) ; d&apos;ici là, la version précédente continue de servir.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {a.importer ? (
          <LienBouton href={`/api/bareme/${version.id}/modele`} title="Classeur Excel avec un exemple inventé (SECURPRO)">
            Télécharger le modèle
          </LienBouton>
        ) : null}
        {etat.brouillon || etat.publie ? (
          <LienBouton href={editeur} variante={etat.brouillon ? "principal" : "secondaire"}>
            {etat.brouillon ? "Modifier à l'écran" : "Consulter à l'écran"}
          </LienBouton>
        ) : null}
        {etat.publie ? (
          <LienBouton href={`/api/bareme/${version.id}/export`} title="Classeur du barème publié, empreinte écrite dans la feuille Lisez-moi">
            Exporter le barème publié
          </LienBouton>
        ) : null}
      </div>

      {a.creerVide ? (
        <FormulaireAction action={creerUnBaremeVide} libelleBouton="Créer un barème vide">
          {caches}
          <p className="mb-3 text-sm text-muted-foreground">Un brouillon neuf, sans classeur : vous le remplissez entièrement à l&apos;écran (champs, valeurs intermédiaires, garanties, tables, sous-jacents, jeux d&apos;essai), puis vous le publiez depuis l&apos;onglet Publier.</p>
        </FormulaireAction>
      ) : null}

      {a.nouvelleVersion ? (
        autreVersionAvecBareme ? (
          <Bandeau ton="avertissement" titre="Une version à venir a déjà un barème">
            La version {quand(autreVersionAvecBareme.dateEffet)} a déjà {autreVersionAvecBareme.publie ? "un barème publié" : "un brouillon de barème"} : ouvrez-la plutôt que d&apos;en créer une autre.{" "}
            <a className="font-medium underline" href={`#bareme-${autreVersionAvecBareme.id}`}>
              Aller à cette version
            </a>
          </Bandeau>
        ) : (
          <FormulaireAction action={creerUneVersionDepuisLeBareme} libelleBouton="Créer une nouvelle version à partir de ce barème">
            {caches}
            <p className="mb-3 text-sm text-muted-foreground">
              Un barème publié ne se modifie jamais. Pour le corriger, une nouvelle version du produit est créée au barème, « en préparation » (avec les paramètres de la dernière version) ; elle reçoit une copie de ce barème en brouillon, que vous modifiez à l&apos;écran puis publiez. Tant qu&apos;elle n&apos;est pas publiée, la version actuelle continue de servir. Le barème publié et les cotations qui le citent ne changent pas.
            </p>
            <div className="grid max-w-3xl gap-x-6 sm:grid-cols-2">
              <div className="mb-4">
                <ListeDeroulante
                  label="Entrée en vigueur de la nouvelle version"
                  name="effet"
                  defaultValue="PUBLICATION"
                  aide="« Dès la publication » : la version entre en vigueur le jour où vous publiez son barème. Sinon, saisissez une date future."
                  options={[
                    { valeur: "PUBLICATION", libelle: "Dès la publication du barème" },
                    { valeur: "DATE", libelle: "À la date future saisie" },
                  ]}
                />
              </div>
              <ChampDate nom="dateEffet" libelle="Date d'effet future (JJ/MM/AAAA)" requis={false} aide="À remplir seulement pour une entrée en vigueur à une date future." />
            </div>
          </FormulaireAction>
        )
      ) : null}

      {a.importer || a.rejouerEtPublier ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {a.importer ? (
          <FormulaireAction action={importerLeBareme} libelleBouton="Importer (→ brouillon)">
            {caches}
            <div className="mb-4">
              <ChampFichier
                label="Classeur Excel (.xlsx, 5 Mo au plus)"
                name="fichier"
                type="file"
                required
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium file:text-foreground"
              />
            </div>
          </FormulaireAction>
          ) : null}

          {a.rejouerEtPublier ? (
            <>
              <FormulaireAction action={rejouerLesEssais} libelleBouton="Rejouer les essais" discret>
                {caches}
                <p className="mb-3 text-sm text-muted-foreground">Calcule chaque jeu d&apos;essai du brouillon et liste les écarts, ligne à ligne.</p>
              </FormulaireAction>
              <FormulaireAction action={publierLeBareme} libelleBouton="Publier">
                {caches}
                <Champ nom="motif" libelle="Motif de la publication (obligatoire)" autoComplete="off" />
              </FormulaireAction>
            </>
          ) : null}
        </div>
      ) : null}

      {peutBasculer ? (
        <FormulaireAction action={basculerAuBareme} libelleBouton="Basculer la version au barème">
          {caches}
          <p className="mb-3 text-sm text-muted-foreground">Le mode de la version devient « Au barème ». Possible tant que la version n&apos;est pas en vigueur.</p>
        </FormulaireAction>
      ) : null}
      {etat.publie && version.modeTarification !== "BAREME" && !peutBasculer ? (
        <Bandeau ton="avertissement">Cette version est déjà en vigueur : son mode ne peut plus changer. Créez une version à une date postérieure.</Bandeau>
      ) : null}
    </section>
  );
}
