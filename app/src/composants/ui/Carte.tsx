import type { ReactNode } from "react";

import { cx } from "./classes";

/**
 * Surface standard : fond blanc, coins arrondis, bordure fine et ombre teintée. `espacement="aucun"` pour y loger un tableau.
 * `titre` (et `description`) ajoutent l'en-tête de section de la carte ; `ton="danger"` pour une zone d'action irréversible.
 */
export function Carte({
  children,
  className,
  espacement = "normal",
  titre,
  description,
  ton = "normal",
}: {
  children: ReactNode;
  className?: string;
  espacement?: "normal" | "aucun";
  titre?: string;
  description?: ReactNode;
  ton?: "normal" | "danger";
}) {
  return (
    <section className={cx("rounded-2xl border bg-surface shadow-elevated", ton === "danger" ? "border-danger-border" : "border-border", espacement === "normal" && "p-6", className)}>
      {titre ? <h2 className={cx("text-lg font-bold text-foreground", !description && "mb-3")}>{titre}</h2> : null}
      {description ? <div className="mb-4 mt-1 text-sm text-muted-foreground">{description}</div> : null}
      {children}
    </section>
  );
}
