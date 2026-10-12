"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { brancheContientChemin, lienEstActif, type LienNavigation, type Navigation } from "@/domaine/navigation";

import { cx } from "../ui/classes";
import { Icone } from "../ui/icones";
import { TRACES_PICTOGRAMME, VUE_PICTOGRAMME } from "../ui/pictogramme";
import { ID_TIROIR } from "./tiroir";

/** Pictogramme du logo (le triangle, sans le texte), pour la barre repliée : un seul trait, couleur pilotée par `text-*`. */
function Pictogramme({ className }: { className?: string }) {
  return (
    <svg viewBox={VUE_PICTOGRAMME} fill="currentColor" className={className} aria-hidden="true">
      {TRACES_PICTOGRAMME.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * Barre latérale : « Accueil » épinglé, puis les branches en accordéon (une seule ouverte à la fois ; celle de la page affichée
 * l'est au chargement), pied avec la bascule « Réduire » et la déconnexion.
 *
 * - Repliée (à partir de lg) : colonne d'icônes, branches séparées par un filet, libellés portés par `title`.
 * - En dessous de lg : tiroir fixe qui glisse depuis la gauche, voile cliquable, refermé par un clic sur un lien, par le bouton
 *   « Fermer le menu » ou par Échap. Toujours déployé : la préférence « repliée » ne vaut que sur grand écran. Ouvert, il se
 *   comporte comme une fenêtre modale : le focus y entre (la coquille rend le reste inerte et le lui rend à la fermeture).
 */
export function BarreLaterale({
  navigation,
  repliee,
  grandEcran,
  surBasculerRepli,
  tiroirOuvert,
  surFermerTiroir,
  deconnexion,
}: {
  navigation: Navigation;
  repliee: boolean;
  /** Vrai à partir de lg (la barre est alors dans la page, pas dans un tiroir). */
  grandEcran: boolean;
  surBasculerRepli: () => void;
  tiroirOuvert: boolean;
  surFermerTiroir: () => void;
  deconnexion: () => Promise<void>;
}) {
  const chemin = usePathname();
  const replie = repliee && grandEcran;
  const boutonFermer = useRef<HTMLButtonElement>(null);

  // Branche ouverte : celle de la page affichée ; à défaut (accueil, « Mon compte »), la première, comme le portail RH.
  const [brancheOuverte, setBrancheOuverte] = useState<string | null>(
    () => (navigation.branches.find((b) => brancheContientChemin(b, chemin)) ?? navigation.branches[0])?.cle ?? null,
  );
  // Quand la page change autrement que par ce menu (lien dans une page), on déplie la branche de la nouvelle page. Ajustement
  // d'état pendant le rendu, comme le recommande React, plutôt qu'un effet qui provoquerait un second rendu visible.
  const [cheminVu, setCheminVu] = useState(chemin);
  if (chemin !== cheminVu) {
    setCheminVu(chemin);
    const courante = navigation.branches.find((b) => brancheContientChemin(b, chemin));
    if (courante) setBrancheOuverte(courante.cle);
  }

  // À l'ouverture du tiroir, le focus entre dedans ; la coquille le rend au bouton d'ouverture à la fermeture.
  useEffect(() => {
    if (tiroirOuvert) boutonFermer.current?.focus();
  }, [tiroirOuvert]);

  useEffect(() => {
    if (!tiroirOuvert) return;
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") surFermerTiroir();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [tiroirOuvert, surFermerTiroir]);

  return (
    <>
      {tiroirOuvert ? <div onClick={surFermerTiroir} aria-hidden="true" className="animate-fade-in fixed inset-0 z-20 bg-foreground/40 lg:hidden" /> : null}
      <aside
        id={ID_TIROIR}
        // Tiroir ouvert : fenêtre modale pour les technologies d'assistance ; autrement, simple barre latérale.
        {...(tiroirOuvert ? { role: "dialog", "aria-modal": true, "aria-label": "Menu" } : {})}
        className={cx(
          "fixed inset-y-0 left-0 z-30 flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
          // En dessous de lg : tiroir. `invisible` une fois refermé, pour que le clavier n'atteigne pas des liens hors écran. Une
          // transition utilise les propriétés de l'état d'ARRIVÉE : à la fermeture, la visibilité bascule à la fin du glissement
          // (le tiroir glisse avant de disparaître) ; à l'ouverture, elle bascule tout de suite, sinon le focus donné à
          // l'ouverture échouerait (un élément encore invisible ne peut pas le recevoir).
          "transition-[transform] duration-300 ease-drawer motion-reduce:transition-none",
          tiroirOuvert ? "translate-x-0" : "-translate-x-full max-lg:invisible max-lg:transition-[transform,visibility] max-lg:motion-reduce:transition-none",
          // À partir de lg : dans la page, pleine hauteur, largeur animée au repli.
          // 100vh moins les 2 × 3 px du cadre bleu de la coquille : à 100vh, la page déborderait de 6 px et ferait défiler tout le temps.
          "lg:sticky lg:top-0 lg:h-[calc(100vh-6px)] lg:translate-x-0 lg:transition-[width] lg:duration-200 lg:ease-out-strong lg:motion-reduce:transition-none",
          replie ? "w-[72px]" : "w-64",
        )}
      >
        {/* En-tête : logo blanc sur le bandeau bleu ; replié, le pictogramme seul sur fond blanc (le logo ferait moins de 120 px). */}
        <div className={cx("flex h-16 shrink-0 items-center", replie ? "justify-center bg-sidebar" : "justify-between bg-primary px-5")}>
          {replie ? (
            <Pictogramme className="h-8 w-auto text-primary" />
          ) : (
            <Image src="/logo-sim-blanc.svg" alt="SIM Assurances" width={188} height={28} priority className="h-auto w-40 lg:w-[188px]" />
          )}
          <button
            ref={boutonFermer}
            type="button"
            onClick={surFermerTiroir}
            aria-label="Fermer le menu"
            className="grid size-10 shrink-0 place-items-center rounded-lg text-primary-foreground outline-offset-2 transition-[background-color,transform] duration-150 ease-out-strong hover:bg-primary-hover focus-visible:outline-primary-foreground motion-safe:active:scale-90 lg:hidden"
          >
            <Icone nom="fermer" className="size-5" />
          </button>
        </div>

        <nav aria-label="Navigation principale" className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <LienMenu lien={navigation.accueil} actif={lienEstActif(navigation.accueil.href, chemin)} replie={replie} surNavigation={surFermerTiroir} />

          {navigation.branches.map((branche) => {
            if (replie) {
              return (
                <div key={branche.cle} className="mt-2 border-t border-sidebar-border pt-2">
                  <ul aria-label={branche.libelle} className="space-y-1">
                    {branche.groupes.flatMap((groupe) =>
                      groupe.liens.map((lien) => (
                        <li key={lien.href}>
                          <LienMenu lien={lien} actif={lienEstActif(lien.href, chemin)} replie surNavigation={surFermerTiroir} />
                        </li>
                      )),
                    )}
                  </ul>
                </div>
              );
            }

            const ouverte = brancheOuverte === branche.cle;
            const idPanneau = `branche-${branche.cle}`;
            return (
              <div key={branche.cle} className="pt-2">
                <button
                  type="button"
                  onClick={() => setBrancheOuverte(ouverte ? null : branche.cle)}
                  aria-expanded={ouverte}
                  aria-controls={idPanneau}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-[background-color,color] duration-150 ease-out-strong hover:bg-muted max-lg:py-2.5",
                    brancheContientChemin(branche, chemin) ? "text-primary" : "text-foreground",
                  )}
                >
                  <Icone nom={branche.icone} className="size-[18px] shrink-0" />
                  <span className="flex-1 truncate text-left">{branche.libelle}</span>
                  <Icone
                    nom="chevron-bas"
                    className={cx("size-4 shrink-0 text-neutral transition-transform duration-200 ease-out-strong motion-reduce:transition-none", !ouverte && "-rotate-90")}
                  />
                </button>

                {/* Toujours dans le DOM (aria-controls vise un élément qui existe), masqué tant que la branche est fermée. */}
                <div id={idPanneau} hidden={!ouverte} className="animate-fade-in mt-1 space-y-2 pb-1">
                  {branche.groupes.map((groupe, i) => (
                    <div key={groupe.titre ?? `groupe-${i}`}>
                      {groupe.titre ? (
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">{groupe.titre}</p>
                      ) : null}
                      <ul className="space-y-1">
                        {groupe.liens.map((lien) => (
                          <li key={lien.href}>
                            <LienMenu lien={lien} actif={lienEstActif(lien.href, chemin)} replie={false} imbrique surNavigation={surFermerTiroir} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-1 border-t border-sidebar-border px-3 py-3">
          <button
            type="button"
            onClick={surBasculerRepli}
            title={replie ? "Déployer le menu" : "Réduire le menu"}
            aria-label={replie ? "Déployer le menu" : "Réduire le menu"}
            className={cx(
              "hidden w-full items-center rounded-lg text-sm font-medium text-neutral transition-[background-color,transform] duration-150 ease-out-strong hover:bg-muted motion-safe:active:scale-[0.97] lg:flex",
              replie ? "justify-center p-2.5" : "gap-3 px-3 py-2",
            )}
          >
            <Icone
              nom="chevrons-gauche"
              className={cx("size-[18px] shrink-0 transition-transform duration-200 ease-out-strong motion-reduce:transition-none", replie && "rotate-180")}
            />
            {replie ? null : <span>Réduire</span>}
          </button>

          <form action={deconnexion}>
            <button
              type="submit"
              title={replie ? "Déconnexion" : undefined}
              className={cx(
                "flex w-full items-center rounded-lg text-sm font-medium text-danger transition-[background-color,transform] duration-150 ease-out-strong hover:bg-danger-bg motion-safe:active:scale-[0.97]",
                replie ? "justify-center p-2.5" : "gap-3 px-3 py-2 max-lg:py-2.5",
              )}
            >
              <Icone nom="deconnexion" className="size-[18px] shrink-0" />
              <span className={replie ? "sr-only" : undefined}>Déconnexion</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

/** Lien du menu. Replié : l'icône seule, le libellé reste lu par les lecteurs d'écran (`sr-only`) et visible au survol (`title`). */
function LienMenu({
  lien,
  actif,
  replie,
  imbrique = false,
  surNavigation,
}: {
  lien: LienNavigation;
  actif: boolean;
  replie: boolean;
  imbrique?: boolean;
  surNavigation: () => void;
}) {
  return (
    <Link
      href={lien.href}
      title={replie ? lien.libelle : undefined}
      aria-current={actif ? "page" : undefined}
      onClick={surNavigation}
      className={cx(
        "flex items-center rounded-lg text-sm font-medium transition-[background-color,color,transform] duration-150 ease-out-strong motion-safe:active:scale-[0.98]",
        replie ? "justify-center p-2.5" : cx("gap-3 py-2 max-lg:py-2.5", imbrique ? "pl-8 pr-3" : "px-3"),
        actif ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
      )}
    >
      <Icone nom={lien.icone} className="size-[18px] shrink-0" />
      <span className={replie ? "sr-only" : "truncate"}>{lien.libelle}</span>
    </Link>
  );
}
