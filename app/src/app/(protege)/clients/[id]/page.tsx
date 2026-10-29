import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Bouton, Carte, EnTetePage, PastilleStatut, Tableau, type ColonneTableau } from "@/composants/ui";
import { formaterDate } from "@/domaine/calcul/dates";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { obtenirClient } from "@/serveur/clients";
import { documentsDuClient, type DocumentLu } from "@/serveur/documents";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const taille = (octets: number) => (octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(octets / 1024)} Ko`);

const cleDeStatut = (statut: DocumentLu["statut"]): string =>
  statut.code === "ANNULE" ? "Annulée" : statut.code === "EXPIRE" ? "Expirée" : statut.libelle;

const COLONNES_DOCUMENTS: ColonneTableau<DocumentLu>[] = [
  {
    cle: "zip",
    entete: "ZIP",
    rendu: (d) => (
      <label className="grid size-10 place-items-center lg:size-auto">
        <input type="checkbox" name="id" value={d.id} className="size-4 accent-primary" aria-label={`Ajouter ${d.numero} v${d.version} au ZIP`} />
      </label>
    ),
  },
  {
    cle: "document",
    entete: "Document",
    rendu: (d) => (
      <>
        {d.libelleType} <span className="font-semibold text-foreground">{d.numero}</span>
      </>
    ),
  },
  {
    cle: "version",
    entete: "Version",
    rendu: (d) => `v${d.version}${d.filigrane ? ` (${d.filigrane})` : ""}`,
  },
  {
    cle: "police",
    entete: "Police rattachée",
    rendu: (d) => (d.policeNumero ? <span className="font-mono text-xs font-semibold">{d.policeNumero}</span> : "—"),
  },
  {
    cle: "dateEmission",
    entete: "Date d'émission",
    rendu: (d) => formaterDate(d.dateEmission),
  },
  {
    cle: "statut",
    entete: "Statut",
    rendu: (d) => <PastilleStatut libelle={cleDeStatut(d.statut)}>{d.statut.libelle}</PastilleStatut>,
  },
  {
    cle: "action",
    entete: "Téléchargement",
    rendu: (d) => (
      <a href={`/api/documents/${d.id}`} className="text-primary font-medium underline">
        PDF ({taille(d.taille)})
      </a>
    ),
  },
];

export default async function PageFicheClient(props: PageProps<"/clients/[id]">) {
  const utilisateur = await exigerUtilisateur();
  const { id } = await props.params;
  const clientId = Number(id);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    notFound();
  }

  let client;
  let documents: DocumentLu[];
  try {
    client = await obtenirClient(utilisateur, clientId);
    if (!client) {
      notFound();
    }
    documents = await documentsDuClient(utilisateur, clientId);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) {
      redirect("/acces-refuse");
    }
    throw erreur;
  }

  const s = client.souscripteur;
  const nomAffiche = s.type === "MORALE" ? s.raison_sociale || s.nom : `${s.nom} ${s.prenoms}`.trim();

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={nomAffiche}
        sousTitre={`Dossier client ${s.type === "MORALE" ? "personne morale" : "personne physique"} • Enregistré le ${formaterDate(client.creeLe.toISOString().slice(0, 10))}`}
        filAriane={[
          { libelle: "Cotations", href: "/cotations" },
          { libelle: "Clients", href: "/clients" },
          { libelle: nomAffiche },
        ]}
      />

      {/* 1. Informations générales du client */}
      <Carte titre="Coordonnées & Informations du client">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3 text-sm">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Type de souscripteur</p>
            <p className="font-semibold text-foreground">{s.type === "MORALE" ? "Personne morale" : "Personne physique"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Téléphone</p>
            <p className="font-medium text-foreground">{s.telephone || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">E-mail</p>
            <p className="font-medium text-foreground">{s.email || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Adresse</p>
            <p className="text-foreground">{s.adresse || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Localité / BP</p>
            <p className="text-foreground">{[s.localite, s.bp].filter(Boolean).join(" - ") || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">N° Pièce d&apos;identité</p>
            <p className="text-foreground">{s.num_identification || "—"}</p>
          </div>
          {s.date_naissance ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Date de naissance</p>
              <p className="text-foreground">{formaterDate(s.date_naissance)}</p>
            </div>
          ) : null}
          {s.profession ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Profession</p>
              <p className="text-foreground">{s.profession}</p>
            </div>
          ) : null}
          {s.mobile_money ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Mobile Money</p>
              <p className="text-foreground">{s.mobile_money}</p>
            </div>
          ) : null}
        </div>
      </Carte>

      {/* 2. Documents émis du client (tous types : devis, contrats, factures, quittances) */}
      <Carte titre={`Documents émis du client (${documents.length})`}>
        <p className="mb-4 text-xs text-muted-foreground">
          Tous les documents officiels générés pour ce client (devis, conditions particulières, factures, reçus et avoirs) sont centralisés ici.
        </p>
        <form method="get" action="/api/documents/zip" className="space-y-4">
          <Tableau
            colonnes={COLONNES_DOCUMENTS}
            lignes={documents}
            cleLigne={(d) => String(d.id)}
            messageVide="Aucun document émis pour ce client pour le moment."
            legende="Documents émis du client"
          />
          {documents.length > 0 ? (
            <div className="flex items-center gap-3 pt-2">
              <Bouton type="submit" variante="secondaire">
                Télécharger la sélection (ZIP)
              </Bouton>
            </div>
          ) : null}
        </form>
      </Carte>

      {/* 3. Contrats & Polices d'assurance */}
      <Carte titre={`Contrats & Polices (${client.polices.length})`}>
        <Tableau
          legende="Polices souscrites"
          lignes={client.polices}
          cleLigne={(p) => String(p.id)}
          messageVide="Aucune police émise pour ce client."
          colonnes={[
            {
              cle: "numero",
              entete: "N° Police",
              className: "font-mono font-semibold",
              rendu: (p) => p.numero,
            },
            {
              cle: "produit",
              entete: "Produit",
              rendu: (p) => p.produitCode,
            },
            {
              cle: "type",
              entete: "Type contrat",
              rendu: (p) => p.typeContrat || "—",
            },
            {
              cle: "periode",
              entete: "Période",
              rendu: (p) => `${formaterDate(p.dateEffet)} au ${formaterDate(p.dateEcheance)}`,
            },
            {
              cle: "ttc",
              entete: "Prime TTC",
              className: "font-mono",
              rendu: (p) => formaterMontant(montant(p.ttcTotal)),
            },
          ]}
        />
      </Carte>

      {/* 4. Historique des cotations */}
      {client.cotations.length > 0 ? (
        <Carte titre={`Historique des cotations (${client.cotations.length})`}>
          <Tableau
            legende="Cotations du client"
            lignes={client.cotations}
            cleLigne={(c) => String(c.id)}
            messageVide="Aucune cotation."
            colonnes={[
              {
                cle: "numero",
                entete: "N° Cotation",
                className: "font-mono font-semibold",
                rendu: (c) => (
                  <Link href={`/cotations/${c.id}`} className="text-primary hover:underline">
                    {c.numero ?? `Brouillon #${c.id}`}
                  </Link>
                ),
              },
              {
                cle: "produit",
                entete: "Produit",
                rendu: (c) => c.produitCode,
              },
              {
                cle: "statut",
                entete: "Statut",
                rendu: (c) => <PastilleStatut libelle={c.statut} />,
              },
              {
                cle: "creeLe",
                entete: "Créée le",
                rendu: (c) => formaterDate(c.creeLe.toISOString().slice(0, 10)),
              },
            ]}
          />
        </Carte>
      ) : null}
    </main>
  );
}

