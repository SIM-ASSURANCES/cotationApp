import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { CANAUX_PAIEMENT, LIBELLE_CANAL, LONGUEUR_MIN_MOTIF_AVOIR } from "@/domaine/facturation/factures";
import { aujourdhui } from "@/serveur/parametrage";
import { lireFacture } from "@/serveur/factures";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { emettreLAvoir, emettreLaFacture, enregistrerLePaiement, imputerLAvance, modifierLaFacture, relancerLesPdf } from "../actions";

const f = (m: string) => formaterMontant(montant(m));
const entree = "mt-1 block w-full rounded border border-bordure bg-white px-3 py-2";

export default async function PageFacture(props: PageProps<"/factures/[id]">) {
  const { id } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let x;
  try {
    x = Number.isInteger(Number(id)) ? await lireFacture(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!x) notFound();
  const c = x.contenu;
  const cache = <input type="hidden" name="factureId" value={x.id} />;
  const titre = x.numero ?? `Brouillon n° ${x.id}`;
  const avoir = x.type === "AVOIR";

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href={`/cotations/${x.cotationId}/factures`} className="text-sim-bleu underline">← Factures de la police {x.policeNumero}</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">{x.libelleType} {titre}</h1>
      <p className="mb-4 text-sm"><strong>Statut :</strong> {x.libelleStatut}{x.avoir ? <> par l'avoir <Link href={`/factures/${x.avoir.id}`} className="text-sim-bleu underline">{x.avoir.numero}</Link></> : null}</p>

      {x.statut === "A_VALIDER" ? (
        <p className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <strong>À valider :</strong> TTC {f(x.ttc)} F au-dessus du seuil du produit ({x.seuil ? f(x.seuil) : "?"} F). Demande de {x.demandePar}. Un profil habilité, autre que le demandeur, émet la facture (CDC §4.1).
        </p>
      ) : null}
      {x.pdfEnAttente > 0 ? (
        <div className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <p className="mb-2"><strong>PDF en attente :</strong> le numéro est attribué et la facture est {avoir ? "émise" : x.libelleStatut.toLowerCase()} ; seul le fichier PDF reste à produire, à l'identique.</p>
          <ul className="mb-2 list-disc pl-5">
            {x.documents.filter((d) => d.statut === "EN_ATTENTE").map((d) => <li key={`${d.numero}-${d.version}`}>{d.numero} version {d.version} : {d.tentatives} essai(s), {d.derniereErreur ?? "pas encore tenté"}</li>)}
          </ul>
          <FormulaireAction action={relancerLesPdf} libelleBouton="Relancer la production des PDF">{cache}</FormulaireAction>
        </div>
      ) : null}

      <section className="mb-6 grid max-w-4xl gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <p><strong>Police :</strong> {x.policeNumero} ({x.produitCode})</p>
        <p><strong>Facturé à :</strong> {x.souscripteur}{c.souscripteur.adresse ? `, ${c.souscripteur.adresse}` : ""}</p>
        <p><strong>Envoyé à :</strong> {c.envoyeA ? `${c.envoyeA.nom}, ${c.envoyeA.adresse}` : "— (identique ou non saisi : bloc masqué)"}</p>
        <p><strong>Période :</strong> du {c.dateEffet} au {c.dateEcheance} ({c.joursCouverts} jours)</p>
        <p><strong>Émise le :</strong> {x.dateEmission ?? "—"}{x.emisePar ? ` par ${x.emisePar}` : ""}</p>
        <p><strong>Préparée par :</strong> {x.creePar}</p>
        {x.factureOrigine ? <p><strong>Facture annulée :</strong> <Link href={`/factures/${x.factureOrigine.id}`} className="text-sim-bleu underline">{x.factureOrigine.numero}</Link></p> : null}
        {x.motif ? <p><strong>Motif de l'avoir :</strong> {x.motif}</p> : null}
        {x.remplace ? <p><strong>Remplace :</strong> <Link href={`/factures/${x.remplace.id}`} className="text-sim-bleu underline">{x.remplace.numero}</Link> (annulée)</p> : null}
        {x.remplacante ? <p><strong>Remplacée par :</strong> <Link href={`/factures/${x.remplacante.id}`} className="text-sim-bleu underline">{x.remplacante.numero ?? "brouillon"}</Link> ({x.remplacante.statut})</p> : null}
      </section>

      <h2 className="mb-2 text-lg font-semibold">Montants (moteur de calcul)</h2>
      <div className="mb-6 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="bg-sim-bleu text-right text-white"><th className="p-2 text-left">Formule</th><th className="p-2">Effectif</th><th className="p-2">Prime nette (HT)</th><th className="p-2">Accessoires</th><th className="p-2">Taxe ({c.taxe.tauxPourcent} %)</th><th className="p-2">TTC</th></tr>
          </thead>
          <tbody>
            {c.formules.map((l) => (
              <tr key={l.code} className="border-b border-bordure text-right">
                <td className="p-2 text-left">{l.libelle}</td><td className="p-2">{l.effectif}</td><td className="p-2">{f(l.nette)}</td><td className="p-2">{f(l.accessoires)}</td><td className="p-2">{f(l.taxe)}</td><td className="p-2">{f(l.ttc)}</td>
              </tr>
            ))}
            <tr className="text-right font-semibold">
              <td className="p-2 text-left">Total</td><td className="p-2" /><td className="p-2">{f(c.totaux.nette)}</td><td className="p-2">{f(c.totaux.accessoires)}</td><td className="p-2">{f(c.totaux.taxe)}</td><td className="p-2">{f(c.totaux.ttc)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {x.etat ? (
        <section className="mb-6 max-w-4xl">
          <h2 className="mb-2 text-lg font-semibold">Échéances et paiements</h2>
          <p className="mb-2 text-sm">
            <strong>Payé :</strong> {f(x.etat.totalPaye)} F — <strong>Restant dû :</strong> {f(x.etat.restantDu)} F
            {montant(x.avance.disponible).greaterThan(0) ? <> — <strong>Avance de la police :</strong> {f(x.avance.disponible)} F (<Link href={`/cotations/${x.cotationId}/factures#avance`} className="text-sim-bleu underline">détail</Link>)</> : null}
          </p>
          {x.etat.echeances.length > 0 ? (
            <table className="mb-3 w-full border-collapse text-sm">
              <thead><tr className="text-left text-zinc-600"><th className="p-1">Échéance</th><th className="p-1">Date</th><th className="p-1 text-right">Montant</th><th className="p-1">Statut</th></tr></thead>
              <tbody>{x.etat.echeances.map((e) => <tr key={e.numero} className="border-t border-bordure"><td className="p-1">{e.numero}</td><td className="p-1">{e.date}</td><td className="p-1 text-right">{f(e.montant)}</td><td className="p-1">{e.statut}</td></tr>)}</tbody>
            </table>
          ) : null}
          {x.etat.paiements.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <thead><tr className="text-left text-zinc-600"><th className="p-1">Reçu</th><th className="p-1">Date</th><th className="p-1 text-right">Montant</th><th className="p-1">Canal</th><th className="p-1">Référence</th><th className="p-1">Payeur</th><th className="p-1 text-right">Restant dû après</th></tr></thead>
              <tbody>
                {x.etat.paiements.map((p, i) => (
                  <tr key={i} className="border-t border-bordure">
                    <td className="p-1">{p.numero || "—"}</td>
                    <td className="p-1">{p.date}</td>
                    <td className="p-1 text-right">{f(p.montant)}{p.excedent && montant(p.excedent).greaterThan(0) ? <span className="block text-xs text-zinc-600">dont {f(p.excedent)} F en avance</span> : null}</td>
                    <td className="p-1">{LIBELLE_CANAL[p.canal]}</td>
                    <td className="p-1">{p.reference || "—"}</td>
                    <td className="p-1">{p.payeur || "—"}</td>
                    <td className="p-1 text-right">{f(p.restantDu)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-zinc-700">Aucun paiement.</p>}
          {x.remplace ? <p className="mt-2 text-sm text-zinc-700">Les paiements de la facture annulée {x.remplace.numero} sont repris ici à l&apos;émission (leurs reçus restent valables).</p> : null}
          {x.reports.length > 0 ? (
            <p className="mt-2 text-sm text-zinc-700">
              Sommes reportées en avance sur la police à l&apos;annulation : {x.reports.map((r) => `${f(r.montant)} F (${r.recu ?? "avance"}, ${r.date})`).join(" ; ")}. La facture de remplacement les reprend à son émission.
            </p>
          ) : null}
        </section>
      ) : null}

      {x.documents.length > 0 ? (
        <section className="mb-6 max-w-4xl">
          <h2 className="mb-2 text-lg font-semibold">Documents</h2>
          <ul className="list-disc pl-5 text-sm">
            {x.documents.map((d) => (
              <li key={`${d.numero}-${d.version}`}>
                {d.type === "RECU" ? "Reçu" : d.type === "AVOIR" ? "Avoir" : "Facture"} {d.numero} v{d.version} : {d.documentId ? <a href={`/api/documents/${d.documentId}`} className="text-sim-bleu underline">télécharger le PDF</a> : "PDF en attente"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid max-w-3xl gap-6">
        {x.actions.modifier ? (
          <div className="rounded border border-bordure p-4">
            <h2 className="mb-2 text-lg font-semibold">Modifier le brouillon</h2>
            <FormulaireAction action={modifierLaFacture} libelleBouton="Enregistrer" discret>
              {cache}
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">« Envoyé à » : destinataire<input name="envoyeNom" defaultValue={c.envoyeA?.nom ?? ""} className={entree} /></label>
                <label className="block text-sm">Adresse<input name="envoyeAdresse" defaultValue={c.envoyeA?.adresse ?? ""} className={entree} /></label>
              </div>
              {x.type === "RENOUVELLEMENT" ? (
                <>
                  {c.formules.map((l) => (
                    <label key={l.code} className="mb-2 block text-sm">
                      Effectif {l.libelle}
                      <input type="hidden" name="formule_code" value={l.code} />
                      <input name="formule_effectif" type="number" min={1} defaultValue={l.effectif} className={entree} />
                    </label>
                  ))}
                  <label className="mb-3 block text-sm">Nombre de tranches<input name="nombreTranches" type="number" min={1} defaultValue={Math.max(1, c.echeances.length)} className={entree} /></label>
                </>
              ) : null}
            </FormulaireAction>
          </div>
        ) : null}

        {x.actions.emettre ? (
          <div className="rounded border border-bordure p-4">
            <h2 className="mb-2 text-lg font-semibold">Émettre</h2>
            <p className="mb-3 text-sm text-zinc-700">
              {x.actions.emettreSousSeuil
                ? `Le TTC dépasse le seuil du produit (${x.seuil ? f(x.seuil) : "?"} F) : votre demande passera « À valider ».`
                : "Le numéro FAC est attribué maintenant ; la facture ne se modifiera plus."}
            </p>
            <FormulaireAction action={emettreLaFacture} libelleBouton={x.actions.emettreSousSeuil ? "Demander la validation" : "Émettre la facture"}>{cache}</FormulaireAction>
          </div>
        ) : null}

        {x.actions.payer ? (
          <div className="rounded border border-bordure p-4">
            <h2 className="mb-2 text-lg font-semibold">Enregistrer un paiement</h2>
            <p className="mb-3 text-sm text-zinc-700">Un reçu REC est produit, et la facture est rééditée (version suivante, restant dû à jour). Un montant supérieur au restant dû est accepté : l&apos;excédent devient une avance sur la police (H33), visible sur le reçu.</p>
            <FormulaireAction action={enregistrerLePaiement} libelleBouton="Enregistrer le paiement">
              {cache}
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Champ nom="date" libelle="Date (AAAA-MM-JJ)" valeur={aujourdhui()} autoComplete="off" />
                <Champ nom="montant" libelle={`Montant (restant dû : ${x.etat ? f(x.etat.restantDu) : "?"} F)`} autoComplete="off" />
                <label className="mb-4 block text-sm font-medium">Canal
                  <select name="canal" required defaultValue="" className={entree}>
                    <option value="" disabled>— Choisir —</option>
                    {CANAUX_PAIEMENT.map((k) => <option key={k} value={k}>{LIBELLE_CANAL[k]}</option>)}
                  </select>
                </label>
                <Champ nom="reference" libelle="Référence (obligatoire sauf espèces)" requis={false} autoComplete="off" />
                <Champ nom="payeur" libelle="Payeur (par défaut : Facturé à)" requis={false} autoComplete="off" />
              </div>
            </FormulaireAction>
          </div>
        ) : null}

        {x.actions.imputer ? (
          <div className="rounded border border-bordure p-4">
            <h2 className="mb-2 text-lg font-semibold">Imputer l&apos;avance de la police</h2>
            <p className="mb-3 text-sm text-zinc-700">
              Avance disponible : {f(x.avance.disponible)} F ; restant dû : {x.etat ? f(x.etat.restantDu) : "?"} F. L&apos;imputation apparaît dans les paiements de la facture (rééditée, version suivante) ; aucun reçu n&apos;est produit.
            </p>
            <FormulaireAction action={imputerLAvance} libelleBouton="Imputer l'avance">
              {cache}
              <Champ nom="montant" libelle="Montant à imputer" valeur={x.avance.proposee} autoComplete="off" />
            </FormulaireAction>
          </div>
        ) : null}

        {x.actions.avoir ? (
          <div className="rounded border border-red-300 p-4">
            <h2 className="mb-2 text-lg font-semibold">Annuler par un avoir</h2>
            <p className="mb-3 text-sm text-zinc-700">
              Avoir AV de la totalité de la facture (montants négatifs). La facture devient « Annulée – avoir AV-… », y compris sur sa page de vérification, et reste conservée. Pour corriger : avoir, puis nouvelle facture depuis la police.
              {x.etat && montant(x.etat.totalPaye).greaterThan(0) ? ` Les ${f(x.etat.totalPaye)} F déjà payés sont reportés : la nouvelle facture les reprendra (les reçus restent valables).` : ""}
            </p>
            <FormulaireAction action={emettreLAvoir} libelleBouton="Émettre l'avoir">
              {cache}
              <Champ nom="motif" libelle={`Motif (${LONGUEUR_MIN_MOTIF_AVOIR} caractères au moins)`} autoComplete="off" />
            </FormulaireAction>
          </div>
        ) : null}
      </section>
    </main>
  );
}
