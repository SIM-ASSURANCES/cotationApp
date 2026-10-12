import Link from "next/link";

import { CoquilleConnexion } from "@/composants/coquille/CoquilleConnexion";
import { Bouton } from "@/composants/ui";
import { exigerUtilisateur } from "@/serveur/session";

import { deconnecter } from "../(protege)/actions";

// Hors du groupe (protege) : l'URL reste /acces-refuse, mais la page n'a pas la coquille de l'application (barre latérale,
// barre du haut) et s'habille comme les écrans de connexion. Elle exige toujours une session.
export default async function AccesRefuse() {
  await exigerUtilisateur();
  return (
    <main className="flex flex-1 flex-col">
      {/* L'ancien écran gardait la déconnexion du bandeau : la page n'en a plus, elle la porte elle-même sous la carte. */}
      <CoquilleConnexion
        pied={
          <form action={deconnecter}>
            <Bouton variante="secondaire" type="submit" className="w-full">
              Déconnexion
            </Bouton>
          </form>
        }
      >
        <div>
          <h1 className="text-xl font-bold text-danger">Accès refusé</h1>
          <p className="mt-2 text-sm text-neutral">
            Votre profil n'a pas le droit d'ouvrir cette page. Si c'est une erreur, contactez l'administrateur.
          </p>
        </div>
        {/* Un lien (<a>) ne peut pas contenir un <button> : il reprend les classes de la variante secondaire de Bouton. */}
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground transition-[background-color,color,transform] duration-150 ease-out-strong hover:bg-secondary-hover motion-safe:active:scale-[0.97]"
        >
          Retour à l'accueil
        </Link>
      </CoquilleConnexion>
    </main>
  );
}
