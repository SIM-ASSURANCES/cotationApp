import { ComplementsSouscripteur } from "@/composants/ComplementsSouscripteur";
import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { Carte, EnTetePage, ListeDeroulante, Tableau } from "@/composants/ui";
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
            <div className="mb-4">
              <ListeDeroulante
                label="Type"
                name="souscripteur_type"
                defaultValue="PHYSIQUE"
                options={[
                  { valeur: "PHYSIQUE", libelle: "Personne physique" },
                  { valeur: "MORALE", libelle: "Personne morale" },
                ]}
              />
            </div>
            <Champ nom="souscripteur_nom" libelle="Nom (personne physique)" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_prenoms" libelle="Prénoms" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_raison_sociale" libelle="Raison sociale (personne morale)" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_telephone" libelle="Téléphone" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_email" libelle="E-mail" requis={false} autoComplete="off" />
            <Champ nom="souscripteur_adresse" libelle="Adresse" requis={false} autoComplete="off" />
            <ComplementsSouscripteur />
          </FormulaireAction>
        </Carte>
      ) : null}
      <Tableau
        legende="Clients enregistrés"
        lignes={clients}
        cleLigne={(c) => String(c.id)}
        messageVide="Aucun client enregistré."
        colonnes={[
          { cle: "nom", entete: "Nom", className: "font-medium", rendu: (c) => (c.souscripteur.type === "MORALE" ? c.souscripteur.raison_sociale : `${c.souscripteur.nom} ${c.souscripteur.prenoms}`) },
          { cle: "type", entete: "Type", rendu: (c) => (c.souscripteur.type === "MORALE" ? "Morale" : "Physique") },
          { cle: "telephone", entete: "Téléphone", rendu: (c) => c.souscripteur.telephone || "—" },
          { cle: "email", entete: "E-mail", rendu: (c) => c.souscripteur.email || "—" },
        ]}
      />
    </main>
  );
}
