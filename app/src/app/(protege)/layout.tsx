import { Coquille, type AlerteStockage } from "@/composants/coquille/Coquille";
import { CoquilleConnexion } from "@/composants/coquille/CoquilleConnexion";
import { Bouton } from "@/composants/ui";
import type { CodeProfil } from "@/domaine/droits";
import { ACTIONS_DE_NAVIGATION, construireNavigation, type NiveauxNavigation } from "@/domaine/navigation";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerUtilisateur } from "@/serveur/session";
import { alerteStockage } from "@/serveur/surveillance";

import { deconnecter } from "./actions";

/** Niveaux de droits dont dépend le menu (en parallèle) : la liste des actions est celle de domaine/navigation.ts. */
async function lireNiveauxDeNavigation(profil: CodeProfil): Promise<NiveauxNavigation> {
  const lus = await Promise.all(ACTIONS_DE_NAVIGATION.map(async (action) => [action, await niveauDuProfil(profil, action)] as const));
  return Object.fromEntries(lus) as NiveauxNavigation;
}

/** T14 : alerte de l'administrateur, sur chaque écran, tant qu'un document émis attend l'écriture de son fichier dans le stockage. */
function alerteDeStockage(attente: { enAttente: number; plusAncienne: Date | null } | null): AlerteStockage | null {
  if (!attente) return null;
  const depuis = attente.plusAncienne ? ` (depuis le ${attente.plusAncienne.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })})` : "";
  return {
    message: `Stockage indisponible : ${attente.enAttente} document(s) émis attendent l'écriture de leur fichier${depuis}. Les documents restent téléchargeables ; la reprise est automatique.`,
    lien: { href: "/admin/stockage", libelle: "Voir le détail" },
  };
}

// Tout ce qui est dans (protege) exige une session. Les pages vérifient aussi elles-mêmes
// (exigerUtilisateur / exigerDroit) : une page isolée ne doit jamais dépendre du seul layout.
export default async function LayoutProtege({ children }: LayoutProps<"/">) {
  const utilisateur = await exigerUtilisateur({ autoriserChangementMotDePasse: true });

  // Changement de mot de passe obligatoire : l'écran prend la coquille de connexion (ni menu ni barre du haut), avec de quoi se déconnecter.
  if (utilisateur.doitChangerMotDePasse) {
    return (
      <CoquilleConnexion
        largeur="md"
        pied={
          <form action={deconnecter}>
            <Bouton variante="secondaire" type="submit" className="w-full">
              Déconnexion
            </Bouton>
          </form>
        }
      >
        {children}
      </CoquilleConnexion>
    );
  }

  const [niveaux, attente] = await Promise.all([lireNiveauxDeNavigation(utilisateur.profil), alerteStockage(utilisateur)]);

  return (
    <Coquille
      utilisateur={{ nom: utilisateur.nom, libelleProfil: utilisateur.libelleProfil }}
      navigation={construireNavigation(niveaux)}
      alerteStockage={alerteDeStockage(attente)}
      deconnexion={deconnecter}
    >
      {children}
    </Coquille>
  );
}
