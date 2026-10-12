import { redirect } from "next/navigation";

import { Bouton, Carte, Champ, EnTetePage, ListeDeroulante, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { DOCUMENTS, TYPES_DOCUMENT } from "@/domaine/documents/emission";
import { rechercherDocuments, type DocumentLu } from "@/serveur/documents";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const taille = (octets: number) => (octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(octets / 1024)} Ko`);

/**
 * Le libellé public d'un document est variable (« Annulée – avoir AV-… ») : la pastille prend son ton dans la table unique des
 * statuts par la clé « Annulée » ou « Expirée » selon le code, et affiche le libellé complet.
 */
const cleDeStatut = (statut: DocumentLu["statut"]): string => (statut.code === "ANNULE" ? "Annulée" : statut.code === "EXPIRE" ? "Expirée" : statut.libelle);

const COLONNES: ColonneTableau<DocumentLu>[] = [
  {
    cle: "zip",
    entete: "ZIP",
    // La case reste une vraie case native ; l'étiquette l'entoure pour offrir une cible tactile de 40 px sous lg.
    rendu: (d) => (
      <label className="grid size-10 place-items-center lg:size-auto">
        <input type="checkbox" name="id" value={d.id} className="size-4 accent-primary" aria-label={`Ajouter ${d.numero} v${d.version} au ZIP`} />
      </label>
    ),
  },
  { cle: "document", entete: "Document", rendu: (d) => <>{d.libelleType} <span className="font-medium">{d.numero}</span></> },
  { cle: "version", entete: "Version", rendu: (d) => `v${d.version}${d.filigrane ? ` (${d.filigrane})` : ""}` },
  { cle: "client", entete: "Client", rendu: (d) => d.souscripteur },
  { cle: "police", entete: "Police", rendu: (d) => d.policeNumero ?? "—" },
  { cle: "emis", entete: "Émis", rendu: (d) => `${d.dateEmission} par ${d.emisPar}` },
  { cle: "statut", entete: "Statut", rendu: (d) => <PastilleStatut libelle={cleDeStatut(d.statut)}>{d.statut.libelle}</PastilleStatut> },
  { cle: "fichier", entete: "Fichier", rendu: (d) => <><a href={`/api/documents/${d.id}`} className="text-primary underline">PDF</a> ({taille(d.taille)})</> },
];

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
    <main className="space-y-6">
      <EnTetePage
        titre="Documents émis"
        sousTitre="Chaque document émis est conservé tel quel sur le stockage persistant, jamais écrasé : une réédition est une nouvelle version. Son empreinte est vérifiée à chaque téléchargement."
      />
      <Carte>
        <form method="get" className="grid max-w-5xl gap-x-4 gap-y-3 sm:grid-cols-3">
          <Champ label="N° de police" name="police" defaultValue={filtres.policeNumero} />
          <Champ label="N° du document" name="numero" defaultValue={filtres.numero} />
          <Champ label="Client (nom ou raison sociale)" name="client" defaultValue={filtres.client} />
          <ListeDeroulante
            label="Type"
            name="type"
            defaultValue={filtres.type}
            options={[{ valeur: "", libelle: "Tous" }, ...TYPES_DOCUMENT.map((t) => ({ valeur: t, libelle: DOCUMENTS[t].libelle }))]}
          />
          <Champ label="Émis du (AAAA-MM-JJ)" name="du" defaultValue={filtres.du} />
          <Champ label="au (AAAA-MM-JJ)" name="au" defaultValue={filtres.au} />
          <div className="sm:col-span-3">
            <Bouton type="submit">Rechercher</Bouton>
          </div>
        </form>
      </Carte>

      <form method="get" action="/api/documents/zip" className="space-y-3">
        <Tableau colonnes={COLONNES} lignes={documents} cleLigne={(d) => String(d.id)} messageVide="Aucun document." legende="Documents émis" />
        {documents.length > 0 ? (
          <Bouton type="submit" variante="secondaire">
            Télécharger la sélection (ZIP)
          </Bouton>
        ) : null}
      </form>
      {documents.length === 200 ? <p className="text-sm text-neutral">Les 200 plus récents : précisez la recherche.</p> : null}
    </main>
  );
}
