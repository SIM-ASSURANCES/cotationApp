import { ChoixProduitCotation } from "@/composants/ChoixProduitCotation";
import { Bandeau, EnTetePage } from "@/composants/ui";
import { compositionPossible, enVigueur } from "@/domaine/calcul/parametrage";
import { peutAgir } from "@/domaine/droits";
import { listerClients } from "@/serveur/clients";
import { lireDescripteurBareme } from "@/serveur/cotations";
import { listerIntermediaires, peutCreerIntermediaire } from "@/serveur/intermediaires";
import { aujourdhui, listerProduits, listerVersions } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { FormulaireCotation } from "../formulaire-cotation";

export default async function PageNouvelleCotation(props: PageProps<"/cotations/nouvelle">) {
  const utilisateur = await exigerDroit("CREER_COTATION", peutAgir);
  const q = await props.searchParams;
  const code = typeof q.produit === "string" ? q.produit : "";

  if (!code) {
    const produits = (await listerProduits(utilisateur)).filter((p) => p.actif && p.versions.length > 0);
    return (
      <main className="space-y-6">
        <EnTetePage titre="Nouvelle cotation" sousTitre="Choisissez la branche principale, puis le produit." filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: "Nouvelle cotation" }]} />
        {produits.length === 0 ? (
          <Bandeau ton="neutre">Aucun produit paramétré : un profil Technique doit d'abord en créer un.</Bandeau>
        ) : (
          <ChoixProduitCotation produits={produits.map((p) => ({ code: p.code, libelle: p.libelle, branchePrincipale: p.branchePrincipale, branchePrincipaleLibelle: p.branchePrincipaleLibelle }))} />
        )}
      </main>
    );
  }

  const donnees = await listerVersions(utilisateur, code);
  const version = donnees ? enVigueur(donnees.versions, aujourdhui()) : null;
  if (!donnees || !version) {
    return (
      <main className="space-y-6">
        <EnTetePage titre="Produit indisponible" filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: "Nouvelle cotation", href: "/cotations/nouvelle" }]} />
        <Bandeau ton="danger">Ce produit n'existe pas ou n'a aucun paramétrage en vigueur aujourd'hui.</Bandeau>
      </main>
    );
  }
  const [clients, intermediaires, creerIntermediaire] = await Promise.all([listerClients(utilisateur), listerIntermediaires(utilisateur, { actifsSeulement: true }), peutCreerIntermediaire(utilisateur)]);
  const bareme = version.modeTarification === "BAREME" ? await lireDescripteurBareme(utilisateur, code) : null;

  return (
    <main className="space-y-6">
      <EnTetePage
        titre={`Nouvelle cotation : ${donnees.produit.code} — ${donnees.produit.libelle}`}
        filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: "Nouvelle cotation", href: "/cotations/nouvelle" }, { libelle: donnees.produit.code }]}
      />
      <FormulaireCotation
        produit={donnees.produit}
        formules={version.formules}
        clients={clients}
        tranchesMax={version.fractionnement.tranchesMax}
        formulesMax={version.cotation.formulesMax}
        intermediaires={intermediaires.map((i) => ({ code: i.code, nom: i.nom, role: i.role }))}
        parGaranties={compositionPossible(version.modeTarification)}
        peutCreerIntermediaire={creerIntermediaire}
        bareme={bareme ? { descripteur: bareme.descripteur } : undefined}
      />
    </main>
  );
}
