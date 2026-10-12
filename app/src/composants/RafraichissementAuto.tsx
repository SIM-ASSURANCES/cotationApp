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

/** Barre de progression accessible : « traités / total ». Piste `bg-muted`, remplissage `bg-primary` ; l'animation de largeur respecte `prefers-reduced-motion`. */
export function BarreProgression({ faits, total, libelle }: { faits: number; total: number; libelle: string }) {
  const pourcent = total === 0 ? 100 : Math.round((faits / total) * 100);
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-sm font-medium tabular-nums text-foreground">
        {libelle} : {faits} / {total} ({pourcent} %)
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={faits} aria-label={libelle} className="h-2.5 w-full max-w-xl overflow-hidden rounded-full bg-muted">
        <div className="h-2.5 rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out-strong" style={{ width: `${pourcent}%` }} />
      </div>
    </div>
  );
}
