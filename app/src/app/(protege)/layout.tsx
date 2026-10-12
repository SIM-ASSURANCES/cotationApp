import Link from "next/link";

import { EnTete, type LienNavigation } from "@/composants/EnTete";
import { peutLire } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerUtilisateur } from "@/serveur/session";
import { alerteStockage } from "@/serveur/surveillance";

import { deconnecter } from "./actions";

// Tout ce qui est dans (protege) exige une session. Les pages vérifient aussi elles-mêmes
// (exigerUtilisateur / exigerDroit) : une page isolée ne doit jamais dépendre du seul layout.
export default async function LayoutProtege({ children }: LayoutProps<"/">) {
  const utilisateur = await exigerUtilisateur({ autoriserChangementMotDePasse: true });

  const liens: LienNavigation[] = [{ href: "/", libelle: "Accueil" }];
  // T14 : alerte de l'administrateur, sur chaque écran, tant qu'un document émis attend son écriture dans le stockage.
  const alerte = utilisateur.doitChangerMotDePasse ? null : await alerteStockage(utilisateur);
  if (!utilisateur.doitChangerMotDePasse) {
    const [parametrage, cotation, depotModele, publicationModele] = await Promise.all([
      niveauDuProfil(utilisateur.profil, "PARAMETRER_PRODUITS"),
      niveauDuProfil(utilisateur.profil, "CREER_COTATION"),
      niveauDuProfil(utilisateur.profil, "DEPOSER_MODELE"),
      niveauDuProfil(utilisateur.profil, "PUBLIER_MODELE"),
    ]);
    if (peutLire(cotation)) {
      liens.push({ href: "/cotations", libelle: "Cotations" });
    }
    if (peutLire(depotModele) || peutLire(publicationModele)) {
      liens.push({ href: "/modeles", libelle: "Modèles Word" });
    }
    const lectureDocuments = await Promise.all(
      (["CREER_COTATION", "EMETTRE_CONTRAT", "EMETTRE_FACTURE", "EMETTRE_AVOIR", "ENREGISTRER_PAIEMENT"] as const).map((action) =>
        niveauDuProfil(utilisateur.profil, action),
      ),
    );
    // Factures : un des trois droits de facturation (CDC §4) ; même règle que le service (serveur/factures.ts).
    if (lectureDocuments.slice(2).some(peutLire)) {
      liens.push({ href: "/factures", libelle: "Factures" });
    }
    // Avis d'échéance et relances (CDC §12) : droit « Émettre une facture » (H21).
    if (peutLire(lectureDocuments[2])) {
      liens.push({ href: "/echeances", libelle: "Échéances" });
    }
    if (lectureDocuments.some(peutLire)) {
      liens.push({ href: "/documents", libelle: "Documents émis" });
    }
    // Import en masse des adhérents (CDC §13) : droit des adhérents et des certificats, « Émettre un contrat ».
    if (peutLire(lectureDocuments[1])) {
      liens.push({ href: "/imports", libelle: "Imports" });
    }
    if (peutLire(parametrage)) {
      liens.push({ href: "/parametrage/produits", libelle: "Produits" }, { href: "/parametrage/branches", libelle: "Branches" }, { href: "/parametrage/taxes", libelle: "Taxes" }, { href: "/parametrage/societe", libelle: "Société" });
    }
    if (peutLire(parametrage) || peutLire(cotation)) {
      liens.push({ href: "/calcul", libelle: "Calcul" });
    }
    if (await niveauDuProfil(utilisateur.profil, "GERER_UTILISATEURS").then((n) => n === "OUI")) {
      liens.push({ href: "/admin/utilisateurs", libelle: "Utilisateurs" }, { href: "/admin/droits", libelle: "Droits" }, { href: "/admin/stockage", libelle: "Stockage" });
    }
    if (await niveauDuProfil(utilisateur.profil, "CONSULTER_TABLEAUX_DE_BORD").then(peutLire)) {
      liens.push({ href: "/tableaux-de-bord", libelle: "Tableaux de bord" });
    }
    if (await niveauDuProfil(utilisateur.profil, "CONSULTER_AUDIT").then(peutLire)) {
      liens.push({ href: "/admin/audit", libelle: "Journal d'audit" });
    }
  }

  return (
    <>
      <EnTete nom={utilisateur.nom} libelleProfil={utilisateur.libelleProfil} liens={liens} deconnexion={deconnecter} />
      {alerte ? (
        <div role="alert" className="border-b border-amber-400 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          <div className="mx-auto max-w-6xl">
            <strong>Stockage indisponible :</strong> {alerte.enAttente} document(s) émis attendent l'écriture de leur fichier
            {alerte.plusAncienne ? ` (depuis le ${alerte.plusAncienne.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })})` : ""}. Les documents restent téléchargeables ; la reprise est automatique.{" "}
            <Link href="/admin/stockage" className="underline">Voir le détail</Link>
          </div>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</div>
    </>
  );
}
