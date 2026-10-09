"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Relit la page toutes les `secondes` tant que `actif` (avancement d'une tâche de fond). L'utilisateur peut partir et revenir. */
export function RafraichissementAuto({ actif, secondes = 3 }: { actif: boolean; secondes?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!actif) return;
    const minuteur = setInterval(() => router.refresh(), secondes * 1000);
    return () => clearInterval(minuteur);
  }, [actif, secondes, router]);
  return null;
}

/** Barre de progression accessible : « traités / total ». */
export function BarreProgression({ faits, total, libelle }: { faits: number; total: number; libelle: string }) {
  const pourcent = total === 0 ? 100 : Math.round((faits / total) * 100);
  return (
    <div className="mb-3">
      <div className="mb-1 text-sm font-medium">
        {libelle} : {faits} / {total} ({pourcent} %)
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={faits} aria-label={libelle} className="h-3 w-full max-w-xl overflow-hidden rounded bg-surface">
        <div className="h-3 bg-sim-bleu transition-all" style={{ width: `${pourcent}%` }} />
      </div>
    </div>
  );
}
