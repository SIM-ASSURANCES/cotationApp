import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "./classes";
import { Icone, type NomIcone } from "./icones";

export type TonIndicateur = "info" | "succes" | "avertissement" | "neutre" | "danger" | "principal";

/** Filet de tête de 3 px : premier signal de couleur, lisible avant même le chiffre. */
const CLASSES_FILET: Record<TonIndicateur, string> = {
  info: "bg-info",
  succes: "bg-success",
  avertissement: "bg-warning",
  neutre: "bg-border",
  danger: "bg-danger",
  principal: "bg-primary",
};

/** Halo de focus et bordure au survol assortis au ton : un indicateur « danger » ne se souligne pas en bleu au clavier. */
const CLASSES_ACCENT: Record<TonIndicateur, string> = {
  info: "hover:border-info/40 focus-visible:outline-info",
  succes: "hover:border-success/40 focus-visible:outline-success",
  avertissement: "hover:border-warning/40 focus-visible:outline-warning",
  neutre: "hover:border-neutral/40 focus-visible:outline-neutral",
  danger: "hover:border-danger/40 focus-visible:outline-danger",
  principal: "hover:border-primary/40 focus-visible:outline-primary",
};

/**
 * Carte d'indicateur des tableaux de bord. Le chiffre est l'élément le plus affirmé (grand, très gras, chiffres tabulaires),
 * l'étiquette reste discrète au-dessus. Pastille d'icône toujours en bleu principal : le sens passe par le filet de tête et
 * le halo (`ton`). Avec `href`, la carte est un lien vers le détail.
 */
export function CarteIndicateur({
  icone,
  etiquette,
  valeur,
  precision,
  ton = "info",
  href,
}: {
  icone: NomIcone;
  etiquette: string;
  valeur: ReactNode;
  /** Ligne secondaire sous la valeur (base de calcul, montant). */
  precision?: string;
  ton?: TonIndicateur;
  href?: string;
}) {
  const contenu = (
    <>
      <span
        className={cx(
          "mb-4 inline-grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-transform duration-200 ease-out-strong",
          href && "motion-safe:group-hover:scale-110",
        )}
      >
        <Icone nom={icone} className="size-5" />
      </span>
      <p className="text-[13px] font-semibold text-muted-foreground">{etiquette}</p>
      <p className="mt-1.5 whitespace-nowrap text-[28px] font-black leading-none tracking-tight text-foreground tabular-nums">{valeur}</p>
      {precision ? <p className="mt-2 text-xs font-medium text-muted-foreground tabular-nums">{precision}</p> : null}
    </>
  );
  const filet = <span className={cx("absolute inset-x-0 top-0 h-[3px]", CLASSES_FILET[ton])} aria-hidden="true" />;
  const base = "relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-5 pt-6 shadow-elevated";
  if (href) {
    return (
      <Link
        href={href}
        className={cx(
          "group outline-offset-2 transition-[border-color,transform] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 focus-visible:outline-2",
          base,
          CLASSES_ACCENT[ton],
        )}
      >
        {filet}
        {contenu}
        <span className="mt-auto flex items-center gap-1 pt-3 text-xs font-semibold text-muted-foreground transition-colors duration-200 group-hover:text-primary">
          Voir le détail
          <Icone nom="fleche-haut-droite" className="size-3" />
        </span>
      </Link>
    );
  }
  return (
    <div className={base}>
      {filet}
      {contenu}
    </div>
  );
}
