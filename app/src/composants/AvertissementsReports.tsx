import { Bandeau } from "@/composants/ui";
import { formaterMontant, montant } from "@/domaine/calcul/montant";

/** Une somme reportée d'une facture annulée, encore en attente de sa facture de remplacement (H73, session 6.1). */
export type ReportAffiche = { mouvementId: number; avertissement: string; montant: string; date: string; recu: string | null };

/**
 * Avertissement des écrans d'imputation et de restitution de l'avance : pour chaque somme reportée, d'où elle vient. Ces sommes
 * ne sont pas réservées à la facture de remplacement (H73, option a) : l'avertissement informe, il ne bloque rien.
 */
export function AvertissementsReports({ reports }: { reports: readonly ReportAffiche[] }) {
  if (reports.length === 0) return null;
  return (
    // `Bandeau` n'accepte que alert / status : le rôle « note » de l'ancien encadré reste porté par l'enveloppe.
    <div role="note" className="mb-3">
      <Bandeau ton="avertissement">
        <p className="mb-1 font-medium">Attention : une partie de l&apos;avance est destinée à une facture de remplacement non émise.</p>
        <ul className="list-disc pl-5">
          {reports.map((r) => (
            <li key={r.mouvementId}>
              {formaterMontant(montant(r.montant))} F ({r.recu ?? "avance"}, {r.date}) : {r.avertissement}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-neutral">Rien n&apos;est réservé : si vous imputez ou restituez cette avance, la facture de remplacement ne la retrouvera pas.</p>
      </Bandeau>
    </div>
  );
}
