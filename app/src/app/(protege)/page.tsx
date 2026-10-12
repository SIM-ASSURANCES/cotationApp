import { exigerUtilisateur } from "@/serveur/session";

export default async function Accueil() {
  const utilisateur = await exigerUtilisateur();
  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Bonjour {utilisateur.nom}</h1>
      <p className="text-neutral">
        Connecté en tant que <strong>{utilisateur.libelleProfil}</strong>. Les modules métier (cotations, contrats,
        factures…) seront ajoutés phase après phase ; pour l'instant, le socle propose la connexion, les droits par
        profil et le journal d'audit.
      </p>
    </main>
  );
}
