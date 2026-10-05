import { redirect } from "next/navigation";

import { cheminDeRetour } from "@/domaine/acces";
import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { obtenirUtilisateurCourant } from "@/serveur/session";

import { connecter } from "./actions";

export default async function PageConnexion(props: PageProps<"/connexion">) {
  const { callbackUrl } = await props.searchParams;
  const destination = cheminDeRetour(typeof callbackUrl === "string" ? callbackUrl : undefined);

  if (await obtenirUtilisateurCourant()) {
    redirect(destination);
  }

  return (
    <main className="flex flex-1 flex-col">
      <div className="bandeau-sim px-6 py-10 text-center">
        <p className="text-3xl font-bold tracking-wide">SIM ASSURANCES</p>
        <p className="mt-1 text-sm uppercase tracking-widest text-sim-ciel">Société ivoirienne de micro-assurance</p>
      </div>
      <div className="mx-auto w-full max-w-sm px-6 py-10">
        <h1 className="mb-6 text-xl font-semibold text-sim-bleu">Connexion à SIM Documents</h1>
        <FormulaireAction action={connecter} libelleBouton="Se connecter">
          <input type="hidden" name="destination" value={destination} />
          <Champ nom="identifiant" libelle="Identifiant" autoComplete="username" />
          <Champ nom="motDePasse" libelle="Mot de passe" type="password" autoComplete="current-password" />
        </FormulaireAction>
        <p className="mt-6 text-xs text-zinc-600">
          Accès réservé au personnel de SIM Assurances. Toutes les connexions sont journalisées.
        </p>
      </div>
    </main>
  );
}
