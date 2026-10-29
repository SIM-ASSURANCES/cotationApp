import Link from "next/link";
import { redirect } from "next/navigation";

import { Bouton, Carte, Champ, ChampDate, EnTetePage, ListeDeroulante, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { cx } from "@/composants/ui/classes";
import { formaterDate, normaliserDateSaisie } from "@/domaine/calcul/dates";
import { DOCUMENTS, TYPES_DOCUMENT } from "@/domaine/documents/emission";
import { listerClientsAvecDocuments, rechercherDocuments, type ClientAvecDocuments, type DocumentLu } from "@/serveur/documents";
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
  { cle: "emis", entete: "Émis", rendu: (d) => `${formaterDate(d.dateEmission)} par ${d.emisPar}` },
  { cle: "statut", entete: "Statut", rendu: (d) => <PastilleStatut libelle={cleDeStatut(d.statut)}>{d.statut.libelle}</PastilleStatut> },
  { cle: "fichier", entete: "Fichier", rendu: (d) => <><a href={`/api/documents/${d.id}`} className="text-primary underline">PDF</a> ({taille(d.taille)})</> },
];

const COLONNES_CLIENTS: ColonneTableau<ClientAvecDocuments>[] = [
  {
    cle: "nom",
    entete: "Client",
    className: "font-semibold",
    rendu: (c) => (
      <Link href={`/clients/${c.id}`} className="text-primary hover:underline">
        {c.nom}
      </Link>
    ),
  },
  { cle: "type", entete: "Type", rendu: (c) => c.type },
  { cle: "telephone", entete: "Téléphone", rendu: (c) => c.telephone || "—" },
  { cle: "email", entete: "E-mail", rendu: (c) => c.email || "—" },
  {
    cle: "documents",
    entete: "Documents émis",
    rendu: (c) => (
      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
        {c.nombreDocuments} doc{c.nombreDocuments > 1 ? "s" : ""}
      </span>
    ),
  },
  {
    cle: "polices",
    entete: "Contrats",
    rendu: (c) => `${c.nombrePolices} contrat${c.nombrePolices > 1 ? "s" : ""}`,
  },
  {
    cle: "dernierDoc",
    entete: "Dernière émission",
    rendu: (c) => (c.dernierDocumentLe ? formaterDate(c.dernierDocumentLe.toISOString().slice(0, 10)) : "—"),
  },
  {
    cle: "action",
    entete: "Dossier",
    rendu: (c) => (
      <Link href={`/clients/${c.id}`} className="inline-flex items-center text-xs font-semibold text-primary hover:underline">
        Voir ses documents →
      </Link>
    ),
  },
];

/** Documents émis (D11) : recherche globale ou classement par client, téléchargement individuel ou en ZIP. */
export default async function PageDocuments(props: PageProps<"/documents">) {
  const utilisateur = await exigerUtilisateur();
  const q = await props.searchParams;
  const lire = (nom: string) => (typeof q[nom] === "string" ? (q[nom] as string).trim() : "");
  const vue = lire("vue");
  const rechercheClient = lire("q");

  const filtres = { policeNumero: lire("police"), numero: lire("numero"), client: lire("client"), type: lire("type"), du: normaliserDateSaisie(lire("du")), au: normaliserDateSaisie(lire("au")) };

  let documents: DocumentLu[] = [];
  let clientsAvecDocs: ClientAvecDocuments[] = [];

  try {
    if (vue === "clients") {
      clientsAvecDocs = await listerClientsAvecDocuments(utilisateur, rechercheClient);
    } else {
      documents = await rechercherDocuments(utilisateur, {
        ...filtres,
        du: /^\d{4}-\d{2}-\d{2}$/.test(filtres.du) ? filtres.du : undefined,
        au: /^\d{4}-\d{2}-\d{2}$/.test(filtres.au) ? filtres.au : undefined,
      });
    }
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

      {/* Onglets de navigation : Recherche globale vs Rangement par client */}
      <div className="flex border-b border-border text-sm font-medium">
        <Link
          href="/documents"
          className={cx(
            "px-4 py-2.5 border-b-2 transition-colors",
            vue !== "clients"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
          )}
        >
          Tous les documents (recherche globale)
        </Link>
        <Link
          href="/documents?vue=clients"
          className={cx(
            "px-4 py-2.5 border-b-2 transition-colors",
            vue === "clients"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
          )}
        >
          Rangement par client
        </Link>
      </div>

      {vue === "clients" ? (
        <div className="space-y-6">
          <Carte>
            <form method="get" className="flex flex-wrap items-end gap-3 max-w-xl">
              <input type="hidden" name="vue" value="clients" />
              <div className="flex-1 min-w-[16rem]">
                <Champ label="Rechercher un client (nom, raison sociale, téléphone)" name="q" defaultValue={rechercheClient} autoComplete="off" />
              </div>
              <Bouton type="submit">Rechercher</Bouton>
              {rechercheClient ? (
                <Link href="/documents?vue=clients" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground pb-2.5">
                  Réinitialiser
                </Link>
              ) : null}
            </form>
          </Carte>

          <Tableau
            colonnes={COLONNES_CLIENTS}
            lignes={clientsAvecDocs}
            cleLigne={(c) => String(c.id)}
            messageVide={rechercheClient ? "Aucun client ne correspond à cette recherche." : "Aucun client enregistré."}
            legende="Clients et leurs dossiers documentaires"
          />
        </div>
      ) : (
        <div className="space-y-6">
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
              <ChampDate label="Émis du (JJ/MM/AAAA)" name="du" defaultValue={filtres.du} />
              <ChampDate label="au (JJ/MM/AAAA)" name="au" defaultValue={filtres.au} />
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
        </div>
      )}
    </main>
  );
}
