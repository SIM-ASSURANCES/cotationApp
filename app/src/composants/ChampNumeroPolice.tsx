"use client";

import { useState, type ReactNode } from "react";

import { Bandeau, Champ } from "@/composants/ui";
import { avertissementNumeroContrat } from "@/domaine/cotation/police";

/**
 * Numéro de police saisi à l'acceptation : avertit en direct, sans bloquer, s'il ne se termine pas par 00000 après G
 * ou I (session 6.0, D27). Les 5 derniers chiffres sont réservés aux certificats des adhérents.
 * `children` : aide affichée sous le champ (format attendu).
 */
export function ChampNumeroPolice({ label, children }: { label: string; children?: ReactNode }) {
  const [numero, setNumero] = useState("");
  const avertissement = avertissementNumeroContrat(numero);
  return (
    <div className="space-y-2">
      <Champ label={label} name="numeroPolice" required autoComplete="off" placeholder="SCD-2026-000088-G00000" value={numero} onChange={(e) => setNumero(e.target.value)} />
      {children}
      {avertissement ? (
        <Bandeau ton="avertissement" role="status">
          {avertissement}
        </Bandeau>
      ) : null}
    </div>
  );
}
