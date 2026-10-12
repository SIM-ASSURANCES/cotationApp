import Link from "next/link";

import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT, STATUTS, estStatut } from "@/domaine/cotation/statuts";
import { peutAgir, peutLire } from "@/domaine/droits";
import { listerCotations } from "@/serveur/cotations";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

const formatDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Africa/Abidjan" });
const COULEUR: Record<string, string> = {
  BROUILLON: "border border-neutral-border bg-neutral-bg text-neutral",
  A_VALIDER: "border border-warning-border bg-warning-bg text-warning",
  EMISE: "border border-primary-border bg-primary-bg text-primary",
  ACCEPTEE: "border border-success-border bg-success-bg text-success",
  REFUSEE: "border border-danger-border bg-danger-bg text-danger",
  EXPIREE: "border border-neutral-border bg-neutral-bg text-neutral",
};

export default async function PageCotations(props: PageProps<"/cotations">) {
  const utilisateur = await exigerDroit("CREER_COTATION", peutLire);
  const q = await props.searchParams;
  const statut = typeof q.statut === "string" && estStatut(q.statut) ? q.statut : undefined;
  const [cotations, niveau] = await Promise.all([listerCotations(utilisateur, { statut }), niveauDuProfil(utilisateur.profil, "CREER_COTATION")]);

  return (
    <main>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold text-primary">Cotations</h1>
        {peutAgir(niveau) ? (
          <Link href="/cotations/nouvelle" className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">
            Nouvelle cotation
          </Link>
        ) : null}
        <Link href="/clients" className="text-sm text-primary underline">
          Clients
        </Link>
      </div>
      <nav aria-label="Filtre par statut" className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/cotations" className={`rounded border px-3 py-1 ${!statut ? "border-primary bg-muted font-semibold" : "border-border"}`}>
          Tous
        </Link>
        {STATUTS.map((s) => (
          <Link key={s} href={`/cotations?statut=${s}`} className={`rounded border px-3 py-1 ${statut === s ? "border-primary bg-muted font-semibold" : "border-border"}`}>
            {LIBELLE_STATUT[s]}
          </Link>
        ))}
      </nav>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-left text-primary-foreground">
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
              <tr key={c.id} className="border-b border-border">
                <td className="p-2">
                  <Link href={`/cotations/${c.id}`} className="font-medium text-primary underline">
                    {c.numero ?? `Brouillon n° ${c.id}`}
                  </Link>
                </td>
                <td className="p-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR[c.statut]}`}>{LIBELLE_STATUT[c.statut]}</span>
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
                <td colSpan={7} className="p-4 text-center text-neutral">
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
