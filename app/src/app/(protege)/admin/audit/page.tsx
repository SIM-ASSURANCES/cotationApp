import Link from "next/link";

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
    <main>
      <h1 className="mb-2 text-2xl font-semibold text-primary">Journal d'audit</h1>
      <p className="mb-4 max-w-3xl text-sm text-neutral">
        Lecture seule : le journal ne peut être ni modifié ni effacé, y compris par l'application.
      </p>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label>
          Action{" "}
          <select name="action" defaultValue={actionConnue ?? ""} className="rounded border border-border bg-surface px-2 py-1">
            <option value="">Toutes</option>
            {ACTIONS_AUDIT.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded border border-primary px-3 py-1 font-medium text-primary hover:bg-muted">
          Filtrer
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-left text-primary-foreground">
              <th className="p-2">Date</th>
              <th className="p-2">Utilisateur</th>
              <th className="p-2">Action</th>
              <th className="p-2">Objet</th>
              <th className="p-2">Avant → après</th>
              <th className="p-2">Adresse</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-b border-border align-top">
                <td className="p-2 whitespace-nowrap">{formatDate.format(l.horodatage)}</td>
                <td className="p-2">{l.utilisateur ?? "—"}</td>
                <td className="p-2 font-medium">{l.action}</td>
                <td className="p-2">{l.objet ?? "—"}</td>
                <td className="p-2 font-mono text-xs break-all">
                  {l.avant || l.apres ? `${l.avant ? JSON.stringify(l.avant) : "∅"} → ${l.apres ? JSON.stringify(l.apres) : "∅"}` : "—"}
                </td>
                <td className="p-2">{l.adresseIp ?? "—"}</td>
              </tr>
            ))}
            {lignes.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-neutral">
                  Aucune entrée.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {lienSuivant ? (
        <p className="mt-4">
          <Link href={lienSuivant} className="font-medium text-primary underline">
            Entrées plus anciennes →
          </Link>
        </p>
      ) : null}
    </main>
  );
}
