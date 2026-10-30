import { Bandeau, Carte, CarteIndicateur, EnTetePage, LienBouton, Tableau } from "@/composants/ui";
import type { TableauAdmin } from "@/serveur/tableau-admin";

export function TableauDeBordAdmin({ t, erreur }: { t: TableauAdmin; erreur: string | null }) {
  const { utilisateurs: u, stockage: s, audit: a } = t;

  return (
    <main className="space-y-6">
      <EnTetePage
        titre="Tableau de bord Administration"
        sousTitre="Supervision du système : sécurité des comptes, intégrité du stockage et journal d'audit."
        actions={
          <div className="flex flex-wrap gap-2">
            <LienBouton href="/admin/utilisateurs" variante="secondaire">
              Utilisateurs
            </LienBouton>
            <LienBouton href="/admin/droits" variante="secondaire">
              Matrice des droits
            </LienBouton>
            <LienBouton href="/admin/stockage" variante="secondaire">
              Stockage
            </LienBouton>
            <LienBouton href="/admin/audit" variante="secondaire">
              Journal d&apos;audit
            </LienBouton>
          </div>
        }
      />

      {erreur ? (
        <Bandeau ton="danger" role="alert">
          {erreur}
        </Bandeau>
      ) : null}

      {/* Indicateurs clés système */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CarteIndicateur
          icone="utilisateurs"
          etiquette="Comptes actifs"
          valeur={`${u.actifs} / ${u.total}`}
          ton="info"
        />
        <CarteIndicateur
          icone="cadenas"
          etiquette="Comptes verrouillés"
          valeur={u.verrouilles}
          ton={u.verrouilles > 0 ? "danger" : "succes"}
        />
        <CarteIndicateur
          icone="base-de-donnees"
          etiquette="Écritures différées (stockage)"
          valeur={s.ecrituresDiffereesEnAttente}
          ton={s.ecrituresDiffereesEnAttente > 0 ? "avertissement" : "succes"}
        />
        <CarteIndicateur
          icone="journal"
          etiquette="Événements d'audit (24h)"
          valeur={a.entrees24h}
          ton="neutre"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Utilisateurs récents */}
        <Carte titre="Comptes récents" description="Derniers utilisateurs créés sur la plateforme.">
          <Tableau
            legende="Utilisateurs récents"
            lignes={u.recents}
            cleLigne={(usr) => String(usr.id)}
            messageVide="Aucun utilisateur enregistré."
            colonnes={[
              { cle: "id", entete: "Identifiant", rendu: (usr) => <span className="font-semibold text-foreground">{usr.identifiant}</span> },
              { cle: "nom", entete: "Nom", rendu: (usr) => usr.nom },
              { cle: "profil", entete: "Profil", rendu: (usr) => usr.profil },
              {
                cle: "statut",
                entete: "État",
                rendu: (usr) => (
                  <span className={usr.verrouille ? "font-semibold text-danger" : usr.actif ? "text-foreground" : "text-neutral"}>
                    {usr.verrouille ? "Verrouillé" : usr.actif ? "Actif" : "Inactif"}
                  </span>
                ),
              },
            ]}
          />
        </Carte>

        {/* Dernières entrées d'audit */}
        <Carte titre="Activité d'audit récente" description="Dernières actions enregistrées dans le journal d'audit.">
          <Tableau
            legende="Dernières actions"
            lignes={a.dernieresActions}
            cleLigne={(act) => String(act.id)}
            messageVide="Aucun événement d'audit récent."
            colonnes={[
              { cle: "instant", entete: "Date & heure", rendu: (act) => act.instant },
              { cle: "action", entete: "Action", rendu: (act) => act.action },
              { cle: "acteur", entete: "Acteur", rendu: (act) => act.acteurIdentifiant },
              { cle: "cible", entete: "Cible", rendu: (act) => act.objet ?? "—" },
            ]}
          />
        </Carte>
      </div>

      {/* État du stockage */}
      <Carte titre="Stockage persistant des documents" description="Volume de documents PDF archivés sur le stockage sécurisé.">
        <p className="text-sm text-foreground">
          Total des documents émis et scellés : <strong>{s.totalDocumentsEmis}</strong> document(s).
        </p>
        {s.ecrituresDiffereesEnAttente > 0 ? (
          <Bandeau ton="avertissement" className="mt-3">
            {s.ecrituresDiffereesEnAttente} écriture(s) en attente de synchronisation sur le volume de stockage.
          </Bandeau>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Aucune écriture différée en file d&apos;attente : stockage synchronisé.</p>
        )}
      </Carte>
    </main>
  );
}
