import Link from "next/link";

import { enVigueur } from "@/domaine/calcul/parametrage";
import { peutAgir } from "@/domaine/droits";
import { listerClients } from "@/serveur/clients";
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
      <main>
        <h1 className="mb-2 text-2xl font-semibold text-sim-bleu">Nouvelle cotation</h1>
        <p className="mb-4 text-sm text-zinc-700">Choisissez le produit.</p>
        <ul className="list-disc pl-6">
          {produits.map((p) => (
            <li key={p.code}>
              <Link href={`/cotations/nouvelle?produit=${p.code}`} className="font-medium text-sim-bleu underline">
                {p.code}
              </Link>{" "}
              — {p.libelle}
            </li>
          ))}
        </ul>
        {produits.length === 0 ? <p className="text-sm text-zinc-600">Aucun produit paramétré : un profil Technique doit d'abord en créer un.</p> : null}
      </main>
    );
  }

  const donnees = await listerVersions(utilisateur, code);
  const version = donnees ? enVigueur(donnees.versions, aujourdhui()) : null;
  if (!donnees || !version) {
    return (
      <main>
        <h1 className="mb-2 text-2xl font-semibold text-red-700">Produit indisponible</h1>
        <p>Ce produit n'existe pas ou n'a aucun paramétrage en vigueur aujourd'hui.</p>
      </main>
    );
  }
  const clients = await listerClients(utilisateur);

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href="/cotations/nouvelle" className="text-sim-bleu underline">
          ← Produits
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-semibold text-sim-bleu">
        Nouvelle cotation : {donnees.produit.code} <span className="font-normal text-zinc-700">— {donnees.produit.libelle}</span>
      </h1>
      <FormulaireCotation
        produit={donnees.produit}
        formules={version.formules}
        clients={clients}
        tranchesMax={version.fractionnement.tranchesMax}
        formulesMax={version.cotation.formulesMax}
      />
    </main>
  );
}
