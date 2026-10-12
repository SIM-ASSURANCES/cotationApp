"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent as ToucheReact } from "react";

import { cx } from "../ui/classes";
import { Icone } from "../ui/icones";
import { Pastille } from "../ui/Pastille";

const SELECTEUR_ENTREES = '[role="menuitem"]';

/**
 * Menu du profil (barre du haut) : nom et profil de l'utilisateur, « Mon compte » et déconnexion. Se ferme au clic à
 * l'extérieur, à la touche Échap (le focus revient au bouton) et quand le focus le quitte. Flèches haut/bas, Début et Fin
 * parcourent les entrées ; flèche bas sur le bouton ouvre le menu.
 */
export function MenuProfil({ nom, libelleProfil, deconnexion }: { nom: string; libelleProfil: string; deconnexion: () => Promise<void> }) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  // Ouverture au clavier (flèche bas) : le focus passe à la première entrée une fois le menu affiché.
  const focusPremiereEntree = useRef(false);
  const idMenu = useId();

  useEffect(() => {
    if (!ouvert) return;
    if (focusPremiereEntree.current) {
      focusPremiereEntree.current = false;
      racine.current?.querySelector<HTMLElement>(SELECTEUR_ENTREES)?.focus();
    }
    const surClicExterieur = (evenement: PointerEvent) => {
      if (racine.current && !racine.current.contains(evenement.target as Node)) setOuvert(false);
    };
    const surEchap = (evenement: KeyboardEvent) => {
      if (evenement.key !== "Escape") return;
      setOuvert(false);
      declencheur.current?.focus();
    };
    document.addEventListener("pointerdown", surClicExterieur);
    document.addEventListener("keydown", surEchap);
    return () => {
      document.removeEventListener("pointerdown", surClicExterieur);
      document.removeEventListener("keydown", surEchap);
    };
  }, [ouvert]);

  function surTouche(evenement: ToucheReact<HTMLDivElement>) {
    if (!ouvert) {
      if (evenement.key === "ArrowDown" && evenement.target === declencheur.current) {
        evenement.preventDefault();
        focusPremiereEntree.current = true;
        setOuvert(true);
      }
      return;
    }
    const entrees = Array.from(racine.current?.querySelectorAll<HTMLElement>(SELECTEUR_ENTREES) ?? []);
    if (entrees.length === 0) return;
    const courante = entrees.indexOf(document.activeElement as HTMLElement);
    let cible: HTMLElement | undefined;
    if (evenement.key === "ArrowDown") cible = entrees[(courante + 1) % entrees.length];
    else if (evenement.key === "ArrowUp") cible = courante <= 0 ? entrees[entrees.length - 1] : entrees[courante - 1];
    else if (evenement.key === "Home") cible = entrees[0];
    else if (evenement.key === "End") cible = entrees[entrees.length - 1];
    if (cible) {
      evenement.preventDefault();
      cible.focus();
    }
  }

  // Tabulation hors du menu : on le ferme. Un focus qui part vers « nulle part » (clic sur une zone inerte du menu) ne le ferme pas.
  function surPerteDeFocus(evenement: FocusEvent<HTMLDivElement>) {
    const suivant = evenement.relatedTarget;
    if (suivant instanceof Node && !evenement.currentTarget.contains(suivant)) setOuvert(false);
  }

  return (
    <div ref={racine} className="relative" onKeyDown={surTouche} onBlur={surPerteDeFocus}>
      <button
        ref={declencheur}
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idMenu : undefined}
        // Sous sm le nom est masqué : le bouton garde son nom accessible.
        aria-label={`Menu du compte : ${nom}, ${libelleProfil}`}
        className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-[background-color,transform] duration-150 ease-out-strong hover:bg-muted motion-safe:active:scale-[0.98]"
      >
        <Icone nom="utilisateur" className="size-5 text-neutral sm:hidden" />
        <span className="hidden max-w-48 truncate text-sm font-semibold text-foreground sm:block">{nom}</span>
        <span className="hidden sm:inline-flex">
          <Pastille ton="neutre">{libelleProfil}</Pastille>
        </span>
        <Icone nom="chevron-bas" className={cx("size-4 shrink-0 text-neutral transition-transform duration-200 ease-out-strong motion-reduce:transition-none", ouvert && "rotate-180")} />
      </button>

      {ouvert ? (
        <div id={idMenu} className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-64 origin-top-right rounded-xl border border-border bg-surface py-2 shadow-elevated-lg">
          <div className="border-b border-border px-4 pb-3 pt-1">
            <p className="truncate text-sm font-semibold text-foreground">{nom}</p>
            <p className="truncate text-xs text-neutral">{libelleProfil}</p>
          </div>
          <div role="menu" aria-label="Compte" className="pt-1">
            <Link
              role="menuitem"
              href="/mon-compte"
              onClick={() => setOuvert(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-foreground transition-colors duration-150 ease-out-strong hover:bg-muted"
            >
              <Icone nom="utilisateur" className="size-4 text-neutral" />
              Mon compte
            </Link>
            <div role="separator" className="my-1 h-px bg-border" />
            <form action={deconnexion} role="none">
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-danger transition-colors duration-150 ease-out-strong hover:bg-danger-bg"
              >
                <Icone nom="deconnexion" className="size-4" />
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
