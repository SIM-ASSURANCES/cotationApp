"use client";

import { useId, useState } from "react";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import type { ActionFormulaire } from "@/composants/types";
import { Bandeau, ChampFormulaire, classesControle, ListeDeroulante } from "@/composants/ui";
import { LISTES_ANNEXE, REGLES, TYPES_MODELE, type TypeModele } from "@/domaine/documents/modeles";

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

/** Les types se rangent d'après les règles du domaine (`REGLES`), jamais d'après une liste écrite ici. */
const GROUPES: { libelle: string; contient: (t: TypeModele) => boolean }[] = [
  { libelle: "Propres à un produit", contient: (t) => REGLES[t].produit === "obligatoire" },
  { libelle: "Conditions générales et spéciales", contient: (t) => REGLES[t].fixe },
  { libelle: "Documents communs, annexes et sous-modèles", contient: (t) => REGLES[t].produit === "facultatif" },
];

/**
 * Création d'un modèle : seuls les champs du type choisi sont affichés. Les noms des champs envoyés sont ceux de l'action
 * `creerUnModele` (type, code, libelle, produitCode, niveauRelance, listeAnnexe, blocNom, blocCle) ; un champ qui ne concerne pas
 * le type n'est pas dans le formulaire, donc absent de l'envoi (l'action lit alors « null », comme `problemesSaisieModele` l'exige).
 */
export function FormulaireCreationModele({ action, produits, branches }: { action: ActionFormulaire; produits: ProduitPourModele[]; branches: BranchePourModele[] }) {
  const [typeChoisi, setTypeChoisi] = useState<TypeModele | "">("");
  const [brancheFiltre, setBrancheFiltre] = useState("");
  const idType = useId();

  const regle = typeChoisi ? REGLES[typeChoisi] : null;
  const produitObligatoire = regle?.produit === "obligatoire";
  const sansProduit = regle?.produit === "aucun";
  const produitsFiltres = brancheFiltre ? produits.filter((p) => p.branchePrincipale === brancheFiltre) : produits;

  return (
    <FormulaireAction action={action} libelleBouton="Créer, puis déposer le fichier">
      <div className="mb-4">
        <ChampFormulaire label="Type" requis htmlFor={idType}>
          <select
            id={idType}
            name="type"
            required
            value={typeChoisi}
            onChange={(e) => setTypeChoisi(e.target.value as TypeModele | "")}
            className={classesControle(false)}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {GROUPES.map((g) => (
              <optgroup key={g.libelle} label={g.libelle}>
                {TYPES_MODELE.filter(g.contient).map((t) => (
                  <option key={t} value={t}>
                    {REGLES[t].libelle}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </ChampFormulaire>
      </div>

      {regle ? (
        <Bandeau ton="info" className="mb-4">
          <p className="font-semibold">{regle.libelle}</p>
          <p className="text-sm">
            {produitObligatoire
              ? "Document fusionné avec les données du dossier ; il est propre à un produit : le rattachement est obligatoire."
              : sansProduit
                ? "Document fixe, sans balises dynamiques hors visa ; aucun produit (les produits y renvoient par leur visa)."
                : "Le rattachement à un produit est facultatif : sans produit, le modèle est commun à tous."}
          </p>
        </Bandeau>
      ) : null}

      <Champ nom="code" libelle="Code (ex. CP_RELAXSANTE)" autoComplete="off" />
      <Champ nom="libelle" libelle="Libellé (pour les CG : celui cité dans les CP, ex. SECUR DOMMAGE)" autoComplete="off" />

      {sansProduit ? (
        <input type="hidden" name="produitCode" value="" />
      ) : (
        <div className="mb-4 space-y-3">
          {branches.length > 0 ? (
            <ListeDeroulante
              label="Filtrer les produits par branche"
              value={brancheFiltre}
              onChange={(e) => setBrancheFiltre(e.target.value)}
              options={[{ valeur: "", libelle: "Toutes les branches" }, ...branches.map((b) => ({ valeur: b.code, libelle: b.libelle }))]}
            />
          ) : null}
          <ListeDeroulante
            // Le filtre change la liste : on repart d'un choix vide plutôt que de garder un produit qui n'y figure plus.
            key={`${brancheFiltre}|${produitObligatoire}`}
            label={produitObligatoire ? "Produit (obligatoire)" : "Produit (facultatif)"}
            name="produitCode"
            required={produitObligatoire}
            defaultValue=""
            invite={produitObligatoire ? "Choisir…" : undefined}
            options={[
              ...(produitObligatoire ? [] : [{ valeur: "", libelle: "Commun à tous les produits" }]),
              ...produitsFiltres.map((p) => ({ valeur: p.code, libelle: `${p.code} — ${p.libelle}${p.branchePrincipaleLibelle ? ` (${p.branchePrincipaleLibelle})` : ""}` })),
            ]}
          />
        </div>
      )}

      {typeChoisi === "RELANCE" ? <Champ nom="niveauRelance" libelle="Relance : niveau (1, 2, 3…)" valeur="1" autoComplete="off" /> : null}

      {typeChoisi === "ANNEXE" ? (
        <div className="mb-4">
          <ListeDeroulante
            label="Annexe : liste reprise en entier"
            name="listeAnnexe"
            required
            defaultValue=""
            invite="Choisir…"
            options={LISTES_ANNEXE.map((l) => ({ valeur: l, libelle: l }))}
          />
        </div>
      ) : null}

      {typeChoisi === "SOUS_MODELE" ? (
        <>
          <Champ nom="blocNom" libelle={'Sous-modèle : nom du bloc, tel qu\'écrit dans bloc("garanties", …)'} autoComplete="off" />
          <Champ nom="blocCle" libelle="Sous-modèle : clé (code de la formule : SOLO, 80… ; ou code de la garantie : vol)" autoComplete="off" />
        </>
      ) : null}
    </FormulaireAction>
  );
}
