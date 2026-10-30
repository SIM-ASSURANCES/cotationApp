import { normaliserDateSaisie } from "@/domaine/calcul/dates";
import { exigerUtilisateur } from "@/serveur/session";
import {
  tableauAdminMemorise,
  tableauCommercialMemorise,
  tableauComptabiliteMemorise,
  tableauDGMemorise,
  tableauProductionMemorise,
  tableauTechniqueMemorise,
} from "@/serveur/tableaux-memorises";
import { ErreurAcces, ErreurMetier } from "@/serveur/types";

import { TableauDeBordAdmin } from "./tableaux-de-bord/tableau-admin";
import { TableauDeBordCommercial } from "./tableau-commercial";
import { TableauDeBordComptabilite } from "./tableaux-de-bord/tableau-comptabilite";
import { TableauDeBordDG } from "./tableaux-de-bord/tableau-dg";
import { TableauDeBordProduction } from "./tableaux-de-bord/tableau-production";
import { TableauDeBordTechnique } from "./tableaux-de-bord/tableau-technique";
import { Carte, EnTetePage } from "@/composants/ui";

function Bienvenue({ nom, profil }: { nom: string; profil: string }) {
  return (
    <main className="space-y-6">
      <EnTetePage titre={`Bonjour ${nom}`} />
      <Carte className="max-w-3xl">
        <p className="text-sm text-muted-foreground">
          Connecté en tant que <strong className="text-foreground">{profil}</strong>. Le menu donne accès aux écrans de votre profil.
        </p>
      </Carte>
    </main>
  );
}

/**
 * Accueil = Tableau de bord dédié selon le profil de l'utilisateur connecté.
 * Chaque profil dispose de ses propres chiffres, indicateurs et files de travail.
 */
export default async function PageTableauDeBord(props: PageProps<"/">) {
  const recherche = await props.searchParams;
  const texte = (v: string | string[] | undefined) => (typeof v === "string" ? normaliserDateSaisie(v) : undefined);
  const utilisateur = await exigerUtilisateur();
  // Le serveur refuse seul (matrice des droits) : un profil sans le droit de son tableau (droits personnalisés) voit la page de bienvenue.
  try {
    return await tableauDuProfil(utilisateur, { debut: texte(recherche.debut), fin: texte(recherche.fin) });
  } catch (e) {
    if (!(e instanceof ErreurAcces)) throw e;
    return <Bienvenue nom={utilisateur.nom} profil={utilisateur.libelleProfil} />;
  }
}

async function tableauDuProfil(utilisateur: Awaited<ReturnType<typeof exigerUtilisateur>>, periode: { debut?: string; fin?: string }) {

  // 1. Profil Commercial
  if (utilisateur.profil === "COMMERCIAL") {
    let t;
    let erreur: string | null = null;
    try {
      t = await tableauCommercialMemorise(utilisateur, periode);
    } catch (e) {
      if (!(e instanceof ErreurMetier)) throw e;
      erreur = e.message;
      t = await tableauCommercialMemorise(utilisateur);
    }
    return <TableauDeBordCommercial t={t} erreur={erreur} />;
  }

  // 2. Profil Technique
  if (utilisateur.profil === "TECHNIQUE") {
    let t;
    let erreur: string | null = null;
    try {
      t = await tableauTechniqueMemorise(utilisateur, periode);
    } catch (e) {
      if (!(e instanceof ErreurMetier)) throw e;
      erreur = e.message;
      t = await tableauTechniqueMemorise(utilisateur);
    }
    return <TableauDeBordTechnique t={t} erreur={erreur} />;
  }

  // 3. Profil Comptabilité
  if (utilisateur.profil === "COMPTABILITE") {
    let t;
    let erreur: string | null = null;
    try {
      t = await tableauComptabiliteMemorise(utilisateur, periode);
    } catch (e) {
      if (!(e instanceof ErreurMetier)) throw e;
      erreur = e.message;
      t = await tableauComptabiliteMemorise(utilisateur);
    }
    return <TableauDeBordComptabilite t={t} erreur={erreur} />;
  }

  // 4. Profil Direction Générale
  if (utilisateur.profil === "DIRECTION_GENERALE") {
    let t;
    let erreur: string | null = null;
    try {
      t = await tableauDGMemorise(utilisateur, periode);
    } catch (e) {
      if (!(e instanceof ErreurMetier)) throw e;
      erreur = e.message;
      t = await tableauDGMemorise(utilisateur);
    }
    return <TableauDeBordDG t={t} erreur={erreur} />;
  }

  // 5. Profil Gestionnaire de Production
  if (utilisateur.profil === "GESTIONNAIRE_PRODUCTION") {
    let t;
    let erreur: string | null = null;
    try {
      t = await tableauProductionMemorise(utilisateur, periode);
    } catch (e) {
      if (!(e instanceof ErreurMetier)) throw e;
      erreur = e.message;
      t = await tableauProductionMemorise(utilisateur);
    }
    return <TableauDeBordProduction t={t} erreur={erreur} />;
  }

  // 6. Profil Admin Système
  if (utilisateur.profil === "ADMIN_SYSTEME") {
    let t;
    let erreur: string | null = null;
    try {
      t = await tableauAdminMemorise(utilisateur);
    } catch (e) {
      if (!(e instanceof ErreurMetier)) throw e;
      erreur = e.message;
      t = await tableauAdminMemorise(utilisateur);
    }
    return <TableauDeBordAdmin t={t} erreur={erreur} />;
  }

  return <Bienvenue nom={utilisateur.nom} profil={utilisateur.libelleProfil} />;
}
