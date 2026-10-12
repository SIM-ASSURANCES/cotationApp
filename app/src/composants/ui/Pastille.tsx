import type { ReactNode } from "react";

import { cx } from "./classes";

export type TonPastille = "principal" | "info" | "succes" | "avertissement" | "danger" | "neutre";

const CLASSES_TON: Record<TonPastille, string> = {
  principal: "border-primary-border bg-primary-bg text-primary",
  info: "border-info-border bg-info-bg text-info",
  succes: "border-success-border bg-success-bg text-success",
  avertissement: "border-warning-border bg-warning-bg text-warning",
  danger: "border-danger-border bg-danger-bg text-danger",
  neutre: "border-neutral-border bg-neutral-bg text-neutral",
};

/**
 * Étiquette de statut. Elle ne connaît aucun statut métier : la page choisit le ton (voir la table de correspondance
 * statut → ton des écrans métier). Le ton ne porte jamais le sens seul : le libellé reste écrit.
 */
export function Pastille({ ton = "neutre", className, children }: { ton?: TonPastille; className?: string; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", CLASSES_TON[ton], className)}>{children}</span>;
}
