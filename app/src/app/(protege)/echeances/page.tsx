import Link from "next/link";
import { redirect } from "next/navigation";

import { FormulaireAction } from "@/composants/FormulaireAction";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { peutAgir } from "@/domaine/droits";
import { niveauDuProfil } from "@/serveur/droits";
import { listeDuJour, listerLotsEcheances, type ElementListe } from "@/serveur/echeances";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { genererDepuisLaListe } from "./actions";

const f = (m: string) => formaterMontant(montant(m));
const valeur = (e: ElementListe) => `${e.type}|${e.factureId}|${e.echeance.numero}|${e.niveau?.niveau ?? 0}`;

function Tableau({ lignes, agit, relances }: { lignes: ElementListe[]; agit: boolean; relances: boolean }) {
  if (lignes.length === 0) return <p className="mb-6 text-sm">Rien à produire.</p>;
  return (
    <div className="mb-6 overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="bg-sim-bleu text-left text-white">
            {agit ? <th className="p-2">Lot</th> : null}
            <th className="p-2">Facture</th><th className="p-2">Police</th><th className="p-2">Souscripteur</th><th className="p-2">Échéance</th><th className="p-2">Date</th>
            <th className="p-2 text-right">Montant</th><th className="p-2 text-right">Reste dû</th>
            {relances ? <><th className="p-2">Retard</th><th className="p-2">Niveau</th></> : <th className="p-2">Dans</th>}
            {agit ? <th className="p-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {lignes.map((e) => (
            <tr key={valeur(e)} className="border-b border-bordure">
              {agit ? <td className="p-2"><input type="checkbox" name="selection" value={valeur(e)} defaultChecked aria-label={`Inclure ${e.factureNumero} échéance ${e.echeance.numero} dans le lot`} /></td> : null}
              <td className="p-2"><Link href={`/factures/${e.factureId}`} className="text-sim-bleu underline">{e.factureNumero}</Link></td>
              <td className="p-2">{e.policeNumero}</td><td className="p-2">{e.souscripteur}</td><td className="p-2">n° {e.echeance.numero}</td><td className="p-2">{e.echeance.date}</td>
              <td className="p-2 text-right">{f(e.echeance.montant)}</td><td className="p-2 text-right">{f(e.echeance.restant)}</td>
              {relances ? <><td className="p-2">{e.joursRetard} j</td><td className="p-2">{e.niveau?.niveau} — {e.niveau?.libelle}</td></> : <td className="p-2">{-e.joursRetard} j</td>}
              {agit ? (
                <td className="p-2">
                  <button type="submit" name="un" value={valeur(e)} className="rounded border border-sim-bleu px-3 py-1 text-sm font-medium text-sim-bleu hover:bg-surface">Générer</button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Liste du jour (CDC §12) : avis d'échéance (J-x) et relances (J+x) à produire, recalculée depuis la base à chaque affichage. */
export default async function PageEcheances() {
  const utilisateur = await exigerUtilisateur();
  let liste, lots;
  try {
    [liste, lots] = await Promise.all([listeDuJour(utilisateur), listerLotsEcheances(utilisateur)]);
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  const agit = peutAgir(await niveauDuProfil(utilisateur.profil, "EMETTRE_FACTURE"));
  const total = liste.avis.length + liste.relances.length;

  return (
    <main>
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">Avis d&apos;échéance et relances du {liste.date}</h1>
      <p className="mb-6 text-sm text-zinc-700">
        Échéances non payées des factures émises et non annulées, selon les délais de chaque produit (Produits → Avis et relances). Une échéance payée,
        ou dont la facture est annulée par un avoir, ne produit plus rien : c&apos;est vérifié aussi au moment de la génération. Un seul avis par
        échéance, une seule relance par niveau. Aucun envoi automatique : les PDF se téléchargent depuis « Documents émis ».
      </p>
      <FormulaireAction action={genererDepuisLaListe} libelleBouton={`Générer par lot les ${total} lignes cochées`}>
        <h2 className="mb-2 text-lg font-semibold">Avis d&apos;échéance à produire ({liste.avis.length})</h2>
        <Tableau lignes={liste.avis} agit={agit} relances={false} />
        <h2 className="mb-2 text-lg font-semibold">Relances à produire ({liste.relances.length})</h2>
        <Tableau lignes={liste.relances} agit={agit} relances />
        {!agit || total === 0 ? <p className="mb-2 text-sm text-zinc-600">{agit ? "Rien à générer aujourd'hui." : "Consultation seule."}</p> : null}
      </FormulaireAction>

      <h2 className="mb-2 mt-8 text-lg font-semibold">Derniers lots</h2>
      {lots.length === 0 ? (
        <p className="text-sm">Aucun lot pour l&apos;instant.</p>
      ) : (
        <ul className="list-disc pl-5 text-sm">
          {lots.map((l) => (
            <li key={l.id}>
              <Link href={`/echeances/lots/${l.id}`} className="text-sim-bleu underline">Lot n° {l.id}</Link> du {l.dateListe}, {l.total} document(s), {l.statut === "TERMINE" ? "terminé" : "en cours"}, par {l.creePar}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
