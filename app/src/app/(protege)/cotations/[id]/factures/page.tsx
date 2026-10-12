import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AvertissementsReports } from "@/composants/AvertissementsReports";
import { Champ, FormulaireAction } from "@/composants/FormulaireAction";
import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { CANAUX_PAIEMENT, LIBELLE_CANAL } from "@/domaine/facturation/factures";
import { facturesDePolice } from "@/serveur/factures";
import { aujourdhui } from "@/serveur/parametrage";
import { exigerUtilisateur } from "@/serveur/session";
import { ErreurAcces } from "@/serveur/types";

import { creerFacture, restituerLAvance } from "../../../factures/actions";

const f = (m: string) => formaterMontant(montant(m));
const entree = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2";

/** « Envoyé à » (CDC §11.2) : facultatif ; masqué sur la facture s'il est vide ou identique à « Facturé à ». */
function EnvoyeA() {
  return (
    <fieldset className="mb-3 grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium">« Envoyé à » (facultatif, s'il diffère du souscripteur)</legend>
      <label className="block text-sm">Destinataire<input name="envoyeNom" className={entree} autoComplete="off" /></label>
      <label className="block text-sm">Adresse<input name="envoyeAdresse" className={entree} autoComplete="off" /></label>
    </fieldset>
  );
}

export default async function PageFacturesDePolice(props: PageProps<"/cotations/[id]/factures">) {
  const { id } = await props.params;
  const utilisateur = await exigerUtilisateur();
  let vue;
  try {
    vue = Number.isInteger(Number(id)) ? await facturesDePolice(utilisateur, Number(id)) : null;
  } catch (erreur) {
    if (erreur instanceof ErreurAcces) redirect("/acces-refuse");
    throw erreur;
  }
  if (!vue) notFound();
  const { police, possibles } = vue;
  const cache = (type: string) => (
    <>
      <input type="hidden" name="policeId" value={police.id} />
      <input type="hidden" name="type" value={type} />
    </>
  );

  return (
    <main>
      <p className="mb-2 text-sm">
        <Link href={`/cotations/${police.cotationId}`} className="text-primary underline">← Cotation</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold text-primary">Factures de la police {police.numero}</h1>
      <p className="mb-6 text-sm text-neutral">
        {police.souscripteur}, du {police.dateEffet} au {police.dateEcheance}. Une facture se prépare en brouillon (sans numéro) ; son numéro FAC est attribué à l'émission. Émise, elle ne se modifie plus : une correction passe par un avoir puis une nouvelle facture.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Factures et avoirs</h2>
        {vue.factures.length === 0 ? (
          <p className="text-sm text-neutral">Aucune facture pour cette police.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead>
                <tr className="bg-primary text-left text-primary-foreground">
                  <th className="p-2">Numéro</th><th className="p-2">Type</th><th className="p-2">Statut</th><th className="p-2">Période</th><th className="p-2 text-right">TTC</th><th className="p-2 text-right">Restant dû</th><th className="p-2">PDF</th>
                </tr>
              </thead>
              <tbody>
                {vue.factures.map((x) => (
                  <tr key={x.id} className="border-b border-border">
                    <td className="p-2"><Link href={`/factures/${x.id}`} className="text-primary underline">{x.numero ?? `Brouillon n° ${x.id}`}</Link></td>
                    <td className="p-2">{x.libelleType}</td>
                    <td className="p-2">{x.libelleStatut}</td>
                    <td className="p-2">{x.dateEffet} → {x.dateEcheance}</td>
                    <td className="p-2 text-right">{f(x.ttc)}</td>
                    <td className="p-2 text-right">{x.restantDu === null ? "—" : f(x.restantDu)}</td>
                    <td className="p-2">{x.pdfEnAttente > 0 ? "En attente" : x.numero ? "Produit" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="avance" className="mb-8 max-w-5xl">
        <h2 className="mb-2 text-lg font-semibold">Avance de la police</h2>
        <p className="mb-2 text-sm">
          <strong>Solde créditeur :</strong> {f(vue.avance.disponible)} F. Un trop-perçu, ou la somme déjà payée d&apos;une facture annulée par un avoir, vient ici ; elle s&apos;impute sur une facture de la police (depuis la facture) ou se restitue.
        </p>
        {vue.avance.mouvements.length > 0 ? (
          <table className="mb-3 w-full border-collapse text-sm">
            <thead><tr className="text-left text-neutral"><th className="p-1">Date</th><th className="p-1">Mouvement</th><th className="p-1 text-right">Montant</th><th className="p-1">Facture</th><th className="p-1">Reçu d&apos;origine</th><th className="p-1">Canal, référence</th><th className="p-1">Par</th></tr></thead>
            <tbody>
              {vue.avance.mouvements.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="p-1">{m.date}</td>
                  <td className="p-1">{m.libelle}</td>
                  <td className="p-1 text-right">{m.credit ? "+" : "−"} {f(m.montant)}</td>
                  <td className="p-1">{m.facture ?? "—"}</td>
                  <td className="p-1">{m.recu ?? "—"}</td>
                  <td className="p-1">{m.canal ? `${m.canal}${m.reference ? `, ${m.reference}` : ""}` : "—"}</td>
                  <td className="p-1">{m.par}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {vue.droits.restituer && montant(vue.avance.disponible).greaterThan(0) ? (
          <div className="rounded border border-border p-4">
            <h3 className="mb-2 font-semibold">Restituer l&apos;avance</h3>
            <p className="mb-3 text-sm text-neutral">Remboursement au client, tracé au journal. Aucun document n&apos;est produit.</p>
            <AvertissementsReports reports={vue.avance.reportsEnAttente} />
            <FormulaireAction action={restituerLAvance} libelleBouton="Enregistrer la restitution">
              <input type="hidden" name="policeId" value={police.id} />
              <input type="hidden" name="cotationId" value={police.cotationId} />
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Champ nom="date" libelle="Date (AAAA-MM-JJ)" valeur={aujourdhui()} autoComplete="off" />
                <Champ nom="montant" libelle={`Montant (au plus ${f(vue.avance.disponible)} F)`} valeur={vue.avance.disponible} autoComplete="off" />
                <label className="mb-4 block text-sm font-medium">Canal
                  <select name="canal" required defaultValue="" className={entree}>
                    <option value="" disabled>— Choisir —</option>
                    {CANAUX_PAIEMENT.map((k) => <option key={k} value={k}>{LIBELLE_CANAL[k]}</option>)}
                  </select>
                </label>
                <Champ nom="reference" libelle="Référence (obligatoire sauf espèces)" requis={false} autoComplete="off" />
              </div>
            </FormulaireAction>
          </div>
        ) : null}
      </section>

      {vue.droits.creer ? (
        <section className="grid max-w-5xl gap-6">
          <div className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">Affaire nouvelle</h2>
            {possibles.affaireNouvelle ? (
              <FormulaireAction action={creerFacture} libelleBouton="Préparer la facture (brouillon)">
                {cache("AFFAIRE_NOUVELLE")}
                <p className="mb-3 text-sm text-neutral">Montants et échéancier de la police (moteur de calcul), à l'identique des conditions particulières.</p>
                <EnvoyeA />
              </FormulaireAction>
            ) : (
              <p className="text-sm text-neutral">{police.cpEmises ? "La facture d'affaire nouvelle existe déjà (voir ci-dessus)." : "Émettez d'abord les conditions particulières de la police."}</p>
            )}
          </div>

          <div className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">Renouvellement</h2>
            {possibles.renouvellement ? (
              <FormulaireAction action={creerFacture} libelleBouton="Préparer le renouvellement (brouillon)">
                {cache("RENOUVELLEMENT")}
                <p className="mb-3 text-sm text-neutral">
                  Période proposée : du {possibles.renouvellement.dateEffet} au {possibles.renouvellement.dateEcheance}, au tarif en vigueur à cette date. Formules et effectifs de la période précédente, modifiables dans le brouillon.
                </p>
                <EnvoyeA />
              </FormulaireAction>
            ) : (
              <p className="text-sm text-neutral">Le renouvellement suit une facture émise (affaire nouvelle ou renouvellement précédent).</p>
            )}
          </div>

          <div className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">Avenant d'incorporation</h2>
            {possibles.avenants.length > 0 ? (
              <FormulaireAction action={creerFacture} libelleBouton="Préparer l'avenant (brouillon)">
                {cache("AVENANT")}
                <label className="mb-3 block text-sm font-medium">
                  Incorporation à facturer
                  <select name="adherentsVersion" required defaultValue="" className={entree}>
                    <option value="" disabled>— Choisir —</option>
                    {possibles.avenants.map((a) => (
                      <option key={a.numero} value={a.numero}>Version {a.numero} : {a.adherents} adhérent(s), effet le {a.dateEffet}</option>
                    ))}
                  </select>
                </label>
                <p className="mb-3 text-sm text-neutral">Prime additionnelle au prorata, du jour de l'incorporation à l'échéance de la période facturée.</p>
                <EnvoyeA />
              </FormulaireAction>
            ) : (
              <p className="text-sm text-neutral">Aucune incorporation d'adhérents à facturer.</p>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
