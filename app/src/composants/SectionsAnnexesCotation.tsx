"use client";

import { useState } from "react";

import {
  LignesAssures,
  LignesBeneficiaires,
  LignesContactsUrgence,
  LignesRisque,
  type LigneAssure,
  type LigneBeneficiaire,
  type LigneContactUrgence,
  type LigneRisque,
} from "@/composants/LignesDynamiques";
import { Carte } from "@/composants/ui";

export type SectionsAnnexesCotationProps = {
  formules: { code: string; libelle: string }[];
  parGaranties: boolean;
  estBareme: boolean;
  initialAssures: LigneAssure[];
  initialBeneficiaires: LigneBeneficiaire[];
  initialContactsUrgence: LigneContactUrgence[];
  initialRisque: LigneRisque[];
  codeProduit?: string;
};

export function SectionsAnnexesCotation({
  formules,
  parGaranties,
  estBareme,
  initialAssures,
  initialBeneficiaires,
  initialContactsUrgence,
  initialRisque,
  codeProduit = "",
}: SectionsAnnexesCotationProps) {
  // Détection des prédispositions produit (ex. Prévoyance/Vie -> Bénéficiaires, Voyage -> Contacts d'urgence)
  const codeMaj = codeProduit.toUpperCase();
  const suggereBeneficiaires = codeMaj.includes("VIE") || codeMaj.includes("DECES") || codeMaj.includes("ACCIDENT");
  const suggereUrgence = codeMaj.includes("VOYAGE") || codeMaj.includes("ASSISTANCE");

  const [assuresActifs, setAssuresActifs] = useState(initialAssures.length > 0);
  const [beneficiairesActifs, setBeneficiairesActifs] = useState(
    initialBeneficiaires.length > 0 || suggereBeneficiaires,
  );
  const [urgenceActifs, setUrgenceActifs] = useState(
    initialContactsUrgence.length > 0 || suggereUrgence,
  );
  const [risqueActif, setRisqueActif] = useState(initialRisque.length > 0);

  return (
    <div className="space-y-6">
      {/* 1. Section Assurés */}
      <Carte titre="Assurés (facultatif)">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border mb-3">
          <p className="text-xs text-muted-foreground">
            Personnes assurées couvertes par ce contrat d&apos;assurance.
          </p>
          <button
            type="button"
            onClick={() => setAssuresActifs((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {assuresActifs ? "Replier la section ▲" : "+ Afficher / renseigner les assurés ▼"}
          </button>
        </div>
        {assuresActifs ? (
          <LignesAssures
            formules={parGaranties || estBareme ? [] : formules}
            initiales={initialAssures}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Section repliée. Cliquez sur le bouton ci-dessus pour ajouter des assurés.
          </p>
        )}
      </Carte>

      {/* 2. Section Bénéficiaires */}
      <Carte
        titre="Bénéficiaires (facultatif)"
        description="Désignation des bénéficiaires en cas de sinistre ou décès. La somme des quotes-parts doit totaliser 100 %."
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border mb-3">
          <p className="text-xs text-muted-foreground">
            Facultatif à ce stade : ils peuvent être saisis ou complétés à l&apos;acceptation.
          </p>
          <button
            type="button"
            onClick={() => setBeneficiairesActifs((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {beneficiairesActifs ? "Replier la section ▲" : "+ Ajouter des bénéficiaires ▼"}
          </button>
        </div>
        {beneficiairesActifs ? (
          <LignesBeneficiaires initiales={initialBeneficiaires} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Section repliée. Cliquez sur le bouton ci-dessus pour désigner des bénéficiaires.
          </p>
        )}
      </Carte>

      {/* 3. Section Contacts d'urgence */}
      <Carte
        titre="Contacts d'urgence (facultatif)"
        description="Personnes à contacter en priorité en cas d'accident ou d'urgence médicale."
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border mb-3">
          <p className="text-xs text-muted-foreground">
            Recommandé pour les contrats d&apos;assistance ou voyage.
          </p>
          <button
            type="button"
            onClick={() => setUrgenceActifs((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {urgenceActifs ? "Replier la section ▲" : "+ Ajouter des contacts d'urgence ▼"}
          </button>
        </div>
        {urgenceActifs ? (
          <LignesContactsUrgence initiales={initialContactsUrgence} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Section repliée. Cliquez sur le bouton ci-dessus pour renseigner les contacts d&apos;urgence.
          </p>
        )}
      </Carte>

      {/* 4. Section Risque (uniquement hors mode barème où les paramètres de risque sont intégrés au barème) */}
      {!estBareme ? (
        <Carte
          titre="Paramètres de risque personnalisés"
          description="Champs libres propres au produit (ex. immatriculation, destination, type d'activité)."
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border mb-3">
            <p className="text-xs text-muted-foreground">
              Paramètres spécifiques hors barème.
            </p>
            <button
              type="button"
              onClick={() => setRisqueActif((v) => !v)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {risqueActif ? "Replier la section ▲" : "+ Ajouter des champs de risque ▼"}
            </button>
          </div>
          {risqueActif ? (
            <LignesRisque initiales={initialRisque} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Section repliée. Aucun champ de risque personnalisé requis par défaut pour cette formule.
            </p>
          )}
        </Carte>
      ) : null}
    </div>
  );
}
