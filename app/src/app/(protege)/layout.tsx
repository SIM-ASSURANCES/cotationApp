import { EnTete, type LienNavigation } from "@/composants/EnTete";
import { peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerUtilisateur } from "@/serveur/session";

import { deconnecter } from "./actions";

// Tout ce qui est dans (protege) exige une session. Les pages vérifient aussi elles-mêmes
// (exigerUtilisateur / exigerDroit) : une page isolée ne doit jamais dépendre du seul layout.
export default async function LayoutProtege({ children }: LayoutProps<"/">) {
  const utilisateur = await exigerUtilisateur({ autoriserChangementMotDePasse: true });

  const liens: LienNavigation[] = [{ href: "/", libelle: "Accueil" }];
  if (!utilisateur.doitChangerMotDePasse) {
    if (await niveauDuProfil(utilisateur.profil, "GERER_UTILISATEURS").then((n) => n === "OUI")) {
      liens.push({ href: "/admin/utilisateurs", libelle: "Utilisateurs" }, { href: "/admin/droits", libelle: "Droits" });
    }
    if (await niveauDuProfil(utilisateur.profil, "CONSULTER_AUDIT").then(peutLire)) {
      liens.push({ href: "/admin/audit", libelle: "Journal d'audit" });
    }
  }

  return (
    <>
      <EnTete nom={utilisateur.nom} libelleProfil={utilisateur.libelleProfil} liens={liens} deconnexion={deconnecter} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
    </>
  );
}
