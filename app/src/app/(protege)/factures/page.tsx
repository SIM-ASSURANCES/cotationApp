import Link from "next/link";
import { redirect } from "next/navigation";

import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT_FACTURE, STATUTS_FACTURE } from "@/domaine/facturation/factures";
import { listerFactures } from "@/serveur/factures";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const f = (m: string) => formaterMontant(montant(m));
const entree = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2";

export default async function PageFactures(props: PageProps<"/factures">) {
  const params = await props.searchParams;
  const texte = (nom: string) => (typeof params[nom] === "string" ? (params[nom] as string) : "");
  const filtres = { statut: texte("statut"), numero: texte("numero"), police: texte("police") };
  const utilisateur = await exigerUtilisateur();
  let lignes;
  try {
    lignes = await listerFactures(utilisateur, { statut: filtres.statut || undefined, numero: filtres.numero || undefined, police: filtres.police || undefined });
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }

  return (
    <main>
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">Factures et avoirs</h1>
      <p className="mb-4 text-sm text-zinc-700">Une facture se prépare depuis la police (fiche de la cotation acceptée, lien « Factures »). Les 200 plus récentes.</p>
      <form className="mb-6 grid max-w-4xl gap-3 sm:grid-cols-4" method="get">
        <label className="text-sm">Statut
          <select name="statut" defaultValue={filtres.statut} className={entree}>
            <option value="">Tous</option>
            {STATUTS_FACTURE.map((s) => <option key={s} value={s}>{LIBELLE_STATUT_FACTURE[s]}</option>)}
          </select>
        </label>
        <label className="text-sm">Numéro<input name="numero" defaultValue={filtres.numero} className={entree} /></label>
        <label className="text-sm">Police<input name="police" defaultValue={filtres.police} className={entree} /></label>
        <div className="flex items-end"><button className="rounded bg-sim-bleu px-4 py-2 font-semibold text-white">Filtrer</button></div>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-left text-white">
              <th className="p-2">Numéro</th><th className="p-2">Type</th><th className="p-2">Statut</th><th className="p-2">Police</th><th className="p-2">Souscripteur</th><th className="p-2">Émise le</th><th className="p-2 text-right">TTC</th><th className="p-2 text-right">Restant dû</th><th className="p-2">PDF</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((x) => (
              <tr key={x.id} className="border-b border-bordure">
                <td className="p-2"><Link href={`/factures/${x.id}`} className="text-sim-bleu underline">{x.numero ?? `Brouillon n° ${x.id}`}</Link></td>
                <td className="p-2">{x.libelleType}</td>
                <td className="p-2">{x.libelleStatut}</td>
                <td className="p-2"><Link href={`/cotations/${x.cotationId}/factures`} className="underline">{x.policeNumero}</Link></td>
                <td className="p-2">{x.souscripteur}</td>
                <td className="p-2">{x.dateEmission ?? "—"}</td>
                <td className="p-2 text-right">{f(x.ttc)}</td>
                <td className="p-2 text-right">{x.restantDu === null ? "—" : f(x.restantDu)}</td>
                <td className="p-2">{x.pdfEnAttente > 0 ? <strong className="text-amber-700">En attente</strong> : x.numero ? "Produit" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lignes.length === 0 ? <p className="mt-3 text-sm text-zinc-700">Aucune facture.</p> : null}
      </div>
    </main>
  );
}
