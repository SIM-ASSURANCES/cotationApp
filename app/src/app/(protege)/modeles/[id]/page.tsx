import { notFound, redirect } from "next/navigation";

import { Champ, ChampDate, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, Bouton, Carte, Champ as ChampSaisie, EnTetePage, EtatVide, ListeDefinitions, classesBouton } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { REGLES } from "@/domaine/documents/modeles";
import { lireModele } from "@/serveur/modeles";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { deposerUneVersion, publierUneVersion, renvoyerUneVersion, soumettreUneVersion } from "../actions";
import { PastilleVersion } from "../pastille-version";

const formatMoment = (d: Date | null) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(d) : "—");
const taille = (octets: number) => (octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(octets / 1024)} Ko`);

export default async function PageModele(props: PageProps<"/modeles/[id]">) {
  const { id } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let m;
  try {
    m = Number.isInteger(Number(id)) ? await lireModele(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!m) notFound();
  const regle = REGLES[m.type];
  const jour = aujourdhui();

  return (
    <main className="space-y-6">
      <EnTetePage
        filAriane={[{ libelle: "Modèles Word", href: "/modeles" }, { libelle: m.code || "Sans code" }]}
        titre={`${m.code || "—"} — ${m.libelle}`}
        sousTitre={`${m.libelleType}${m.precision ? ` : ${m.precision}` : ""} · ${m.produitCode ? `produit ${m.produitCode}` : "commun à tous les produits"} · ${
          m.enVigueur ? `version en vigueur : v${m.enVigueur.numero}` : "aucune version en vigueur"
        }${regle.fixe ? " · document fixe : converti une seule fois en PDF, à la publication" : ""}`}
      />
      {m.codeCgManquant ? (
        <Bandeau ton="avertissement">
          <strong>Code CG manquant :</strong> ce modèle de conditions générales a été déposé sans code.
        </Bandeau>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Versions</h2>
        {m.versions.length === 0 ? <EtatVide message="Aucune version déposée." compact /> : null}
        {m.versions.map((v) => (
          <Carte key={v.id} className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-semibold text-foreground">Version {v.numero}</h3>
              <PastilleVersion statut={v.statut} libelle={v.libelleStatut} />
              <span className="text-sm text-muted-foreground">date d'effet {formaterDate(v.dateEffet)}</span>
            </div>
            <ListeDefinitions
              elements={[
                { libelle: "Commentaire", valeur: v.commentaire },
                { libelle: "Fichier", valeur: `${v.nomFichier} (${taille(v.taille)})` },
                { libelle: "Déposé", valeur: `${formatMoment(v.deposeLe)} par ${v.auteur}` },
                { libelle: "Publié", valeur: v.publieLe ? `${formatMoment(v.publieLe)} par ${v.valideur}` : "—" },
                ...(v.visa ? [{ libelle: "Visa", valeur: `${v.visa}${v.dateDocument ? ` du ${formaterDate(v.dateDocument)}` : ""}` }] : []),
              ]}
            />
            <ListeDefinitions colonnes={1} elements={[{ libelle: "Empreinte SHA-256", valeur: <span className="break-all font-mono text-xs">{v.empreinte}</span> }]} />
            {v.motifRenvoi ? (
              <Bandeau ton="danger">
                <strong>Renvoyé en brouillon :</strong> {v.motifRenvoi}
              </Bandeau>
            ) : null}
            {v.avertissements.length > 0 ? (
              <Bandeau ton="avertissement">
                <ul className="list-disc pl-5">
                  {v.avertissements.map((a, i) => (
                    <li key={i}>
                      {a.message}
                      {a.emplacement ? ` — ${a.emplacement}` : ""}
                    </li>
                  ))}
                </ul>
              </Bandeau>
            ) : null}
            {v.champsUtilises.length > 0 ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-primary">Champs utilisés ({v.champsUtilises.length})</summary>
                <p className="mt-1 break-words font-mono text-xs text-foreground">{v.champsUtilises.join(", ")}</p>
              </details>
            ) : null}

            <div className="flex flex-wrap items-end gap-3">
              {/* Liens natifs <a> (pas next/link) : un téléchargement ne doit pas passer par la navigation du routeur. */}
              <a href={`/api/modeles/versions/${v.id}/fichier`} className={classesBouton("secondaire")}>
                Télécharger le .docx
              </a>
              {v.aUnPdf ? (
                <a href={`/api/modeles/versions/${v.id}/pdf`} className={classesBouton("secondaire")}>
                  PDF publié
                </a>
              ) : null}
              <form action={`/api/modeles/versions/${v.id}/apercu`} method="get" target="_blank" className="flex flex-wrap items-end gap-3">
                {regle.fixe ? null : (
                  <div className="w-36">
                    <ChampSaisie label="Assurés fictifs" name="assures" type="number" min={0} max={200} defaultValue={2} />
                  </div>
                )}
                <Bouton type="submit" variante="secondaire">
                  Aperçu PDF (données fictives)
                </Bouton>
              </form>
              {v.peutSoumettre ? (
                <FormulaireAction action={soumettreUneVersion} libelleBouton="Soumettre pour publication" discret>
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="modeleId" value={m.id} />
                </FormulaireAction>
              ) : null}
            </div>

            {v.peutPublier ? (
              <div className="grid gap-6 border-t border-border pt-4 sm:grid-cols-2">
                <FormulaireAction action={publierUneVersion} libelleBouton="Publier">
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="modeleId" value={m.id} />
                  <ChampDate nom="dateEffet" libelle="Date d'effet (JJ/MM/AAAA, aujourd'hui ou plus tard)" valeur={v.dateEffet >= jour ? v.dateEffet : jour} min={jour} />
                </FormulaireAction>
                <FormulaireAction action={renvoyerUneVersion} libelleBouton="Renvoyer en brouillon" discret>
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="modeleId" value={m.id} />
                  <Champ nom="motif" libelle="Motif du renvoi" autoComplete="off" />
                </FormulaireAction>
              </div>
            ) : null}
          </Carte>
        ))}
      </section>

      {m.droits.deposer ? (
        <Carte
          className="max-w-2xl"
          titre="Déposer une nouvelle version"
          description="Le fichier est contrôlé avant d'être enregistré (balises du dictionnaire, blocs bien fermés, champs Word, balises coupées…). En cas de refus, rien n'est enregistré : chaque problème est indiqué avec son emplacement dans le Word."
        >
          <FormulaireAction action={deposerUneVersion} libelleBouton="Contrôler et déposer">
            <input type="hidden" name="modeleId" value={m.id} />
            <div className="mb-4">
              <ChampSaisie
                label="Fichier Word (.docx, 15 Mo au plus)"
                name="fichier"
                type="file"
                required
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium file:text-foreground"
              />
            </div>
            <Champ nom="commentaire" libelle="Commentaire de modification" autoComplete="off" />
            <ChampDate nom="dateEffet" libelle="Date d'effet proposée (JJ/MM/AAAA ; fixée à la publication)" valeur={jour} />
            {regle.fixe ? (
              <>
                <Champ nom="visa" libelle="Visa (ex. MFB/DGTCP/DA/N° 01498)" autoComplete="off" />
                <ChampDate nom="dateDocument" libelle={m.type === "CG" ? "Date des conditions générales (JJ/MM/AAAA)" : "Date du document (facultative)"} requis={m.type === "CG"} />
              </>
            ) : null}
          </FormulaireAction>
        </Carte>
      ) : null}
    </main>
  );
}
