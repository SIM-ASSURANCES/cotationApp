import { Carte, EnTetePage } from "@/composants/ui";
import { exigerUtilisateur } from "@/serveur/session";

export default async function Accueil() {
  const utilisateur = await exigerUtilisateur();
  return (
    <main className="space-y-6">
      <EnTetePage titre={`Bonjour ${utilisateur.nom}`} />
      <Carte className="max-w-3xl">
        <p className="text-sm text-muted-foreground">
          Connecté en tant que <strong className="text-foreground">{utilisateur.libelleProfil}</strong>. Les modules métier (cotations, contrats,
          factures…) seront ajoutés phase après phase ; pour l'instant, le socle propose la connexion, les droits par
          profil et le journal d'audit.
        </p>
      </Carte>
    </main>
  );
}
