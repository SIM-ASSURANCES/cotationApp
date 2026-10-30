"use client";

import { Bandeau } from "@/composants/ui";
import type { Probleme } from "@/domaine/bareme";

/**
 * Contrôles en continu : les problèmes de `verifierBareme` (avec l'exigence de publication), mêmes codes et mêmes messages qu'à l'import.
 * Rouge = bloque la publication ; le brouillon s'enregistre quand même (le schéma seul est exigé). Un problème de structure (schéma)
 * empêche aussi l'enregistrement.
 */
export function PanneauControles({ problemes, structure }: { problemes: Probleme[]; structure: Probleme[] }) {
  const tous = [...structure, ...problemes];
  if (tous.length === 0) {
    return (
      <section aria-label="Contrôles du barème" role="status">
        <Bandeau ton="succes" titre="Aucun problème">
          Le barème passe tous les contrôles : il peut être publié (après rejeu des essais).
        </Bandeau>
      </section>
    );
  }
  return (
    <section aria-label="Contrôles du barème" aria-live="polite" className="space-y-2">
      <Bandeau ton="danger" titre={`${tous.length} problème${tous.length > 1 ? "s" : ""} : la publication est bloquée`}>
        {structure.length > 0 ? <p className="font-medium">Le document est mal formé : il ne peut pas être enregistré avant correction.</p> : null}
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {tous.map((p, i) => (
            <li key={i}>
              <span className="font-mono text-xs">[{p.code}]</span> {p.message}
            </li>
          ))}
        </ul>
      </Bandeau>
    </section>
  );
}
