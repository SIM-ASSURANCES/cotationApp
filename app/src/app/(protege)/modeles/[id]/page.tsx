import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { REGLES } from "@/domaine/documents/modeles";
import { lireModele } from "@/serveur/modeles";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { deposerUneVersion, publierUneVersion, renvoyerUneVersion, soumettreUneVersion } from "../actions";

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
    <main>
      <p className="mb-2 text-sm">
        <Link href="/modeles" className="text-sim-bleu underline">
          ← Modèles Word
        </Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">
        {m.code} <span className="text-base font-normal text-zinc-700">— {m.libelle}</span>
      </h1>
      <p className="mb-6 text-sm text-zinc-700">
        {m.libelleType}
        {m.precision ? ` : ${m.precision}` : ""} · {m.produitCode ? `produit ${m.produitCode}` : "commun à tous les produits"} ·{" "}
        {m.enVigueur ? `version en vigueur : v${m.enVigueur.numero}` : "aucune version en vigueur"}
        {regle.fixe ? " · document fixe : converti une seule fois en PDF, à la publication" : ""}
      </p>

      <h2 className="mb-2 text-lg font-semibold">Versions</h2>
      {m.versions.length === 0 ? <p className="mb-6 text-sm text-zinc-600">Aucune version déposée.</p> : null}
      <div className="mb-8 space-y-4">
        {m.versions.map((v) => (
          <article key={v.id} className="rounded border border-bordure p-4">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h3 className="text-base font-semibold">Version {v.numero}</h3>
              <span className="rounded bg-surface px-2 py-0.5 text-sm font-semibold">{v.libelleStatut}</span>
              <span className="text-sm text-zinc-700">date d'effet {v.dateEffet}</span>
            </div>
            <dl className="mb-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline font-medium">Commentaire : </dt><dd className="inline">{v.commentaire}</dd></div>
              <div><dt className="inline font-medium">Fichier : </dt><dd className="inline">{v.nomFichier} ({taille(v.taille)})</dd></div>
              <div><dt className="inline font-medium">Déposé : </dt><dd className="inline">{formatMoment(v.deposeLe)} par {v.auteur}</dd></div>
              <div><dt className="inline font-medium">Publié : </dt><dd className="inline">{v.publieLe ? `${formatMoment(v.publieLe)} par ${v.valideur}` : "—"}</dd></div>
              {v.visa ? <div><dt className="inline font-medium">Visa : </dt><dd className="inline">{v.visa}{v.dateDocument ? ` du ${v.dateDocument}` : ""}</dd></div> : null}
              <div className="sm:col-span-2"><dt className="inline font-medium">Empreinte SHA-256 : </dt><dd className="inline break-all font-mono text-xs">{v.empreinte}</dd></div>
            </dl>
            {v.motifRenvoi ? <p className="mb-2 text-sm text-red-700"><strong>Renvoyé en brouillon :</strong> {v.motifRenvoi}</p> : null}
            {v.avertissements.length > 0 ? (
              <ul className="mb-3 list-disc pl-5 text-sm text-amber-800">
                {v.avertissements.map((a, i) => (
                  <li key={i}>{a.message}{a.emplacement ? ` — ${a.emplacement}` : ""}</li>
                ))}
              </ul>
            ) : null}
            {v.champsUtilises.length > 0 ? (
              <details className="mb-3 text-sm">
                <summary className="cursor-pointer text-sim-bleu">Champs utilisés ({v.champsUtilises.length})</summary>
                <p className="mt-1 font-mono text-xs">{v.champsUtilises.join(", ")}</p>
              </details>
            ) : null}

            <div className="flex flex-wrap items-end gap-4">
              <a href={`/api/modeles/versions/${v.id}/fichier`} className="rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">
                Télécharger le .docx
              </a>
              {v.aUnPdf ? (
                <a href={`/api/modeles/versions/${v.id}/pdf`} className="rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">
                  PDF publié
                </a>
              ) : null}
              <form action={`/api/modeles/versions/${v.id}/apercu`} method="get" target="_blank" className="flex items-end gap-2">
                {regle.fixe ? null : (
                  <label className="text-sm">
                    Assurés fictifs
                    <input name="assures" type="number" min={0} max={200} defaultValue={2} className="ml-2 w-20 rounded border border-bordure px-2 py-1" />
                  </label>
                )}
                <button type="submit" className="rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">
                  Aperçu PDF (données fictives)
                </button>
              </form>
              {v.peutSoumettre ? (
                <FormulaireAction action={soumettreUneVersion} libelleBouton="Soumettre pour publication" discret>
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="modeleId" value={m.id} />
                </FormulaireAction>
              ) : null}
            </div>

            {v.peutPublier ? (
              <div className="mt-4 grid gap-4 rounded bg-surface p-3 sm:grid-cols-2">
                <FormulaireAction action={publierUneVersion} libelleBouton="Publier">
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="modeleId" value={m.id} />
                  <Champ nom="dateEffet" libelle="Date d'effet (AAAA-MM-JJ, aujourd'hui ou plus tard)" valeur={v.dateEffet >= jour ? v.dateEffet : jour} autoComplete="off" />
                </FormulaireAction>
                <FormulaireAction action={renvoyerUneVersion} libelleBouton="Renvoyer en brouillon" discret>
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="modeleId" value={m.id} />
                  <Champ nom="motif" libelle="Motif du renvoi" autoComplete="off" />
                </FormulaireAction>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {m.droits.deposer ? (
        <section className="max-w-2xl rounded border border-bordure bg-surface p-5">
          <h2 className="mb-1 text-lg font-semibold">Déposer une nouvelle version</h2>
          <p className="mb-4 text-sm text-zinc-700">
            Le fichier est contrôlé avant d'être enregistré (balises du dictionnaire, blocs bien fermés, champs Word, balises coupées…).
            En cas de refus, rien n'est enregistré : chaque problème est indiqué avec son emplacement dans le Word.
          </p>
          <FormulaireAction action={deposerUneVersion} libelleBouton="Contrôler et déposer">
            <input type="hidden" name="modeleId" value={m.id} />
            <label className="mb-4 block text-sm font-medium">
              Fichier Word (.docx, 15 Mo au plus)
              <input name="fichier" type="file" required accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="mt-1 block w-full text-base" />
            </label>
            <Champ nom="commentaire" libelle="Commentaire de modification" autoComplete="off" />
            <Champ nom="dateEffet" libelle="Date d'effet proposée (AAAA-MM-JJ ; fixée à la publication)" valeur={jour} autoComplete="off" />
            {regle.fixe ? (
              <>
                <Champ nom="visa" libelle="Visa (ex. MFB/DGTCP/DA/N° 01498)" autoComplete="off" />
                <Champ nom="dateDocument" libelle={m.type === "CG" ? "Date des conditions générales (AAAA-MM-JJ)" : "Date du document (facultative)"} requis={m.type === "CG"} autoComplete="off" />
              </>
            ) : null}
          </FormulaireAction>
        </section>
      ) : null}
    </main>
  );
}
