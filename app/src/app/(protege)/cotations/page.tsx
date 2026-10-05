import Link from "next/link";

import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT, STATUTS, estStatut } from "@/domaine/cotation/statuts";
import { peutAgir, peutLire } from "@/domaine/droits";
import { listerCotations } from "@/serveur/cotations";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

const formatDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Africa/Abidjan" });
const COULEUR: Record<string, string> = {
  BROUILLON: "bg-zinc-200",
  A_VALIDER: "bg-amber-200",
  EMISE: "bg-sky-200",
  ACCEPTEE: "bg-green-200",
  REFUSEE: "bg-red-200",
  EXPIREE: "bg-orange-200",
};

export default async function PageCotations(props: PageProps<"/cotations">) {
  const utilisateur = await exigerDroit("CREER_COTATION", peutLire);
  const q = await props.searchParams;
  const statut = typeof q.statut === "string" && estStatut(q.statut) ? q.statut : undefined;
  const [cotations, niveau] = await Promise.all([listerCotations(utilisateur, { statut }), niveauDuProfil(utilisateur.profil, "CREER_COTATION")]);

  return (
    <main>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold text-sim-bleu">Cotations</h1>
        {peutAgir(niveau) ? (
          <Link href="/cotations/nouvelle" className="rounded bg-sim-bleu px-4 py-2 text-sm font-semibold text-white hover:bg-sim-marine">
            Nouvelle cotation
          </Link>
        ) : null}
        <Link href="/clients" className="text-sm text-sim-bleu underline">
          Clients
        </Link>
      </div>
      <nav aria-label="Filtre par statut" className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/cotations" className={`rounded border px-3 py-1 ${!statut ? "border-sim-bleu bg-surface font-semibold" : "border-bordure"}`}>
          Tous
        </Link>
        {STATUTS.map((s) => (
          <Link key={s} href={`/cotations?statut=${s}`} className={`rounded border px-3 py-1 ${statut === s ? "border-sim-bleu bg-surface font-semibold" : "border-bordure"}`}>
            {LIBELLE_STATUT[s]}
          </Link>
        ))}
      </nav>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-left text-white">
              <th className="p-2">N°</th>
              <th className="p-2">Statut</th>
              <th className="p-2">Produit</th>
              <th className="p-2">Souscripteur</th>
              <th className="p-2 text-right">TTC (F CFA)</th>
              <th className="p-2">Valide jusqu'au</th>
              <th className="p-2">Auteur</th>
            </tr>
          </thead>
          <tbody>
            {cotations.map((c) => (
              <tr key={c.id} className="border-b border-bordure">
                <td className="p-2">
                  <Link href={`/cotations/${c.id}`} className="font-medium text-sim-bleu underline">
                    {c.numero ?? `Brouillon n° ${c.id}`}
                  </Link>
                </td>
                <td className="p-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${COULEUR[c.statut]}`}>{LIBELLE_STATUT[c.statut]}</span>
                </td>
                <td className="p-2">{c.produit}</td>
                <td className="p-2">{c.souscripteur}</td>
                <td className="p-2 text-right">{c.ttc ? formaterMontant(montant(c.ttc)) : "—"}</td>
                <td className="p-2">{c.dateValidite ? formatDate.format(new Date(`${c.dateValidite}T00:00:00Z`)) : "—"}</td>
                <td className="p-2">{c.auteur}</td>
              </tr>
            ))}
            {cotations.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-zinc-600">
                  Aucune cotation.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
