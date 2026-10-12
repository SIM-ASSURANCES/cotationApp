"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Ref } from "react";

import { titreDeLaPage, type Navigation } from "@/domaine/navigation";

import { Icone } from "../ui/icones";
import type { AlerteStockage } from "./Coquille";
import { MenuProfil } from "./MenuProfil";
import { ID_TIROIR } from "./tiroir";

/**
 * En-tête collant : la barre (bouton du tiroir mobile, titre de la page, menu du profil) et, dessous, l'alerte de stockage (T14).
 *
 * Le titre est un <p> : chaque page porte déjà son <h1>, la barre ne doit pas en ajouter un second. L'alerte est un bandeau sous la
 * barre et non une étiquette DANS les 64 px de la barre : son texte entier (nombre de documents, date) y passe à la ligne et ne
 * recouvre jamais le menu du profil, sur 320 px comme sur 1440 px. Une seule version du texte dans le DOM, lue en entier.
 */
export function BarreHaut({
  navigation,
  utilisateur,
  alerteStockage,
  deconnexion,
  boutonMenu,
  tiroirOuvert,
  surOuvrirMenu,
}: {
  navigation: Navigation;
  utilisateur: { nom: string; libelleProfil: string };
  alerteStockage: AlerteStockage | null;
  deconnexion: () => Promise<void>;
  /** Référence du bouton du tiroir : la coquille lui rend le focus à la fermeture. */
  boutonMenu: Ref<HTMLButtonElement>;
  tiroirOuvert: boolean;
  /** Ouvre le tiroir de navigation (bouton visible seulement en dessous de lg). */
  surOuvrirMenu: () => void;
}) {
  const chemin = usePathname();

  return (
    <header className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface">
      <div className="flex h-16 items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <button
          ref={boutonMenu}
          type="button"
          onClick={surOuvrirMenu}
          aria-label="Ouvrir le menu"
          aria-expanded={tiroirOuvert}
          aria-controls={ID_TIROIR}
          className="grid size-10 shrink-0 place-items-center rounded-lg text-neutral transition-[background-color,transform] duration-150 ease-out-strong hover:bg-muted motion-safe:active:scale-95 lg:hidden"
        >
          <Icone nom="menu" className="size-5" />
        </button>

        <p className="min-w-0 truncate text-base font-semibold text-foreground sm:text-lg">{titreDeLaPage(navigation, chemin)}</p>

        <div className="ml-auto shrink-0">
          <MenuProfil nom={utilisateur.nom} libelleProfil={utilisateur.libelleProfil} deconnexion={deconnexion} />
        </div>
      </div>

      {alerteStockage ? (
        <div role="alert" className="flex items-start gap-2 border-t border-warning-border bg-warning-bg px-4 py-2 text-sm font-medium leading-snug text-warning sm:px-6">
          <Icone nom="alerte" className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {alerteStockage.message}{" "}
            <Link href={alerteStockage.lien.href} className="inline-flex items-center gap-1 whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline">
              {alerteStockage.lien.libelle}
              <Icone nom="fleche-droite" className="size-3.5 shrink-0" />
            </Link>
          </p>
        </div>
      ) : null}
    </header>
  );
}
