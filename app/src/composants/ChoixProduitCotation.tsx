"use client";

import { useState, type FormEvent } from "react";

import { Bouton, ListeDeroulante } from "@/composants/ui";
import { branchesDesProduits, produitsDeLaBranche, type ProduitProposable } from "@/domaine/cotation/choix-produit";

/**
 * Début d'une nouvelle cotation (D63) : on choisit d'abord la branche principale, puis un produit de cette branche (liste filtrée).
 * Le formulaire envoie `produit` en GET vers la même page, comme le lien de l'ancienne liste : mêmes droits, même suite. Seule la
 * liste des produits change de forme ; la branche n'est pas envoyée (elle ne sert qu'à filtrer).
 */
export function ChoixProduitCotation({ produits }: { produits: ProduitProposable[] }) {
  const branches = branchesDesProduits(produits);
  // Une seule branche : elle est choisie d'office (rien à départager), on passe directement au produit.
  const [branche, setBranche] = useState(branches.length === 1 ? branches[0].code : "");
  const [produit, setProduit] = useState("");
  const proposes = produitsDeLaBranche(produits, branche);

  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    if (produit === "") e.preventDefault();
  };

  return (
    <form method="get" action="/cotations/nouvelle" onSubmit={envoyer} className="max-w-md space-y-4">
      <ListeDeroulante
        label="Branche principale"
        required
        value={branche}
        invite="Choisir une branche"
        options={branches.map((b) => ({ valeur: b.code, libelle: `${b.libelle} (${b.produits})` }))}
        onChange={(e) => {
          setBranche(e.target.value);
          setProduit(""); // un produit d'une autre branche ne reste jamais choisi
        }}
      />
      <ListeDeroulante
        label="Produit"
        name="produit"
        required
        value={produit}
        disabled={branche === ""}
        invite={branche === "" ? "Choisissez d'abord la branche" : "Choisir un produit"}
        options={proposes.map((p) => ({ valeur: p.code, libelle: `${p.code} — ${p.libelle}` }))}
        onChange={(e) => setProduit(e.target.value)}
      />
      <Bouton type="submit" disabled={produit === ""}>
        Continuer
      </Bouton>
    </form>
  );
}
