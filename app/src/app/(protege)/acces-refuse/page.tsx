import { exigerUtilisateur } from "@/serveur/session";

export default async function AccesRefuse() {
  await exigerUtilisateur();
  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-red-700">Accès refusé</h1>
      <p className="text-zinc-700">
        Votre profil n'a pas le droit d'ouvrir cette page. Si c'est une erreur, contactez l'administrateur.
      </p>
    </main>
  );
}
