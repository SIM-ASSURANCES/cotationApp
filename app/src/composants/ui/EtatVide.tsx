import { Icone, type NomIcone } from "./icones";
import { cx } from "./classes";

/** État vide d'une liste ou d'une section : icône dans une pastille neutre et message, sans action ni décor superflu. */
export function EtatVide({ icone = "boite", message, compact = false, encadre = true }: { icone?: NomIcone; message: string; compact?: boolean; encadre?: boolean }) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-2 text-center text-sm text-neutral",
        encadre && "rounded-md border border-border bg-muted",
        compact ? "px-4 py-8" : "px-8 py-10",
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-neutral-bg text-neutral">
        <Icone nom={icone} className="size-5" />
      </span>
      <p>{message}</p>
    </div>
  );
}
