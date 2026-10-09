"use client";

import { useState } from "react";

import { avertissementNumeroContrat } from "@/domaine/cotation/police";

/**
 * Numéro de police saisi à l'acceptation : avertit en direct, sans bloquer, s'il ne se termine pas par 00000 après G
 * ou I (session 6.0, D27). Les 5 derniers chiffres sont réservés aux certificats des adhérents.
 */
export function ChampNumeroPolice({ className }: { className: string }) {
  const [numero, setNumero] = useState("");
  const avertissement = avertissementNumeroContrat(numero);
  return (
    <>
      <input name="numeroPolice" required className={className} autoComplete="off" placeholder="SCD-2026-000088-G00000" value={numero} onChange={(e) => setNumero(e.target.value)} />
      {avertissement ? (
        <span role="status" className="mt-1 block text-xs font-normal text-amber-800">
          {avertissement}
        </span>
      ) : null}
    </>
  );
}
