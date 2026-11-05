"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Section d'un formulaire qui ne s'affiche que pour un mode de tarification donné (D63). Elle suit la liste déroulante nommée
 * `champ` du formulaire qui la contient (par défaut `modeTarification`) : changer le mode montre ou cache la section, sans rien
 * perdre. Cachée, la section reste dans le formulaire (`hidden`, pas de démontage) : sa saisie revient si l'on change d'avis, et ce
 * que le serveur reçoit est inchangé. Rendue côté serveur dans le bon état (`modeInitial`), donc sans clignotement ; un formulaire
 * remis à zéro retrouve sa valeur initiale.
 */
export function SectionSelonMode({ mode, modeInitial, champ = "modeTarification", children }: { mode: string; modeInitial: string; champ?: string; children: ReactNode }) {
  const racine = useRef<HTMLDivElement>(null);
  const [actuel, setActuel] = useState(modeInitial);

  useEffect(() => {
    const formulaire = racine.current?.closest("form");
    if (!formulaire) return;
    const lire = () => {
      const liste = formulaire.elements.namedItem(champ);
      if (liste instanceof HTMLSelectElement) setActuel(liste.value);
    };
    const surChangement = (e: Event) => {
      if ((e.target as HTMLSelectElement | null)?.name === champ) lire();
    };
    // « reset » part AVANT la remise à zéro des champs : on relit une fois celle-ci faite.
    const surRemiseAZero = () => setTimeout(lire, 0);
    formulaire.addEventListener("change", surChangement);
    formulaire.addEventListener("reset", surRemiseAZero);
    lire();
    return () => {
      formulaire.removeEventListener("change", surChangement);
      formulaire.removeEventListener("reset", surRemiseAZero);
    };
  }, [champ]);

  return (
    <div ref={racine} hidden={actuel !== mode} data-section-mode={mode}>
      {children}
    </div>
  );
}
