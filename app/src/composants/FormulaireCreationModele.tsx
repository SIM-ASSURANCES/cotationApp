"use client";

import { useId, useState } from "react";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Bandeau, ChampFormulaire, classesControle, ListeDeroulante } from "@/composants/ui";
import { LISTES_ANNEXE, REGLES, type TypeModele } from "@/domaine/documents/modeles";
import type { ActionFormulaire } from "@/composants/types";

export type ProduitPourModele = {
  code: string;
  libelle: string;
  branchePrincipale: string | null;
  branchePrincipaleLibelle: string | null;
};

export type BranchePourModele = {
  code: string;
  libelle: string;
};

export function FormulaireCreationModele({
  action,
  produits,
  branches,
}: {
  action: ActionFormulaire;
  produits: ProduitPourModele[];
  branches: BranchePourModele[];
}) {
  const [typeChoisi, setTypeChoisi] = useState<TypeModele | "">("");
  const [brancheFiltre, setBrancheFiltre] = useState<string>("");
  const idType = useId();

  // Filtrage des produits si une branche est sélectionnée
  const produitsFiltres = brancheFiltre
    ? produits.filter((p) => p.branchePrincipale === brancheFiltre)
    : produits;

  const regle = typeChoisi ? REGLES[typeChoisi] : null;

  // Catégorisation du type sélectionné
  const estTransversal = Boolean(typeChoisi && ["FACTURE", "AVOIR", "RECU", "AVIS_ECHEANCE"].includes(typeChoisi));
  const estContrat = Boolean(typeChoisi && ["CP", "COTATION", "CERTIFICAT"].includes(typeChoisi));
  const estFixe = Boolean(typeChoisi && ["CG", "CS"].includes(typeChoisi));
  const estRelance = typeChoisi === "RELANCE";
  const estAnnexe = typeChoisi === "ANNEXE";
  const estSousModele = typeChoisi === "SOUS_MODELE";

  return (
    <FormulaireAction action={action} libelleBouton="Créer, puis déposer le fichier">
      {/* 1. Choix du type de modèle */}
      <div className="mb-4">
        <ChampFormulaire label="Type de modèle" requis htmlFor={idType}>
          <select
            id={idType}
            name="type"
            required
            value={typeChoisi}
            onChange={(e) => setTypeChoisi(e.target.value as TypeModele)}
            className={classesControle(!typeChoisi)}
          >
            <option value="" disabled>
              — Choisir le type de modèle à créer —
            </option>
            <optgroup label="Documents contractuels (spécifiques par produit)">
              <option value="CP">Conditions particulières (CP)</option>
              <option value="COTATION">Cotation / Devis</option>
              <option value="CERTIFICAT">Certificat d&apos;adhésion</option>
            </optgroup>
            <optgroup label="Documents transversaux (communs à tous les produits)">
              <option value="FACTURE">Facture</option>
              <option value="AVOIR">Avoir</option>
              <option value="RECU">Reçu de paiement / Quittance</option>
              <option value="AVIS_ECHEANCE">Avis d&apos;échéance</option>
              <option value="RELANCE">Relance</option>
            </optgroup>
            <optgroup label="Conditions Générales & Spéciales">
              <option value="CG">Conditions générales (CG)</option>
              <option value="CS">Conventions spéciales (CS)</option>
            </optgroup>
            <optgroup label="Composants et annexes de modèles">
              <option value="ANNEXE">Annexe (listes longues)</option>
              <option value="SOUS_MODELE">Sous-modèle (bloc dynamique)</option>
            </optgroup>
          </select>
        </ChampFormulaire>
      </div>

      {/* Aide contextuelle selon le type choisi */}
      {estTransversal ? (
        <Bandeau ton="info" className="mb-4">
          <p className="font-semibold">{regle?.libelle}</p>
          <p className="text-xs">
            Ce document est <strong>transversal et commun</strong> à tous les produits d&apos;assurance. Il n&apos;est rattaché à aucun produit spécifique.
          </p>
        </Bandeau>
      ) : null}

      {estContrat ? (
        <Bandeau ton="info" className="mb-4">
          <p className="font-semibold">{regle?.libelle}</p>
          <p className="text-xs">
            Document contractuel fusionné avec les données du dossier. Le <strong>rattachement à un produit d&apos;assurance est obligatoire</strong>.
          </p>
        </Bandeau>
      ) : null}

      {estFixe ? (
        <Bandeau ton="info" className="mb-4">
          <p className="font-semibold">{regle?.libelle}</p>
          <p className="text-xs">
            Document contractuel fixe (non fusionné, sans balises dynamiques hors visa). Il s&apos;applique à l&apos;échelle d&apos;une branche d&apos;assurance ou de la société.
          </p>
        </Bandeau>
      ) : null}

      {estRelance ? (
        <Bandeau ton="info" className="mb-4">
          <p className="font-semibold">Modèle de Relance</p>
          <p className="text-xs">
            Précisez le niveau de relance (1, 2, 3...) pour lequel ce modèle sera automatiquement utilisé lors des avis d&apos;impayés.
          </p>
        </Bandeau>
      ) : null}

      {/* 2. Champs de base : Code et Libellé */}
      <Champ
        nom="code"
        libelle={`Code du modèle (ex. ${estTransversal ? "FACTURE_SIM" : estFixe ? "SECUR_DOMMAGE" : "CP_RELAXSANTE"})`}
        autoComplete="off"
      />
      <Champ
        nom="libelle"
        libelle={`Libellé complet${estFixe ? " (celui cité dans les CP, ex. SECUR DOMMAGE)" : ""}`}
        autoComplete="off"
      />

      {/* 3. Sélecteur de Produit : Affiché UNIQUEMENT si pertinent (contrats, annexes, sous-modèles) */}
      {estContrat || estAnnexe || estSousModele ? (
        <div className="mb-4 space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-semibold text-foreground">Rattachement au produit d&apos;assurance</p>
          
          {branches.length > 0 ? (
            <div className="mb-2">
              <ListeDeroulante
                label="Filtrer les produits par branche"
                value={brancheFiltre}
                onChange={(e) => setBrancheFiltre(e.target.value)}
                options={[
                  { valeur: "", libelle: "— Toutes les branches —" },
                  ...branches.map((b) => ({ valeur: b.code, libelle: b.libelle })),
                ]}
              />
            </div>
          ) : null}

          <ListeDeroulante
            label={`Produit d'assurance${estContrat ? " *" : " (facultatif si modèle commun)"}`}
            name="produitCode"
            required={estContrat}
            options={[
              ...(!estContrat ? [{ valeur: "", libelle: "— Modèle commun à tous les produits —" }] : []),
              ...produitsFiltres.map((p) => ({
                valeur: p.code,
                libelle: `${p.code} — ${p.libelle}${p.branchePrincipaleLibelle ? ` (${p.branchePrincipaleLibelle})` : ""}`,
              })),
            ]}
          />
        </div>
      ) : (
        <input type="hidden" name="produitCode" value="" />
      )}

      {/* 4. Champs conditionnels pour RELANCE */}
      {estRelance ? (
        <div className="mb-4 rounded-lg border border-border p-3">
          <Champ
            nom="niveauRelance"
            libelle="Niveau de relance (1, 2, 3…)"
            valeur="1"
            autoComplete="off"
          />
        </div>
      ) : null}

      {/* 5. Champs conditionnels pour ANNEXE */}
      {estAnnexe ? (
        <div className="mb-4 rounded-lg border border-border p-3">
          <ListeDeroulante
            label="Liste reprise en entier dans l'annexe"
            name="listeAnnexe"
            required
            options={LISTES_ANNEXE.map((l) => ({ valeur: l, libelle: l }))}
          />
        </div>
      ) : null}

      {/* 6. Champs conditionnels pour SOUS_MODELE */}
      {estSousModele ? (
        <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
          <Champ
            nom="blocNom"
            libelle={'Nom du bloc, tel qu\'écrit dans bloc("garanties", …)'}
            autoComplete="off"
          />
          <Champ
            nom="blocCle"
            libelle="Clé du bloc (ex. code de formule : SOLO, 80…)"
            autoComplete="off"
          />
        </div>
      ) : null}
    </FormulaireAction>
  );
}

