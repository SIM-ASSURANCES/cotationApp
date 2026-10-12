import type { ReactNode } from "react";

import { cx } from "./classes";

/** Surface standard : fond blanc, coins arrondis, bordure fine et ombre teintée. `espacement="aucun"` pour y loger un tableau. */
export function Carte({ children, className, espacement = "normal" }: { children: ReactNode; className?: string; espacement?: "normal" | "aucun" }) {
  return <div className={cx("rounded-2xl border border-border bg-surface shadow-elevated", espacement === "normal" && "p-6", className)}>{children}</div>;
}
