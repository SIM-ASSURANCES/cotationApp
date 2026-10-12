import { redirect } from "next/navigation";

import { formaterMontant, montant } from "@/domaine/calcul/montant";
import { LIBELLE_STATUT, STATUTS } from "@/domaine/cotation/statuts";
import { DOCUMENTS, estTypeDocument } from "@/domaine/documents/emission";
import { LIBELLE_TRANCHE, TRANCHES_ANCIENNETE, type LigneTransformation } from "@/domaine/tableaux/indicateurs";
import { exigerUtilisateur } from "@/serveur/session";
import { tableauDeBord } from "@/serveur/tableaux-de-bord";
import { ErreurAcces, ErreurMetier } from "@/serveur/types";

const f = (m: string) => `${formaterMontant(montant(m))} F`;
const entree = "mt-1 block rounded border border-bordure bg-white px-3 py-2";
const carte = "rounded border border-bordure p-4";

function Transformation({ titre, lignes }: { titre: string; lignes: LigneTransformation[] }) {
  return (
    <div>
      <h3 className="mb-1 font-semibold">{titre}</h3>
      {lignes.length === 0 ? (
        <p className="text-sm">Aucune cotation émise sur la période.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-surface text-left"><th className="p-1" /><th className="p-1 text-right">Émises</th><th className="p-1 text-right">Acceptées</th><th className="p-1 text-right">Taux</th></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.cle} className="border-b border-bordure"><td className="p-1">{l.cle}</td><td className="p-1 text-right">{l.emises}</td><td className="p-1 text-right">{l.acceptees}</td><td className="p-1 text-right">{l.taux === null ? "—" : `${l.taux.replace(".", ",")} %`}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Tableaux de bord (session 5b) : cotations (§9.4), facturation et relances (§11, §12), production. Recalculés depuis la base à chaque affichage. */
export default async function PageTableauxDeBord(props: PageProps<"/tableaux-de-bord">) {
  const recherche = await props.searchParams;
  const texte = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const utilisateur = await exigerUtilisateur();
  let t;
  let erreur: string | null = null;
  try {
    t = await tableauDeBord(utilisateur, { debut: texte(recherche.debut), fin: texte(recherche.fin) });
  } catch (e) {
    if (e instanceof ErreurAcces) redirect("/acces-refuse");
    if (!(e instanceof ErreurMetier)) throw e;
    erreur = e.message;
    t = await tableauDeBord(utilisateur);
  }
  const { cotations: c, facturation: fa, production: p } = t;

  return (
    <main>
      <h1 className="mb-1 text-2xl font-semibold text-sim-bleu">Tableaux de bord</h1>
      <form className="mb-6 flex flex-wrap items-end gap-4 text-sm" method="get">
        <label>Du (AAAA-MM-JJ)<input name="debut" defaultValue={t.periode.debut} className={entree} /></label>
        <label>Au<input name="fin" defaultValue={t.periode.fin} className={entree} /></label>
        <button type="submit" className="rounded bg-sim-bleu px-4 py-2 font-semibold text-white">Afficher</button>
        {erreur ? <p role="alert" className="text-red-700">{erreur} Période par défaut affichée.</p> : null}
      </form>

      <section className={`${carte} mb-6`}>
        <h2 className="mb-2 text-lg font-semibold">Cotations</h2>
        <p className="mb-3 text-sm text-zinc-700">Créées du {t.periode.debut} au {t.periode.fin}, à leur statut d&apos;aujourd&apos;hui. Taux de transformation : cotations émises sur la période, acceptées à ce jour.</p>
        <ul className="mb-4 flex flex-wrap gap-4 text-sm">
          {STATUTS.map((s) => <li key={s}><strong>{c.parStatut[s]}</strong> {LIBELLE_STATUT[s]}</li>)}
        </ul>
        <div className="grid gap-6 md:grid-cols-3">
          <Transformation titre="Par produit" lignes={c.transformation.parProduit} />
          <Transformation titre="Par commercial (auteur de la cotation)" lignes={c.transformation.parCommercial} />
          <div>
            <h3 className="mb-1 font-semibold">Par intermédiaire</h3>
            <p className="text-sm text-zinc-700">Non disponible : l&apos;application ne connaît pas encore les intermédiaires des cotations (H71).</p>
          </div>
        </div>
      </section>

      <section className={`${carte} mb-6`}>
        <h2 className="mb-2 text-lg font-semibold">Facturation</h2>
        <dl className="mb-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline font-medium">Émis sur la période (factures) : </dt><dd className="inline">{f(fa.emis)}</dd></div>
          <div><dt className="inline font-medium">Avoirs sur la période : </dt><dd className="inline">{f(fa.avoirs)}</dd></div>
          <div><dt className="inline font-medium">Encaissé sur la période : </dt><dd className="inline">{f(fa.encaisse)}</dd></div>
          <div><dt className="inline font-medium">Restant dû à ce jour : </dt><dd className="inline">{f(fa.restantDu)}</dd></div>
        </dl>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-1 font-semibold">Impayés par ancienneté (échéances échues)</h3>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {TRANCHES_ANCIENNETE.map((tr) => (
                  <tr key={tr} className="border-b border-bordure"><td className="p-1">{LIBELLE_TRANCHE[tr]}</td><td className="p-1 text-right">{fa.impayes[tr].nombre} échéance(s)</td><td className="p-1 text-right">{f(fa.impayes[tr].montant)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Avis et relances produits sur la période</h3>
            <p className="text-sm">Avis d&apos;échéance : {fa.avis}</p>
            {fa.relancesParNiveau.length === 0 ? <p className="text-sm">Aucune relance.</p> : (
              <ul className="list-disc pl-5 text-sm">{fa.relancesParNiveau.map((r) => <li key={r.niveau}>Niveau {r.niveau} : {r.nombre}</li>)}</ul>
            )}
          </div>
        </div>
      </section>

      <section className={carte}>
        <h2 className="mb-2 text-lg font-semibold">Production</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-1 font-semibold">Documents émis par type et par mois</h3>
            {p.documents.length === 0 ? <p className="text-sm">Aucun document émis sur la période.</p> : (
              <table className="w-full border-collapse text-sm">
                <thead><tr className="bg-surface text-left"><th className="p-1">Mois</th><th className="p-1">Type</th><th className="p-1 text-right">Nombre</th></tr></thead>
                <tbody>
                  {p.documents.map((d) => (
                    <tr key={`${d.mois}-${d.type}`} className="border-b border-bordure"><td className="p-1">{d.mois}</td><td className="p-1">{estTypeDocument(d.type) ? DOCUMENTS[d.type].libelle : d.type}</td><td className="p-1 text-right">{d.nombre}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Imports en masse confirmés sur la période</h3>
            <p className="text-sm">{p.imports.lots} import(s) : {p.imports.traites} certificat(s) produit(s), {p.imports.enErreur} ligne(s) en erreur, {p.imports.enEchec} en échec.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
