"use client";

import { useId, useState, type ReactNode } from "react";

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
import { Bouton, Carte } from "@/composants/ui";

export type SectionsAnnexesCotationProps = {
  formules: { code: string; libelle: string }[];
  parGaranties: boolean;
  estBareme: boolean;
  initialAssures: LigneAssure[];
  initialBeneficiaires: LigneBeneficiaire[];
  initialContactsUrgence: LigneContactUrgence[];
  initialRisque: LigneRisque[];
};

/**
 * Volet repliable d'une rubrique facultative de la cotation. Le contenu reste MONTÉ quand le volet est replié (attribut `hidden`) :
 * replier ne perd aucune ligne saisie et ne change pas ce que le formulaire envoie. Ouvert d'emblée s'il contient déjà des lignes.
 */
function Volet({ titre, description, ouvertParDefaut, libelleOuvrir, children }: { titre: string; description?: ReactNode; ouvertParDefaut: boolean; libelleOuvrir: string; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const idContenu = useId();
  return (
    <Carte titre={titre} description={description}>
      <div className="mb-3 flex justify-end">
        <Bouton type="button" variante="secondaire" aria-expanded={ouvert} aria-controls={idContenu} onClick={() => setOuvert((v) => !v)}>
          {ouvert ? "Replier" : libelleOuvrir}
        </Bouton>
      </div>
      <div id={idContenu} hidden={!ouvert}>
        {children}
      </div>
      {ouvert ? null : <p className="text-sm text-muted-foreground">Rubrique repliée : ce qui y a été saisi est conservé et enregistré avec le brouillon.</p>}
    </Carte>
  );
}

export function SectionsAnnexesCotation({ formules, parGaranties, estBareme, initialAssures, initialBeneficiaires, initialContactsUrgence, initialRisque }: SectionsAnnexesCotationProps) {
  return (
    <div className="space-y-6">
      <Volet titre="Assurés (facultatif)" ouvertParDefaut={initialAssures.length > 0} libelleOuvrir="Renseigner les assurés">
        <LignesAssures
          // Par garanties (6.2b) ou au barème : pas de formule d'assuré ; la colonne n'est pas proposée.
          formules={parGaranties || estBareme ? [] : formules}
          initiales={initialAssures}
        />
      </Volet>

      <Volet
        titre="Bénéficiaires (SECURVIE, RELAXACCIDENT)"
        description="Facultatif à ce stade : ils peuvent aussi être saisis à l'acceptation. Dès qu'il y en a, la somme des quotes-parts doit faire 100 %."
        ouvertParDefaut={initialBeneficiaires.length > 0}
        libelleOuvrir="Ajouter des bénéficiaires"
      >
        <LignesBeneficiaires initiales={initialBeneficiaires} />
      </Volet>

      <Volet titre="Contacts d'urgence (RELAXVOYAGE)" ouvertParDefaut={initialContactsUrgence.length > 0} libelleOuvrir="Ajouter des contacts d'urgence">
        <LignesContactsUrgence initiales={initialContactsUrgence} />
      </Volet>

      <Volet titre="Risque (champs propres au produit)" ouvertParDefaut={initialRisque.length > 0} libelleOuvrir="Ajouter des champs de risque">
        <LignesRisque initiales={initialRisque} />
      </Volet>
    </div>
  );
}
