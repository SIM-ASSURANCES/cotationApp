import Link from "next/link";

import type { TacheLue } from "@/domaine/imports/taches";

/**
 * Tâches ouvertes d'une police (H64) : pièces à émettre après un import en masse. Chaque tâche reste affichée
 * jusqu'à l'émission de sa pièce (nouvelle version des CP, facture d'avenant de la version de la liste).
 */
export function TachesPolice({ taches, cotationId }: { taches: TacheLue[]; cotationId: number }) {
  if (taches.length === 0) return null;
  const lien = (t: TacheLue) => (t.type === "CP_A_EMETTRE" ? `/cotations/${cotationId}/adherents` : `/cotations/${cotationId}/factures`);
  return (
    <section role="status" aria-label="Tâches de la police" className="mb-6 max-w-4xl rounded border border-amber-600 bg-amber-50 p-3 text-sm">
      <h2 className="mb-1 font-semibold">À faire sur cette police</h2>
      <ul className="list-disc pl-5">
        {taches.map((t) => (
          <li key={t.id}>
            <Link href={lien(t)} className="text-sim-bleu underline">{t.libelle}</Link> — liste des adhérents version {t.versionAdherents} (import du{" "}
            {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" }).format(t.creeLe)} par {t.creePar})
          </li>
        ))}
      </ul>
    </section>
  );
}
