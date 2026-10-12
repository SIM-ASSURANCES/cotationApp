import Link from "next/link";
import type { ReactNode } from "react";

import { Icone } from "./icones";

export type MiettePage = { libelle: string; href?: string };

/** En-tête de page : fil d'Ariane facultatif, titre, sous-titre, et zone d'actions à droite (bouton principal, filtres). */
export function EnTetePage({ titre, sousTitre, actions, filAriane }: { titre: string; sousTitre?: string; actions?: ReactNode; filAriane?: MiettePage[] }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {filAriane && filAriane.length > 0 ? (
          <nav aria-label="Fil d'Ariane" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
              {filAriane.map((miette, i) => (
                <li key={`${miette.libelle}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <Icone nom="chevron-droite" className="size-3.5" /> : null}
                  {miette.href ? (
                    <Link href={miette.href} className="transition-colors duration-150 ease-out-strong hover:text-foreground">
                      {miette.libelle}
                    </Link>
                  ) : (
                    <span aria-current="page">{miette.libelle}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="text-[28px] font-black leading-tight tracking-tight text-foreground sm:text-3xl">{titre}</h1>
        {sousTitre ? <p className="mt-1.5 text-[15px] text-muted-foreground">{sousTitre}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
