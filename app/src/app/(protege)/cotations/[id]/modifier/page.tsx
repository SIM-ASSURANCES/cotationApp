import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { enVigueur } from "@/domaine/calcul/parametrage";
import { peutModifier } from "@/domaine/cotation/statuts";
import { peutAgir } from "@/domaine/droits";
import { listerClients } from "@/serveur/clients";
import { lireCotation } from "@/serveur/cotations";
import { aujourdhui, listerVersions } from "@/serveur/parametrage";
import { exigerDroit } from "@/serveur/session";

import { FormulaireCotation } from "../../formulaire-cotation";

export default async function PageModifierCotation(props: PageProps<"/cotations/[id]/modifier">) {
  const { id } = await props.params;
  const utilisateur = await exigerDroit("CREER_COTATION", peutAgir);
  const cotation = Number.isInteger(Number(id)) ? await lireCotation(utilisateur, Number(id)) : null;
  if (!cotation) {
    notFound();
  }
  // Tout utilisateur qui peut créer une cotation modifie un brouillon (H9, D18), et seulement un brouillon.
  if (!peutModifier(cotation.statut)) {
    redirect(`/cotations/${cotation.id}`);
  }
  const donnees = await listerVersions(utilisateur, cotation.produit.code);
  const version = donnees ? enVigueur(donnees.versions, aujourdhui()) : null;
  if (!donnees || !version) {
    redirect(`/cotations/${cotation.id}`);
  }
  const clients = await listerClients(utilisateur);

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href={`/cotations/${cotation.id}`} className="text-sim-bleu underline">
          ← Fiche de la cotation
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-semibold text-sim-bleu">Modifier le brouillon n° {cotation.id}</h1>
      <FormulaireCotation
        produit={donnees.produit}
        formules={version.formules}
        clients={clients}
        tranchesMax={version.fractionnement.tranchesMax}
        formulesMax={version.cotation.formulesMax}
        base={cotation}
      />
    </main>
  );
}
