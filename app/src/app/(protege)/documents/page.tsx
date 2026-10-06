import { redirect } from "next/navigation";

import { DOCUMENTS, TYPES_DOCUMENT } from "@/domaine/documents/emission";
import { rechercherDocuments, type DocumentLu } from "@/serveur/documents";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const entree = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2";
const taille = (octets: number) => (octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(octets / 1024)} Ko`);

/** Documents émis (D11) : recherche, téléchargement individuel ou en ZIP. Droits selon le type (CDC §4). */
export default async function PageDocuments(props: PageProps<"/documents">) {
  const utilisateur = await exigerUtilisateur();
  const q = await props.searchParams;
  const lire = (nom: string) => (typeof q[nom] === "string" ? (q[nom] as string).trim() : "");
  const filtres = { policeNumero: lire("police"), numero: lire("numero"), client: lire("client"), type: lire("type"), du: lire("du"), au: lire("au") };
  let documents: DocumentLu[];
  try {
    documents = await rechercherDocuments(utilisateur, {
      ...filtres,
      du: /^\d{4}-\d{2}-\d{2}$/.test(filtres.du) ? filtres.du : undefined,
      au: /^\d{4}-\d{2}-\d{2}$/.test(filtres.au) ? filtres.au : undefined,
    });
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-sim-bleu">Documents émis</h1>
      <p className="mb-4 max-w-3xl text-sm text-zinc-700">
        Chaque document émis est conservé tel quel sur le stockage persistant, jamais écrasé : une réédition est une nouvelle version.
        Son empreinte est vérifiée à chaque téléchargement.
      </p>
      <form method="get" className="mb-6 grid max-w-5xl gap-x-4 gap-y-2 rounded border border-bordure bg-surface p-4 text-sm sm:grid-cols-3">
        <label>N° de police<input name="police" defaultValue={filtres.policeNumero} className={entree} /></label>
        <label>N° du document<input name="numero" defaultValue={filtres.numero} className={entree} /></label>
        <label>Client (nom ou raison sociale)<input name="client" defaultValue={filtres.client} className={entree} /></label>
        <label>
          Type
          <select name="type" defaultValue={filtres.type} className={entree}>
            <option value="">Tous</option>
            {TYPES_DOCUMENT.map((t) => (
              <option key={t} value={t}>{DOCUMENTS[t].libelle}</option>
            ))}
          </select>
        </label>
        <label>Émis du (AAAA-MM-JJ)<input name="du" defaultValue={filtres.du} className={entree} /></label>
        <label>au (AAAA-MM-JJ)<input name="au" defaultValue={filtres.au} className={entree} /></label>
        <div className="sm:col-span-3">
          <button type="submit" className="rounded bg-sim-bleu px-4 py-2 font-semibold text-white hover:bg-sim-marine">Rechercher</button>
        </div>
      </form>

      <form method="get" action="/api/documents/zip">
        <table className="mb-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-left text-white">
              <th className="p-2">ZIP</th>
              <th className="p-2">Document</th>
              <th className="p-2">Version</th>
              <th className="p-2">Client</th>
              <th className="p-2">Police</th>
              <th className="p-2">Émis</th>
              <th className="p-2">Statut</th>
              <th className="p-2">Fichier</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id} className="border-b border-bordure align-top">
                <td className="p-2"><input type="checkbox" name="id" value={d.id} aria-label={`Ajouter ${d.numero} v${d.version} au ZIP`} /></td>
                <td className="p-2">{d.libelleType} <span className="font-medium">{d.numero}</span></td>
                <td className="p-2">v{d.version}{d.filigrane ? ` (${d.filigrane})` : ""}</td>
                <td className="p-2">{d.souscripteur}</td>
                <td className="p-2">{d.policeNumero ?? "—"}</td>
                <td className="p-2">{d.dateEmission} par {d.emisPar}</td>
                <td className="p-2">{d.statut.libelle}</td>
                <td className="p-2">
                  <a href={`/api/documents/${d.id}`} className="text-sim-bleu underline">PDF</a> ({taille(d.taille)})
                </td>
              </tr>
            ))}
            {documents.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-center text-zinc-600">Aucun document.</td></tr>
            ) : null}
          </tbody>
        </table>
        {documents.length > 0 ? (
          <button type="submit" className="rounded border border-sim-bleu px-4 py-2 font-medium text-sim-bleu hover:bg-surface">Télécharger la sélection (ZIP)</button>
        ) : null}
      </form>
      {documents.length === 200 ? <p className="mt-2 text-sm text-zinc-600">Les 200 plus récents : précisez la recherche.</p> : null}
    </main>
  );
}
