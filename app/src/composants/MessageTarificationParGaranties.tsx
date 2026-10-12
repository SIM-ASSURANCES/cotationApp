import { MESSAGE_TARIFICATION_PAR_GARANTIES } from "@/domaine/calcul/parametrage";

/**
 * Refus affiché à la place d'un formulaire de cotation pour un produit tarifé par garanties (session 6.2a) : le serveur refuserait
 * l'envoi, autant ne pas faire remplir un long formulaire. Le texte est celui du refus du serveur, sans rien y ajouter.
 */
export function MessageTarificationParGaranties() {
  return (
    <p role="alert" className="max-w-3xl rounded border border-danger bg-muted p-4 text-sm">
      {MESSAGE_TARIFICATION_PAR_GARANTIES}
    </p>
  );
}
