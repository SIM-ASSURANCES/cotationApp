import { Bouton, Carte, EnTetePage, LienBouton, ListeDeroulante, Tableau } from "@/composants/ui";
import { ACTIONS_AUDIT } from "@/domaine/audit";
import { peutLire } from "@/domaine/droits";
import { lireJournal } from "@/serveur/audit";
import { exigerDroit } from "@/serveur/session";

const formatDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium", timeZone: "Africa/Abidjan" });

const premier = (valeur: string | string[] | undefined) => (Array.isArray(valeur) ? valeur[0] : valeur);

export default async function PageAudit(props: PageProps<"/admin/audit">) {
  await exigerDroit("CONSULTER_AUDIT", peutLire);
  const parametres = await props.searchParams;
  const action = premier(parametres.action);
  const avant = premier(parametres.avant);

  const actionConnue = ACTIONS_AUDIT.find((a) => a === action);
  const { lignes, suivant } = await lireJournal({
    action: actionConnue,
    avantId: avant && /^\d{1,18}$/.test(avant) ? BigInt(avant) : undefined,
  });

  const lienSuivant = suivant ? `/admin/audit?${new URLSearchParams({ ...(actionConnue ? { action: actionConnue } : {}), avant: suivant })}` : null;

  return (
    <main className="space-y-6">
      <EnTetePage titre="Journal d'audit" sousTitre="Lecture seule : le journal ne peut être ni modifié ni effacé, y compris par l'application." />
      <Carte>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-72">
            <ListeDeroulante
              label="Action"
              name="action"
              defaultValue={actionConnue ?? ""}
              options={[{ valeur: "", libelle: "Toutes" }, ...ACTIONS_AUDIT.map((a) => ({ valeur: a, libelle: a }))]}
            />
          </div>
          <Bouton type="submit" variante="secondaire">
            Filtrer
          </Bouton>
        </form>
      </Carte>

      <Tableau
        legende="Journal d'audit"
        lignes={lignes}
        cleLigne={(l) => String(l.id)}
        messageVide="Aucune entrée."
        colonnes={[
          { cle: "date", entete: "Date", rendu: (l) => <span className="whitespace-nowrap">{formatDate.format(l.horodatage)}</span> },
          { cle: "utilisateur", entete: "Utilisateur", rendu: (l) => l.utilisateur ?? "—" },
          { cle: "action", entete: "Action", rendu: (l) => <span className="font-medium">{l.action}</span> },
          { cle: "objet", entete: "Objet", rendu: (l) => l.objet ?? "—" },
          {
            cle: "changement",
            entete: "Avant → après",
            rendu: (l) => (
              <span className="break-all font-mono text-xs">
                {l.avant || l.apres ? `${l.avant ? JSON.stringify(l.avant) : "∅"} → ${l.apres ? JSON.stringify(l.apres) : "∅"}` : "—"}
              </span>
            ),
          },
          { cle: "adresse", entete: "Adresse", rendu: (l) => l.adresseIp ?? "—" },
        ]}
      />
      {lienSuivant ? (
        <div>
          <LienBouton href={lienSuivant}>Entrées plus anciennes →</LienBouton>
        </div>
      ) : null}
    </main>
  );
}
