import Image from "next/image";
import type { ReactNode } from "react";

import { FondDeMarque } from "../ui/FondDeMarque";

/**
 * Coquille des écrans HORS application : connexion, accès refusé, changement de mot de passe obligatoire, page publique de
 * vérification d'un QR code. Fond blanc, filigrane du pictogramme, carte blanche centrée avec le logo COULEUR en haut à gauche
 * (fond blanc : logo couleur ; sur fond bleu : logo blanc, voir CLAUDE.md « Design system »).
 *
 * Purement présentationnelle : aucune logique, aucune donnée. Chaque page garde son comportement (formulaire, erreurs,
 * redirections). `pied` : contenu sous la carte (par exemple le bouton de déconnexion de l'écran de changement de mot de passe).
 */
export function CoquilleConnexion({ children, pied, largeur = "md" }: { children: ReactNode; pied?: ReactNode; largeur?: "md" | "lg" }) {
  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-app-bg px-4 py-10 sm:py-14">
      <FondDeMarque className="absolute inset-0 h-full w-full" classeOpacite="opacity-[0.05]" />
      <div className="relative flex w-full flex-col items-center gap-4">
        <div
          className={`animate-fade-in-up flex w-full flex-col justify-center gap-6 overflow-hidden rounded-3xl border border-border bg-surface px-6 py-10 shadow-elevated-lg sm:px-10 sm:py-12 ${
            largeur === "lg" ? "max-w-xl" : "max-w-md"
          }`}
        >
          {/* Zone de protection du logo : le padding de la carte la garantit (aucun élément ne touche ses bords). */}
          <Image src="/logo-sim-couleur.svg" alt="SIM Assurances" width={176} height={26} priority />
          {children}
        </div>
        {pied ? <footer className={`w-full ${largeur === "lg" ? "max-w-xl" : "max-w-md"}`}>{pied}</footer> : null}
      </div>
    </div>
  );
}
