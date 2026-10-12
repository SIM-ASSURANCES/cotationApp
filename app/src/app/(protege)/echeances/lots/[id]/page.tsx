import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BarreProgression, RafraichissementAuto } from "@/composants/RafraichissementAuto";
import { lireLotEcheances } from "@/serveur/echeances";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

const LIBELLE_STATUT: Record<string, string> = { A_FAIRE: "À faire", PRODUIT: "Produit", DEJA_PRODUIT: "Déjà produit", SANS_OBJET: "Sans objet", ECHEC: "En échec" };

/** Avancement d'un lot d'avis et de relances (file de tâches) : rafraîchi toutes les 3 secondes tant qu'il tourne. */
export default async function PageLotEcheances(props: PageProps<"/echeances/lots/[id]">) {
  const { id } = await props.params;
  const { horsFile } = await props.searchParams;
  const utilisateur = await exigerUtilisateur();
  let lot;
  try {
    lot = Number.isInteger(Number(id)) ? await lireLotEcheances(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!lot) notFound();
  const enCours = lot.statut === "EN_COURS";

  return (
    <main>
      <RafraichissementAuto actif={enCours} />
      <p className="mb-2 text-sm"><Link href="/echeances" className="text-primary underline">← Liste du jour</Link></p>
      <h1 className="mb-1 text-2xl font-semibold text-primary">Lot n° {lot.id} d&apos;avis et de relances</h1>
      <p className="mb-4 text-sm text-neutral">Liste du {lot.dateListe}, lancé par {lot.creePar}. Vous pouvez continuer à travailler : le lot tourne en tâche de fond.</p>
      {horsFile ? <p role="alert" className="mb-4 text-sm font-medium text-warning">La file de tâches est injoignable : le lot sera traité au retour du travailleur. Prévenez l&apos;administrateur.</p> : null}
      <BarreProgression faits={lot.faits} total={lot.total} libelle={enCours ? "Documents traités" : "Lot terminé"} />
      <p className="mb-4 text-sm">{Object.entries(lot.parStatut).map(([s, n]) => `${LIBELLE_STATUT[s] ?? s} : ${n}`).join(" · ")}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground"><th className="p-2">Document</th><th className="p-2">Facture</th><th className="p-2">Échéance</th><th className="p-2">État</th><th className="p-2">Numéro</th><th className="p-2">Message</th></tr>
        </thead>
        <tbody>
          {lot.elements.map((e, i) => (
            <tr key={i} className="border-b border-border">
              <td className="p-2">{e.type === "AVIS_ECHEANCE" ? "Avis d'échéance" : `Relance niveau ${e.niveau}`}</td>
              <td className="p-2"><Link href={`/factures/${e.factureId}`} className="text-primary underline">facture</Link></td>
              <td className="p-2">n° {e.echeanceNumero}</td><td className="p-2">{LIBELLE_STATUT[e.statut] ?? e.statut}</td><td className="p-2">{e.numero ?? "—"}</td><td className="p-2">{e.message ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
