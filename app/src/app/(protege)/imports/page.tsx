import Link from "next/link";
import { redirect } from "next/navigation";

import { listerLots } from "@/serveur/imports";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { LIBELLE_STATUT_LOT } from "./libelles";

/** Imports en masse (CDC §13) : les 100 plus récents. Un import se dépose depuis l'écran des adhérents d'une police mère. */
export default async function PageImports() {
  const utilisateur = await exigerUtilisateur();
  let lots;
  try {
    lots = await listerLots(utilisateur);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  return (
    <main>
      <h1 className="mb-1 text-2xl font-semibold text-primary">Imports en masse</h1>
      <p className="mb-4 text-sm text-neutral">Un import se dépose depuis l'écran des adhérents d'une police mère (fiche de la cotation acceptée, lien « Adhérents »).</p>
      {lots.length === 0 ? (
        <p className="text-sm">Aucun import pour l'instant.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-left text-primary-foreground"><th className="p-2">Import</th><th className="p-2">Police</th><th className="p-2">Fichier</th><th className="p-2">Lignes</th><th className="p-2">En erreur</th><th className="p-2">État</th><th className="p-2">Déposé par</th></tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="p-2"><Link href={`/imports/${l.id}`} className="text-primary underline">n° {l.id}</Link></td>
                <td className="p-2">{l.policeNumero}</td><td className="p-2">{l.fichierNom}</td><td className="p-2">{l.total}</td><td className="p-2">{l.erreurs}</td>
                <td className="p-2">{LIBELLE_STATUT_LOT[l.statut]}</td><td className="p-2">{l.creePar}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
