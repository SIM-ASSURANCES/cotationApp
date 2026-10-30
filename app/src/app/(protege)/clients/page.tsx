import Link from "next/link";

import { ChampsSouscripteurDynamiques } from "@/composants/ChampsSouscripteurDynamiques";
import { FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, EnTetePage, Tableau } from "@/composants/ui";
import { peutAgir, peutLire } from "@/domaine/droits";
import { listerClients } from "@/serveur/clients";
import { niveauDuProfil } from "@/serveur/droits";
import { exigerDroit } from "@/serveur/session";

import { creerUnClient } from "./actions";

export default async function PageClients() {
  const utilisateur = await exigerDroit("CREER_COTATION", peutLire);
  const [clients, niveau] = await Promise.all([listerClients(utilisateur), niveauDuProfil(utilisateur.profil, "CREER_COTATION")]);

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Clients"
        sousTitre="Clients enregistrés, que l'on peut choisir à la cotation. Un prospect, lui, se saisit librement sur la cotation (CDC §9.1)."
        filAriane={[{ libelle: "Cotations", href: "/cotations" }, { libelle: "Clients" }]}
      />
      {peutAgir(niveau) ? (
        <Carte titre="Ajouter un client" className="max-w-4xl">
          <FormulaireAction action={creerUnClient} libelleBouton="Ajouter">
            <ChampsSouscripteurDynamiques />
          </FormulaireAction>
        </Carte>
      ) : null}
      <Tableau
        legende="Clients enregistrés"
        lignes={clients}
        cleLigne={(c) => String(c.id)}
        messageVide="Aucun client enregistré."
        colonnes={[
          {
            cle: "nom",
            entete: "Nom",
            className: "font-semibold",
            rendu: (c) => (
              <Link href={`/clients/${c.id}`} className="text-primary hover:underline">
                {c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}`}
              </Link>
            ),
          },
          { cle: "type", entete: "Type", rendu: (c) => (c.souscripteur.type === "MORALE" ? "Morale" : "Physique") },
          { cle: "telephone", entete: "Téléphone", rendu: (c) => c.souscripteur.telephone || "—" },
          { cle: "email", entete: "E-mail", rendu: (c) => c.souscripteur.email || "—" },
          {
            cle: "actions",
            entete: "Dossier",
            rendu: (c) => (
              <Link href={`/clients/${c.id}`} className="inline-flex items-center text-xs font-semibold text-primary hover:underline">
                Documents & contrats →
              </Link>
            ),
          },
        ]}
      />
    </main>
  );
}
