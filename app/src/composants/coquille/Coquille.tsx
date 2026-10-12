"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { Navigation } from "@/domaine/navigation";

import { FondDeMarque } from "../ui/FondDeMarque";
import { BarreHaut } from "./BarreHaut";
import { BarreLaterale } from "./BarreLaterale";

/** Alerte de l'en-tête (T14 : écritures de stockage en attente). Le texte est composé par le layout, côté serveur. */
export type AlerteStockage = {
  message: string;
  lien: { href: string; libelle: string };
};

/** Point de rupture `lg` de Tailwind : en dessous, la barre latérale est un tiroir ; au-dessus, elle est dans la page et peut se replier. */
const REQUETE_BUREAU = "(min-width: 1024px)";

function suivreBureau(rappel: () => void) {
  const requete = window.matchMedia(REQUETE_BUREAU);
  requete.addEventListener("change", rappel);
  return () => requete.removeEventListener("change", rappel);
}
const lireBureau = () => window.matchMedia(REQUETE_BUREAU).matches;
const bureauCoteServeur = () => false;

/** Préférence « barre latérale repliée » ("1" = repliée), mémorisée dans le navigateur de chaque utilisateur. */
const CLE_BARRE_REPLIEE = "sim-documents-barre-repliee";

/**
 * Coquille des écrans authentifiés : cadre bleu, barre latérale, barre du haut et zone de contenu. Elle détient l'état « repliée »
 * de la barre latérale et l'état du tiroir mobile ; le layout (serveur) ne lui passe que des données sérialisables et la Server
 * Action de déconnexion.
 *
 * La zone de contenu n'est PAS un <main> : chaque page rend déjà le sien.
 */
export function Coquille({
  utilisateur,
  navigation,
  alerteStockage,
  deconnexion,
  children,
}: {
  utilisateur: { nom: string; libelleProfil: string };
  navigation: Navigation;
  alerteStockage: AlerteStockage | null;
  /** Server Action de déconnexion (passée par le layout : composants/ n'importe pas serveur/). */
  deconnexion: () => Promise<void>;
  children: ReactNode;
}) {
  // Le rendu initial (serveur et première passe du client) est toujours « déployé » : aucun écart d'hydratation. La préférence
  // mémorisée est relue juste après le montage.
  const [repliee, setRepliee] = useState(false);
  // Tiroir mobile (< lg) : fermé au départ, ouvert par le bouton de la barre du haut. Sans effet à partir de lg.
  const [tiroirOuvert, setTiroirOuvert] = useState(false);
  const grandEcran = useSyncExternalStore(suivreBureau, lireBureau, bureauCoteServeur);
  // Fenêtre élargie tiroir ouvert : la barre est alors dans la page, le tiroir n'a plus lieu d'être (ajustement d'état pendant le
  // rendu, comme le recommande React).
  if (grandEcran && tiroirOuvert) setTiroirOuvert(false);
  // Identité stable : la barre latérale s'en sert comme dépendance de l'écoute de la touche Échap.
  const fermerTiroir = useCallback(() => setTiroirOuvert(false), []);

  // Focus : à la fermeture du tiroir, on le rend au bouton qui l'a ouvert (sinon il tombe sur <body>). À l'ouverture, c'est la
  // barre latérale qui prend le focus (bouton « Fermer le menu »).
  const boutonMenu = useRef<HTMLButtonElement>(null);
  const etaitOuvert = useRef(false);
  useEffect(() => {
    if (tiroirOuvert) {
      etaitOuvert.current = true;
    } else if (etaitOuvert.current) {
      etaitOuvert.current = false;
      boutonMenu.current?.focus();
    }
  }, [tiroirOuvert]);

  // Tiroir ouvert : la page derrière ne défile pas.
  useEffect(() => {
    if (!tiroirOuvert) return;
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = avant;
    };
  }, [tiroirOuvert]);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique d'une préférence d'affichage au montage (deux passes, sûre pour l'hydratation)
      if (localStorage.getItem(CLE_BARRE_REPLIEE) === "1") setRepliee(true);
    } catch {
      // Stockage du navigateur indisponible (navigation privée, données bloquées) : la barre reste déployée.
    }
  }, []);

  function basculerRepli() {
    const suivante = !repliee;
    setRepliee(suivante);
    try {
      localStorage.setItem(CLE_BARRE_REPLIEE, suivante ? "1" : "0");
    } catch {
      // Préférence non mémorisée : sans conséquence, elle vaut pour cette page seulement.
    }
  }

  return (
    // relative z-0 : crée le contexte d'empilement qui contient le filigrane. Sans lui, le filigrane (fixed, -z-10) s'échappe à la
    // racine du document et passe SOUS le fond de ce conteneur : il disparaît.
    <div className="relative z-0 flex min-h-screen border-[3px] border-primary bg-app-bg">
      {/* Lien d'évitement : visible au premier Tab, il saute la barre latérale et la barre du haut. */}
      <a
        href="#contenu"
        inert={tiroirOuvert}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:outline-offset-2 focus:outline-primary"
      >
        Aller au contenu
      </a>
      <FondDeMarque className="fixed inset-0 -z-10" classeOpacite="opacity-[0.05]" position="coin-bas-droit" />
      <BarreLaterale
        navigation={navigation}
        repliee={repliee}
        grandEcran={grandEcran}
        surBasculerRepli={basculerRepli}
        tiroirOuvert={tiroirOuvert}
        surFermerTiroir={fermerTiroir}
        deconnexion={deconnexion}
      />
      {/* Tiroir ouvert : tout le reste est inerte (ni focus, ni lecteur d'écran) ; le voile ne suffirait qu'à la souris. */}
      <div className="flex min-w-0 flex-1 flex-col" inert={tiroirOuvert}>
        <BarreHaut
          navigation={navigation}
          utilisateur={utilisateur}
          alerteStockage={alerteStockage}
          deconnexion={deconnexion}
          boutonMenu={boutonMenu}
          tiroirOuvert={tiroirOuvert}
          surOuvrirMenu={() => setTiroirOuvert(true)}
        />
        <div className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div id="contenu" tabIndex={-1} className="mx-auto w-full max-w-7xl outline-none">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
