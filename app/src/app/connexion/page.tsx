import { redirect } from "next/navigation";

import { cheminDeRetour } from "@/domaine/acces";
import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { CoquilleConnexion } from "@/composants/coquille/CoquilleConnexion";
import { obtenirUtilisateurCourant } from "@/serveur/session";

import { connecter } from "./actions";

export default async function PageConnexion(props: PageProps<"/connexion">) {
  const { callbackUrl } = await props.searchParams;
  const destination = cheminDeRetour(typeof callbackUrl === "string" ? callbackUrl : undefined);

  if (await obtenirUtilisateurCourant()) {
    redirect(destination);
  }

  return (
    // La coquille ne fournit pas de <main> : il l'enveloppe, logo compris.
    <main className="flex flex-1 flex-col">
      <CoquilleConnexion>
        <div>
          <h1 className="text-xl font-bold text-foreground">Connexion</h1>
          <p className="mt-1 text-sm text-neutral">
            <span className="font-semibold">Documents</span> — portail interne SIM Assurances
          </p>
        </div>
        <FormulaireAction action={connecter} libelleBouton="Se connecter" pleineLargeur>
          <input type="hidden" name="destination" value={destination} />
          <Champ nom="identifiant" libelle="Identifiant" autoComplete="username" />
          <Champ nom="motDePasse" libelle="Mot de passe" type="password" autoComplete="current-password" />
          {/* Pas de réinitialisation en libre-service : le lien déplie la consigne, sans route ni requête (<details> fonctionne
              sans JavaScript). Pas de « Se souvenir de moi » non plus : la session de 8 h est une décision de sécurité (D6). */}
          <details className="-mt-2 mb-4">
            <summary className="ml-auto w-fit cursor-pointer list-none text-xs font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
              Mot de passe oublié ?
            </summary>
            <p className="mt-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-neutral">
              Contactez l'administrateur système, qui réinitialisera votre mot de passe.
            </p>
          </details>
        </FormulaireAction>
        <p className="text-xs text-muted-foreground">
          Accès réservé au personnel de SIM Assurances. Toutes les connexions sont journalisées.
        </p>
      </CoquilleConnexion>
    </main>
  );
}
