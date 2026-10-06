import type { Metadata } from "next";
import { connection } from "next/server";

import { verifierJeton } from "@/serveur/documents";

export const metadata: Metadata = { title: "Vérification d'un document – SIM Assurances", robots: { index: false, follow: false } };

const formatDate = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/**
 * Page PUBLIQUE de vérification d'un QR code (CDC §14.1) : type, numéro, date, statut en temps réel,
 * produit, souscripteur masqué et empreinte. Aucune autre donnée personnelle. Un jeton inconnu donne
 * une page neutre, qui ne dit pas si le jeton a existé.
 */
export default async function PageVerification(props: PageProps<"/verif/[jeton]">) {
  await connection();
  const { jeton } = await props.params;
  const vue = await verifierJeton(jeton);
  const couleur = vue?.statut.code === "VALIDE" ? "border-green-700 text-green-800" : "border-red-700 text-red-700";
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <p className="mb-6 text-lg font-bold tracking-wide text-sim-bleu">
        SIM <span className="font-light">ASSURANCES</span>
      </p>
      <h1 className="mb-4 text-2xl font-semibold">Vérification d'un document</h1>
      {vue ? (
        <>
          <p className={`mb-6 rounded border-2 p-3 text-center text-xl font-bold ${couleur}`}>{vue.statut.libelle}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium">Document</dt>
            <dd>{vue.type}</dd>
            <dt className="font-medium">Numéro</dt>
            <dd>
              {vue.numero} (version {vue.version})
            </dd>
            <dt className="font-medium">Émis le</dt>
            <dd>{formatDate(vue.dateEmission)}</dd>
            <dt className="font-medium">Produit</dt>
            <dd>{vue.produit}</dd>
            <dt className="font-medium">Souscripteur</dt>
            <dd>{vue.souscripteur}</dd>
            <dt className="font-medium">Empreinte SHA-256</dt>
            <dd className="break-all font-mono text-xs">{vue.empreinte}</dd>
          </dl>
          <p className="mt-6 text-xs text-zinc-600">
            L'empreinte permet de vérifier qu'un fichier PDF n'a pas été modifié : elle doit être identique à celle du fichier reçu.
          </p>
        </>
      ) : (
        <p className="rounded border border-bordure bg-surface p-4">Ce lien de vérification ne correspond à aucun document. Vérifiez qu'il a été recopié en entier, ou contactez SIM Assurances.</p>
      )}
    </main>
  );
}
