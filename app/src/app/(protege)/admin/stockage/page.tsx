import { redirect } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { exigerUtilisateur } from "@/serveur/session";
import { lireEtatStockage } from "@/serveur/surveillance";
import { ErreurAcces } from "@/serveur/types";

import { relancerLesEcritures } from "./actions";

const heure = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });

/** Stockage des documents émis (T14, D11) : écritures différées, reprise automatique et relance manuelle. */
export default async function PageStockage() {
  const utilisateur = await exigerUtilisateur();
  let etat;
  try {
    etat = await lireEtatStockage(utilisateur);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  return (
    <main className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">Stockage des documents émis</h1>
      <p className="mb-4 text-sm text-zinc-700">
        Quand le stockage est indisponible au moment d'une émission, le document est émis quand même : son PDF attend ici, il reste téléchargeable, et la file de
        tâches retente l'écriture avec des délais croissants (30 s, 1 min, 2 min…). Chaque échec et chaque reprise sont inscrits au journal d'audit.
      </p>
      {etat.enAttente === 0 ? (
        <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">Aucune écriture en attente : tous les documents émis sont dans le stockage.</p>
      ) : (
        <>
          <p className="mb-3 text-sm font-medium text-amber-900">{etat.enAttente} document(s) en attente d'écriture. Dernière erreur : {etat.derniereErreur}</p>
          <FormulaireAction action={relancerLesEcritures} libelleBouton="Relancer maintenant" className="mb-4">
            <span />
          </FormulaireAction>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-sim-bleu text-left text-white"><th className="p-2">Document</th><th className="p-2">Chemin</th><th className="p-2">En attente depuis</th><th className="p-2">Essais</th><th className="p-2">Dernier essai</th><th className="p-2">Erreur</th></tr>
            </thead>
            <tbody>
              {etat.lignes.map((l) => (
                <tr key={l.documentId} className="border-b border-bordure align-top">
                  <td className="p-2"><a href={`/api/documents/${l.documentId}`} className="text-sim-bleu underline">{l.numero} v{l.version}</a></td>
                  <td className="p-2 font-mono text-xs">{l.chemin}</td><td className="p-2">{heure(l.creeLe)}</td><td className="p-2">{l.tentatives}</td><td className="p-2">{heure(l.dernierEssai)}</td><td className="p-2">{l.derniereErreur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
