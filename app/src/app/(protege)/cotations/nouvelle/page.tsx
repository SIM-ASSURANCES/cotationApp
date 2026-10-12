import Link from "next/link";

import { Bandeau, EnTetePage, Tableau } from "@/composants/ui";
import { compositionPossible, enVigueur } from "@/domaine/calcul/parametrage";
import { peutAgir } from "@/domaine/droits";
import { listerClients } from "@/serveur/clients";
import { listerIntermediaires } from "@/serveur/intermediaires";
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
        <EnTetePage titre="Nouvelle cotation" sousTitre="Choisissez le produit." filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: "Nouvelle cotation" }]} />
        <Tableau
          legende="Produits"
          lignes={produits}
          cleLigne={(p) => p.code}
          messageVide="Aucun produit paramétré : un profil Technique doit d'abord en créer un."
          colonnes={[
            {
              cle: "code",
              entete: "Produit",
              rendu: (p) => (
                <Link href={`/cotations/nouvelle?produit=${p.code}`} className="font-medium text-primary underline">
                  {p.code}
                </Link>
              ),
            },
            { cle: "libelle", entete: "Libellé", rendu: (p) => p.libelle },
          ]}
        />
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
  const [clients, intermediaires] = await Promise.all([listerClients(utilisateur), listerIntermediaires(utilisateur, { actifsSeulement: true })]);

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
      />
    </main>
  );
}
