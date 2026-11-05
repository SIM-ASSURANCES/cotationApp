"use client";

import { useEffect, useRef, useState } from "react";

import { Champ } from "@/composants/ui";
import { dateValide, echeanceUnAn, formaterDate, normaliserDateSaisie } from "@/domaine/calcul/dates";

/**
 * Date d'échéance d'une version à durée imposée (D64) : affichée, jamais saisie. Elle suit la date d'effet du même formulaire
 * (effet + 1 an − 1 jour) ; un champ caché `dateEcheance` la transmet, ce qui garde intacts le calcul automatique et l'enregistrement.
 * Le serveur recalcule de toute façon l'échéance : cette valeur ne sert qu'à l'affichage et au déclenchement du calcul.
 */
export function EcheanceImposee({ dateEffetInitiale }: { dateEffetInitiale?: string }) {
  const cache = useRef<HTMLInputElement>(null);
  const calculer = (effet: string): string => {
    const iso = normaliserDateSaisie(effet);
    return dateValide(iso) ? echeanceUnAn(iso) : "";
  };
  const [echeance, setEcheance] = useState(() => calculer(dateEffetInitiale ?? ""));

  useEffect(() => {
    const formulaire = cache.current?.form;
    const champEffet = formulaire?.elements.namedItem("dateEffet");
    if (!(champEffet instanceof HTMLInputElement)) return;
    const suivre = () => setEcheance(calculer(champEffet.value));
    suivre();
    champEffet.addEventListener("input", suivre);
    champEffet.addEventListener("change", suivre);
    return () => {
      champEffet.removeEventListener("input", suivre);
      champEffet.removeEventListener("change", suivre);
    };
  }, []);

  // Le champ caché change après le rendu : on prévient le formulaire pour que le calcul automatique relise l'échéance.
  const precedente = useRef(echeance);
  useEffect(() => {
    if (precedente.current === echeance) return;
    precedente.current = echeance;
    cache.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [echeance]);

  return (
    <div className="mb-4">
      <input ref={cache} type="hidden" name="dateEcheance" value={echeance} readOnly />
      <Champ label="Date d'échéance (imposée : effet + 1 an − 1 jour)" value={echeance ? formaterDate(echeance) : "—"} readOnly aria-readonly="true" aide="La durée du contrat est imposée à 1 an par ce produit, sans prorata." />
    </div>
  );
}
