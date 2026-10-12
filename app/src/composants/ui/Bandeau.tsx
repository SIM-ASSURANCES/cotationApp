import type { ReactNode } from "react";

import { cx } from "./classes";
import { Icone, type NomIcone } from "./icones";

export type TonBandeau = "info" | "succes" | "avertissement" | "danger" | "neutre";

const CLASSES_TON: Record<TonBandeau, string> = {
  info: "border-info-border bg-info-bg text-info",
  succes: "border-success-border bg-success-bg text-success",
  avertissement: "border-warning-border bg-warning-bg text-warning",
  danger: "border-danger-border bg-danger-bg text-danger",
  neutre: "border-neutral-border bg-neutral-bg text-neutral",
};
const ICONE_TON: Record<TonBandeau, NomIcone> = { info: "information", succes: "succes", avertissement: "alerte", danger: "alerte", neutre: "information" };

/**
 * Bandeau d'information, de mise en garde ou d'erreur au style des messages du portail RH (icône, bordure et fond teintés). Le ton ne
 * porte jamais le sens seul : le texte dit ce qu'il faut savoir. `role="alert"` pour ce qui exige l'attention tout de suite (erreur),
 * `role="status"` pour le reste ; sans `role`, c'est un simple encadré de texte.
 */
export function Bandeau({ ton = "info", role, titre, className, children }: { ton?: TonBandeau; role?: "alert" | "status"; titre?: string; className?: string; children: ReactNode }) {
  return (
    <div role={role} className={cx("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", CLASSES_TON[ton], className)}>
      <Icone nom={ICONE_TON[ton]} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {titre ? <p className="font-semibold">{titre}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
