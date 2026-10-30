import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Champ as ChampFichier, LienBouton } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { etatDuBareme } from "@/serveur/bareme";
import { aujourdhui, type VersionProduit } from "@/serveur/parametrage";

import { basculerAuBareme, creerUnBaremeVide, creerUneVersionDepuisLeBareme, importerLeBareme, publierLeBareme, rejouerLesEssais } from "./actions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Une version peut recevoir un barème tant qu'elle n'est pas en vigueur dans un autre mode, ou si elle est déjà au barème. */
export const versionAvecBareme = (v: Pick<VersionProduit, "dateEffet" | "modeTarification">) => v.modeTarification === "BAREME" || v.dateEffet > aujourdhui();

/**
 * Barème d'une version (B9, D50) : télécharger le modèle, importer un classeur (→ brouillon), rejouer les essais, publier (motif),
 * exporter le barème publié, puis basculer la version au barème. B4 (D58) : créer un barème vide et le modifier à l'écran ; la correction d'un
 * barème publié passe par une NOUVELLE version (date saisie) qui en reçoit la copie en brouillon (H157). Les tables, sous-jacents et jeux
 * d'essai s'éditeront avec B5.
 */
export async function PanneauBareme({ codeProduit, version, autreVersionAvecBareme }: { codeProduit: string; version: VersionProduit; autreVersionAvecBareme?: { id: number; dateEffet: string; publie: boolean } }) {
  const etat = await etatDuBareme(version.id);
  const caches = (
    <>
      <input type="hidden" name="codeProduit" value={codeProduit} />
      <input type="hidden" name="versionId" value={version.id} />
    </>
  );
  const editeur = `/parametrage/produits/${codeProduit}/bareme/${version.id}`;
  const peutBasculer = etat.publie !== null && version.modeTarification !== "BAREME" && version.dateEffet > aujourdhui();

  return (
    <section id={`bareme-${version.id}`} className="mt-4 space-y-3 border-t border-border pt-4" aria-label={`Barème de la version du ${formaterDate(version.dateEffet)}`}>
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
          Parcours : créer la version à une date future, importer le classeur, publier le barème, puis basculer la version au barème.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <LienBouton href={`/api/bareme/${version.id}/modele`} title="Classeur Excel avec un exemple inventé (SECURPRO)">
          Télécharger le modèle
        </LienBouton>
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

      {!etat.brouillon && !etat.publie ? (
        <FormulaireAction action={creerUnBaremeVide} libelleBouton="Créer un barème vide">
          {caches}
          <p className="mb-3 text-sm text-muted-foreground">Un brouillon neuf, sans classeur : vous le remplissez à l&apos;écran (champs, valeurs intermédiaires, garanties). Les tables, sous-jacents et jeux d&apos;essai viennent du classeur.</p>
        </FormulaireAction>
      ) : null}

      {etat.publie ? (
        autreVersionAvecBareme ? (
          <Bandeau ton="avertissement" titre="Une version à venir a déjà un barème">
            La version du {formaterDate(autreVersionAvecBareme.dateEffet)} a déjà {autreVersionAvecBareme.publie ? "un barème publié" : "un brouillon de barème"} : ouvrez-la plutôt que d&apos;en créer une autre.{" "}
            <a className="font-medium underline" href={`#bareme-${autreVersionAvecBareme.id}`}>
              Aller à cette version
            </a>
          </Bandeau>
        ) : (
          <FormulaireAction action={creerUneVersionDepuisLeBareme} libelleBouton="Créer une nouvelle version à partir de ce barème">
            {caches}
            <p className="mb-3 text-sm text-muted-foreground">
              Un barème publié ne se modifie jamais. Pour le corriger, une nouvelle version du produit est créée à la date d&apos;effet que vous saisissez (postérieure à aujourd&apos;hui, avec les paramètres de la dernière version) ; elle reçoit une copie de ce barème en brouillon, que vous modifiez à l&apos;écran. Le barème publié et les cotations qui le citent ne changent pas.
            </p>
            <div className="max-w-xs">
              <ChampDate nom="dateEffet" libelle="Date d'effet de la nouvelle version (JJ/MM/AAAA)" />
            </div>
          </FormulaireAction>
        )
      ) : null}

      {!etat.publie ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

          {etat.brouillon ? (
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
