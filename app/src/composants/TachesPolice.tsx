import Link from "next/link";

import { fermerLaTache } from "@/app/(protege)/taches/actions";
import { Bandeau } from "@/composants/ui";
import type { TacheLue } from "@/domaine/imports/taches";

import { Champ, FormulaireAction } from "./FormulaireAction";

/**
 * Tâches ouvertes d'une police (H64) : pièces à émettre après un import en masse. Chaque tâche se ferme seule à
 * l'émission de sa pièce (nouvelle version des CP, facture d'avenant de la version de la liste), ou à la main, avec un
 * motif obligatoire, par qui a le droit d'émettre la pièce (H66, session 6.0).
 */
export function TachesPolice({ taches, cotationId, chemin }: { taches: TacheLue[]; cotationId: number; chemin: string }) {
  if (taches.length === 0) return null;
  const lien = (t: TacheLue) => (t.type === "CP_A_EMETTRE" ? `/cotations/${cotationId}/adherents` : `/cotations/${cotationId}/factures`);
  return (
    <div className="max-w-4xl">
      <Bandeau ton="avertissement" role="status">
        <h2 className="mb-1 font-semibold">À faire sur cette police</h2>
        <ul className="list-disc pl-5">
          {taches.map((t) => (
            <li key={t.id} className="mb-2">
              <Link href={lien(t)} className="text-primary underline">{t.libelle}</Link> — liste des adhérents version {t.versionAdherents} (import du{" "}
              {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" }).format(t.creeLe)} par {t.creePar})
              {t.fermable ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-neutral">Fermer sans émettre la pièce</summary>
                  {/* Les champs ont un fond teinté : ils vont dans un panneau blanc, jamais directement sur le fond du bandeau. */}
                  <div className="mt-2 rounded-md border border-border bg-surface p-3 text-foreground">
                    <FormulaireAction action={fermerLaTache} libelleBouton="Fermer la tâche" discret>
                      <input type="hidden" name="tacheId" value={t.id} />
                      <input type="hidden" name="retour" value={chemin} />
                      <Champ nom="motif" libelle="Motif (obligatoire, ex. « pas de facturation »)" autoComplete="off" />
                    </FormulaireAction>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </Bandeau>
    </div>
  );
}
